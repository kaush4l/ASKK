//! The chat module: ONE agent's conversation, rendered as a projection of the
//! event log scoped to that agent (I8), plus the one route that starts a turn.
//!
//! Every agent is separately addressable (increment 07): `x-agent` on the
//! request says whose conversation this is, and nothing outside it is ever
//! projected — a message to `researcher` cannot appear in `main`'s transcript
//! because the fold never reaches it. The transcript is computed on every
//! request and stored nowhere: reload the page and the same fold over the
//! replayed log produces the same screen, for every agent at once.

use kernel::{CapabilityId, EventKind, ModuleId, Request, Response, Version};
use module::{DataSchema, Manifest, RouteSpec, Tier};

use crate::dispatch::{error_fragment, Ctx};
use crate::chat::transcript::transcript;
use crate::builtins::form_value;

pub(crate) fn manifest() -> Manifest {
    Manifest {
        id: ModuleId("chat".into()),
        name: "Chat".into(),
        version: Version(1),
        description: "One agent's conversation: the transcript and the turn trigger.".into(),
        capabilities: vec![CapabilityId::Emit],
        routes: vec![
            RouteSpec {
                method: "GET".into(),
                path: "/chat".into(),
            },
            RouteSpec {
                method: "POST".into(),
                path: "/chat".into(),
            },
            RouteSpec {
                method: "POST".into(),
                path: "/chat/stop".into(),
            },
            RouteSpec {
                method: "POST".into(),
                path: "/chat/halt".into(),
            },
            crate::chat::clear::route(),
        ],
        slots: vec![],
        section: None,
        schema: DataSchema {
            kv_prefix: "mod/chat/".into(),
            version: 1,
        },
        tier: Tier::T0Rust,
        tests: vec![],
    }
}

/// Named ONLY from `dispatch::builtin_entry` (ADR-004).
pub(crate) fn chat(req: &Request, ctx: &mut Ctx) -> Response {
    let who = match req.header("x-agent").unwrap_or_default() {
        "" => ctx.me.clone(),
        named => named.to_string(),
    };
    if !ctx.agents.iter().any(|s| s.name == who) && !ctx.agents.is_empty() {
        return error_fragment(404, &format!("chat: no agent called '{who}' is loaded"));
    }
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/chat") => transcript(ctx, &who, None),
        ("POST", "/chat") => submit(req, ctx, &who),
        ("POST", "/chat/stop") => stop(ctx, &who),
        ("POST", "/chat/halt") => halt(ctx, &who),
        ("POST", "/chat/clear") => crate::chat::clear::clear(ctx, &who),
        _ => error_fragment(404, "chat: unknown subroute"),
    }
}

/// The fact a stopped wait becomes. Its own kind: a turn the person ended is
/// not a failure, and not an answer either.
pub(crate) const TURN_STOPPED: &str = "core.turn_stopped";

/// Whose wait a `core.turn_stopped` fact ended — the empty string for this
/// process's own agent, which is every record written before 12b. One reader
/// for the projection and the runtime, so they cannot disagree about whose
/// turn ended.
pub(crate) fn stopped_agent(payload_json: &str) -> String {
    serde_json::from_str::<String>(payload_json).unwrap_or_default()
}

/// `POST /chat/stop` — the person stopped waiting, so the TURN ends, not just
/// the polling. Pressing it used to leave the task outstanding, which defers
/// an agent swap forever (`roster::reconcile`): saving a prompt mid-flight and
/// then stopping left the edit uninstalled until a reload (11b walk).
///
/// It used to REFUSE for any agent but this process's own, on the reasoning
/// that a Worker's turn cannot be reached from here. True, and not what the
/// button promises: it ends the WAIT, in the one log the pane is projecting.
/// Refusing left the composer disabled and the clock frozen with no way out but
/// wiping storage (12 walk, finding 2). The fact carries the agent's name, so
/// it lands in that agent's conversation and nobody else's.
fn stop(ctx: &mut Ctx, who: &str) -> Response {
    let named = match who == ctx.me {
        true => String::new(),
        false => who.to_string(),
    };
    let fact = EventKind::Custom {
        kind: TURN_STOPPED.into(),
        payload_json: serde_json::Value::String(named).to_string(),
    };
    match ctx.emit.as_mut() {
        Some(buf) => buf.push(fact.clone()),
        None => return error_fragment(500, "chat: Emit capability not granted"),
    }
    // Into THIS request's projection too, so the answer to the press already
    // shows the turn ended — the fact is real either way; the log gets it when
    // the dispatcher drains the buffer.
    ctx.recent.push(fact);
    transcript(ctx, who, None)
}

/// `POST /chat/halt` — STOP THE AGENT, not the watching (R16-P0-2). Two
/// consecutive fresh-context critics named this absence as the one thing
/// keeping the product below the hosted field: every control that said "Stop"
/// meant "stop looking", and a 64-round run had no exit but reloading the tab.
///
/// It records the press and nothing more. `agent::step` reads it, arms the
/// turn, and ends it at the next step boundary — so what stops the run is the
/// pure function, on the log, and not a side channel into a loop in flight.
///
/// ONLY THIS PAGE'S OWN AGENT. A sub-agent's turn runs in its own Worker with
/// its own state, which no fact written here reaches; offering the control
/// there would be the same lie in a new place. The pane is told by
/// `x-stoppable` and does not offer it, so this refusal is a backstop.
fn halt(ctx: &mut Ctx, who: &str) -> Response {
    if who != ctx.me {
        let said = format!("chat: {who} runs in its own Worker, which this page cannot stop");
        return error_fragment(409, &said);
    }
    let fact = EventKind::Custom {
        kind: agent::STOP_REQUESTED.into(),
        payload_json: "null".into(),
    };
    match ctx.emit.as_mut() {
        Some(buf) => buf.push(fact),
        None => return error_fragment(500, "chat: Emit capability not granted"),
    }
    // NOT into `ctx.recent`: unlike a stopped WAIT, this press changes nothing
    // the projection can show yet. The run is still finishing the call it is
    // in, and the conversation says so until the boundary writes the stop.
    transcript(ctx, who, None)
}

/// Start a turn: the utterance becomes a fact ADDRESSED TO ONE AGENT, and the
/// answer to THIS request is that agent's transcript with it already in place.
/// `ctx.emit` is drained by the dispatcher after this returns, so the new
/// message is passed in rather than read back out of `recent`.
fn submit(req: &Request, ctx: &mut Ctx, who: &str) -> Response {
    let Some(message) = form_value(&req.body, "message").filter(|m| !m.trim().is_empty()) else {
        return error_fragment(400, "chat: empty message");
    };
    // A TAB THAT DOES NOT OWN THE LOG DOES NOT START TURNS (T29). Not an error
    // fragment: that would replace the conversation with one red line, and the
    // next poll would wipe the line. The transcript already carries the
    // sentence saying why (`failure::second_tab`), so the answer to the press
    // is the conversation, unchanged, with the reason at the bottom of it.
    if !crate::log::writership::writes(ctx.writership) {
        return transcript(ctx, who, None);
    }
    // Empty means "this process's own agent": every log written before
    // per-agent chat says exactly that, and still reads correctly.
    let agent = match who == ctx.me {
        true => String::new(),
        false => who.to_string(),
    };
    match ctx.emit.as_mut() {
        Some(buf) => buf.push(EventKind::UserMessage {
            text: message.clone(),
            agent,
            from: String::new(), // a person typed it
        }),
        None => return error_fragment(500, "chat: Emit capability not granted"),
    }
    transcript(ctx, who, Some(&message))
}

