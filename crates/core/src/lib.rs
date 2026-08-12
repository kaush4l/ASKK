//! L2 wiring (ARCHITECTURE §2): the §3 seam, routing dispatch, the effect
//! runtime loop, and boot. No domain logic lives here — this crate connects
//! the pure crates to each other and to injected ports, and nothing else.
//!
//! G3 interface freeze: types and signatures only; bodies are `todo!()`.

// G3 freeze: private fields are unread while bodies are todo!(); lift at G4.
#![allow(dead_code)]

mod agents;
mod app;
mod authored;
mod authoring;
mod batch;
mod board;
mod boardrow;
mod boot;
mod builtins;
mod chat;
mod dispatch;
mod effects;
mod error;
mod failure;
mod filelist;
mod files;
mod fold;
mod form;
mod identity;
mod inspector;
mod install;
mod logbook;
mod logs;
mod memory;
mod roster;
mod runtime;
mod scrollback;
mod space;
mod told;
mod tools;
mod transcript;
mod trace;
mod terminal;
mod workspace;

pub use install::{builtin_files, install_agents, install_agents_as, report_agent, report_memory};
pub use authored::{authored_here, report_authored};
pub use told::report_activity;
pub use app::{App, Ports, ENTRY_AGENT};
pub use boot::{boot, migrate, schema_version};
pub use dispatch::{builtin_entry, dispatch, BuiltinHandler, Ctx, KvHandle};
pub use error::CoreError;
// `drive` is PROVISIONAL (G4): the async runtime loop — see runtime.rs.
pub use effects::execute_effect;
pub use runtime::{drive, pump};
pub use logs::{activity_since, memory_held, restore_log, window};

use kernel::{Request, Response};

/// Every loaded agent's name, in order — what the composition root needs to
/// know which Workers to start (increment 06).
pub fn agent_names(app: &App) -> Vec<String> {
    app.agents.iter().map(|s| s.name.clone()).collect()
}

/// Every agent FILE this app is running from, in precedence order — built-ins,
/// `public/agents/`, then whatever this browser authored (increment 11). What a
/// Worker must be booted with, so a sub-agent sees the same agents the page
/// does, including one written here a moment ago.
pub fn agent_files(app: &App) -> Vec<(String, String)> {
    install::builtin_files()
        .into_iter()
        .chain(app.files.clone())
        .chain(authored::files(&app.authored))
        .collect()
}

/// Every fact so far, in order — the log itself (I8). Public because a test
/// that asserts only on a projection is asserting on a renderer; facts like a
/// status transition have to be checkable as facts.
pub fn log_kinds(app: &App) -> Vec<kernel::EventKind> {
    app.log.iter().map(|e| e.kind.clone()).collect()
}

/// The last thing this agent SAID — the answer a sub-agent hands back to the
/// agent that called it (Python: `invoke` returns the engine's answer). A fold
/// over the log like every other view (I8); a reply that only called tools is
/// not an answer, and `None` means the turn produced none.
pub fn answer(app: &App) -> Option<String> {
    app.log
        .iter()
        .filter_map(|event| match &event.kind {
            kernel::EventKind::ModelReplied { text, agent }
                if agent.is_empty() && !agent::has_calls(text) =>
            {
                Some(text.trim().to_string())
            }
            _ => None,
        })
        .filter(|text| !text.is_empty())
        .last()
}

/// Why this agent's last turn failed, in the words a person is shown — the
/// cause a caller MUST be able to see. `answer` returning `None` is not a
/// cause: a Worker that reported "<name> produced no answer" told the lead
/// four words naming nothing, where the page's own failure named the endpoint
/// and why it could not be reached (`ux-walker`, increment 06).
pub fn last_failure(app: &App) -> Option<String> {
    last_failure_payload(app).map(|payload| failure::sentence_of(&payload))
}

/// The same failure as the TYPED payload it was logged as — what a sub-agent's
/// Worker hands back across `postMessage`, so the agent that called it can show
/// the identical card, with the identical disclosure, that the page shows for
/// its own turn (`ux-walker`, increment 07b: one failure, one presentation).
pub fn last_failure_payload(app: &App) -> Option<String> {
    app.log
        .iter()
        .filter_map(|event| match &event.kind {
            kernel::EventKind::Custom { kind, payload_json } if kind == "core.error" => {
                Some(payload_json.clone())
            }
            _ => None,
        })
        .last()
}

/// The whole application (§3, I4): HTTP-shaped in, HTML-shaped out. Every UI
/// interaction crosses here and nowhere else; everything in the design is
/// downstream of protecting this signature. `app` is threaded explicitly
/// (not a global) so a test — or an agent's own Worker — can hold its own
/// instance; the seam contract is unchanged from the Spike A free function.
///
/// Synchronous BY DESIGN: reads hit the in-memory projections of the event
/// log (I8 — every view is a projection), writes leave as Effects executed
/// asynchronously by the runtime. If a route ever "needs" async here, state
/// is living outside the log — that is the bug.
pub fn handle(app: &mut App, req: Request) -> Response {
    // Anything authored since the last request becomes REAL here, before the
    // read that is about to project it — and never in the middle of a turn
    // (`roster::reconcile`). One door, so a page cannot show an agent the core
    // has not installed, or install one the page cannot see.
    roster::reconcile(app);
    let response = dispatch::dispatch(app, &req);
    // …and again, so a request that AUTHORED an agent has installed it by the
    // time it returns: "no reload" should not mean "one request later".
    roster::reconcile(app);
    // A request that CHANGED something, or failed, is a fact. A successful GET
    // is not: it is somebody looking at a projection of the log, and recording
    // that in the log is recording that someone looked.
    //
    // This reverses "the log's view of every UI touch" (I4's note on this
    // variant) and it has to. Four panes poll the seam between 400ms and 2s
    // for as long as a page is open, so a ten-minute run appended thousands of
    // `RequestHandled` facts — each one persisted, and each one cloned into
    // `Ctx` by the NEXT request (`dispatch`), so every poll made the next poll
    // dearer. The log grew without anything happening, which is the opposite
    // of what an append-only record of what happened is for.
    let changed = req.method != "GET" || response.status >= 400;
    if changed {
        app.append(kernel::EventKind::RequestHandled {
            path: req.path,
            status: response.status,
        });
    }
    response
}
