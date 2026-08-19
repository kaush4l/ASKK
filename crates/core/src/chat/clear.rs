//! `POST /chat/clear` — START AGAIN.
//!
//! A conversation is the most expensive thing in this app and the only one with
//! no way out. Every turn carries the whole window back to the model, so a
//! thread that went wrong early keeps paying for the wrong turn on every call
//! after it, and the only available fix was reloading the tab — which restores
//! the same conversation from the log, because that is what the log is for.
//!
//! IT CLEARS THREE THINGS, AND ALL THREE OR NONE.
//!
//! 1. **The window** the model sees, back to the marker a fresh agent starts
//!    on. Not to nothing: an empty history is a section with no parts, and the
//!    seeded marker is what every other fresh agent in this build holds.
//! 2. **The log**, by bumping the compaction generation. `log::decisions::sync` then
//!    emits a `Rewrite`, and `replace_prefix` drops every key past the new
//!    length — so a reload restores the cleared window and not the old one.
//!    Clearing only the window would have looked like it worked until the next
//!    refresh, which is the worst shape a bug can have.
//! 3. **The transcript**, by writing a fact the projection folds from. The
//!    event log is append-only and stays that way: nothing is deleted, the
//!    view starts later. What was said is still in the record for anyone
//!    reading it; it is no longer in the conversation or the prompt.
//!
//! ONLY THIS PAGE'S OWN AGENT, for `chat::halt`'s reason: a sub-agent's window
//! lives in its own Worker, which no fact written here reaches.

use kernel::{EventKind, Response};

use crate::dispatch::{error_fragment, Ctx};

/// The fact that a conversation was cleared. Its own kind: it is not a turn,
/// not a failure, and not something either party said.
pub(crate) const CHAT_CLEARED: &str = "core.chat_cleared";

/// Whose conversation a `core.chat_cleared` fact cleared — the empty string
/// for this page's own agent, matching `TURN_STOPPED`.
pub(crate) fn cleared_agent(payload_json: &str) -> String {
    serde_json::from_str::<String>(payload_json).unwrap_or_default()
}

/// Where `who`'s transcript starts: one past the last clear, or the beginning.
///
/// A projection and not a deletion — the same fold over the same log, entered
/// later. Replaying the log after a reload therefore produces the same screen,
/// which is the property every view in this app has and this one must not be
/// the exception to.
pub(crate) fn from(ctx: &Ctx, who: &str) -> usize {
    ctx.recent
        .iter()
        .enumerate()
        .filter(|(_, kind)| match kind {
            EventKind::Custom { kind, payload_json } if kind == CHAT_CLEARED => {
                let named = cleared_agent(payload_json);
                named == who || (named.is_empty() && who == ctx.me)
            }
            _ => false,
        })
        .map(|(nth, _)| nth + 1)
        .next_back()
        .unwrap_or(0)
}

/// `POST /chat/clear`.
pub(crate) fn clear(ctx: &mut Ctx, who: &str) -> Response {
    if who != ctx.me {
        let said = format!("chat: {who} runs in its own Worker, which this page cannot clear");
        return error_fragment(409, &said);
    }
    let fact = EventKind::Custom {
        kind: CHAT_CLEARED.into(),
        payload_json: "\"\"".into(),
    };
    match ctx.emit.as_mut() {
        Some(buf) => buf.push(fact.clone()),
        None => return error_fragment(500, "chat: Emit capability not granted"),
    }
    // Into THIS request's projection too, so the answer to the press is already
    // the empty conversation — the same thing `chat::stop` does, and for the
    // same reason: a control whose effect appears one poll later reads as a
    // control that did not work.
    ctx.recent.push(fact);
    ctx.wipe = true;
    crate::chat::transcript::transcript(ctx, who, None)
}

/// Carry out what the route asked for, on the App the route could not reach.
///
/// `Ctx` holds a projection and an emit buffer, not the agent — so the route
/// records the intent and the dispatcher performs it here, in the one place
/// that has both. The generation bump is what makes the log agree: without it
/// `sync` would queue appends against a window that had got SHORTER, and the
/// old entries would still be sitting in the store under their old keys.
pub(crate) fn wipe(app: &mut crate::app::App) {
    let at = app.ports.clock.now();
    agent::set_window(&mut app.agent.paper, &[agent::SESSION_STARTED.to_string()], at);
    app.agent.compactions = app.agent.compactions.wrapping_add(1);
}

/// The one route, for the manifest.
pub(crate) fn route() -> module::RouteSpec {
    module::RouteSpec {
        method: "POST".into(),
        path: "/chat/clear".into(),
    }
}

