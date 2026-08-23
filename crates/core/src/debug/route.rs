//! THE ROUTE FACT, READ BACK — `core.route_chosen`, which nothing outside the
//! crate that emits it has ever read (`agent::stages::facts`). The strategy
//! stage spends a whole model call deciding how much turn a message deserves,
//! records the decision and the clause behind it, and every surface in the
//! product then drew the turn as though the decision had not been made.
//!
//! IT IS ALSO WHERE THE REAL STAGE LIST COMES FROM. `agent::stages::route`
//! REPLACES `state.stages` with `Route::stages()` the moment the vote lands, so
//! the list a routed turn walks is the ROUTE's and never the file's. The board
//! counted against the file's `stages:` — the one shipped agent declares
//! `[strategy]`, so every `work`, `plan`, `verify` and `critique` missed the
//! lookup and printed a bare word. `walked` is the correction, and it is here
//! rather than in `board/` because the fact it reads is this module's subject.
//!
//! THE PAYLOAD IS READ DEFENSIVELY, ON PURPOSE. `route` and `why` come through
//! `agent::route_of`, the emitter's own reader; every OTHER key the payload
//! carries is reported by NAME rather than ignored, so a field added beside
//! them — whether the vote was real or a fallback, say — appears on the pane
//! the day it is emitted and without an edit here. A debug view that silently
//! drops half a fact it was built to show is the defect it exists to fix.

use kernel::EventKind;

use crate::dispatch::Ctx;

/// One `core.route_chosen` payload, as read.
#[derive(Clone, Default, PartialEq)]
pub(crate) struct Chosen {
    pub(crate) route: String,
    pub(crate) why: String,
    /// Whether the model REALLY voted for this route, or nothing readable came
    /// back and the machine fell to the middle one (`agent::route_voted`). Read
    /// through the emitter's own reader; a fallback that looks like a vote is
    /// the one thing on this pane that would make it lie.
    pub(crate) voted: bool,
    /// Every other key in the payload, `(name, what it said)` — see the header.
    pub(crate) also: Vec<(String, String)>,
}

/// What one value says, or `None` where it says nothing worth a line: a false
/// flag, a null, an empty string. A debug pane full of `fallback: no` is a wall
/// of undifferentiated JSON, which is the failure mode of debug panes.
fn said(value: &serde_json::Value) -> Option<String> {
    let text = match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::Bool(true) => "yes".to_string(),
        serde_json::Value::Bool(false) => String::new(),
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    Some(text).filter(|t| !t.is_empty())
}

pub(crate) fn read(payload_json: &str) -> Chosen {
    let (route, why) = agent::route_of(payload_json);
    let also = serde_json::from_str::<serde_json::Value>(payload_json)
        .ok()
        .and_then(|v| v.as_object().cloned())
        .map(|fields| {
            fields
                .iter()
                .filter(|(key, _)| !["route", "why", "how"].contains(&key.as_str()))
                .filter_map(|(key, value)| said(value).map(|s| (key.clone(), s)))
                .collect()
        })
        .unwrap_or_default();
    Chosen {
        route,
        why,
        voted: agent::route_voted(payload_json),
        also,
    }
}

/// The stages a route ACTUALLY walks, or `None` for a word this build does not
/// know. `Route::named` is the one place in the tree that turns a route word
/// into a route, and it answers `None` honestly where the VOTE's own parser
/// (`agent::vote_of`) falls to `react` on anything unreadable — right for a
/// vote, wrong here, because a list drawn for a word nobody recognised is a
/// confident sentence about a turn that cannot be checked. This used to spell
/// that by round-tripping a forged `ROUTE: {route}` line through the vote and
/// keeping the answer only if it came back unchanged; the honest `None` was
/// always one call away, and `board::flow` derives from the same call.
pub(crate) fn walked(route: &str) -> Option<Vec<String>> {
    agent::Route::named(route).map(agent::Route::stages)
}

/// Whether a fact of the loop's belongs to `who`. `chat::fold::belongs_to`
/// answers for everything a conversation renders; the two facts THIS module
/// exists for are not among them, and both are emitted by the engine running
/// the turn — so, exactly like `STAGE_ENTERED` beside them, they are this
/// process's agent's or they are nobody's.
pub(crate) fn mine(kind: &EventKind, ctx: &Ctx, who: &str) -> bool {
    match kind {
        EventKind::ModelCalled { .. } | EventKind::PhaseEntered { .. } => who == ctx.me,
        EventKind::Custom { kind: k, .. } if k == agent::ROUTE_CHOSEN => who == ctx.me,
        other => crate::chat::fold::belongs_to(other, &ctx.me, who),
    }
}

/// The route of the turn that is open for `who` right now, `None` between turns
/// or before the vote lands. Every boundary rule `board::stage::current`
/// follows, for its reasons: a route never outlives the turn that chose it.
pub(crate) fn chosen_now(ctx: &Ctx, who: &str) -> Option<Chosen> {
    let mut found = None;
    for kind in ctx.recent.iter().filter(|k| mine(k, ctx, who)) {
        match kind {
            EventKind::Custom { kind: k, payload_json } if k == agent::ROUTE_CHOSEN => {
                found = Some(read(payload_json));
            }
            EventKind::UserMessage { .. } => found = None,
            // NOT `awaits == Some(false)`, which is what `board::stage::current`
            // resets on. Every stage of a routed turn ends in a PROSE reply, and
            // prose reads as "the turn is over" to that predicate — harmless for
            // the stage, because a `STAGE_ENTERED` fact follows immediately and
            // sets it again, and fatal for the route, which is chosen ONCE. So
            // the route is cleared only by the facts that really end a turn.
            EventKind::Custom { kind: k, .. }
                if k == agent::ENDED
                    || k == agent::STOPPED
                    || k == crate::chat::pane::TURN_STOPPED =>
            {
                found = None
            }
            _ => {}
        }
    }
    found
}

