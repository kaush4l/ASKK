//! L2 wiring (ARCHITECTURE §2): the §3 seam, routing dispatch, the effect
//! runtime loop, and boot. No domain logic lives here — this crate connects
//! the pure crates to each other and to injected ports, and nothing else.
//!
//! G3 interface freeze: types and signatures only; bodies are `todo!()`.

// G3 freeze: private fields are unread while bodies are todo!(); lift at G4.
#![allow(dead_code)]

mod agents;
mod app;
mod batch;
mod board;
mod boot;
mod builtins;
mod chat;
mod dispatch;
mod error;
mod failure;
mod form;
mod runtime;
mod tools;
mod trace;

pub use agents::{builtin_files, install_agents, install_agents_as};
pub use app::{App, Ports, ENTRY_AGENT};
pub use boot::{boot, migrate, schema_version};
pub use dispatch::{builtin_entry, dispatch, BuiltinHandler, Ctx, KvHandle};
pub use error::CoreError;
// `drive` is PROVISIONAL (G4): the async runtime loop — see runtime.rs.
pub use runtime::{drive, execute_effect, pump};

use kernel::{Request, Response};

/// Every loaded agent's name, in order — what the composition root needs to
/// know which Workers to start (increment 06).
pub fn agent_names(app: &App) -> Vec<String> {
    app.agents.iter().map(|s| s.name.clone()).collect()
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
            kernel::EventKind::ModelReplied { text } if !agent::has_calls(text) => {
                Some(text.trim().to_string())
            }
            _ => None,
        })
        .filter(|text| !text.is_empty())
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
    let response = dispatch::dispatch(app, &req);
    app.append(kernel::EventKind::RequestHandled {
        path: req.path,
        status: response.status,
    });
    response
}
