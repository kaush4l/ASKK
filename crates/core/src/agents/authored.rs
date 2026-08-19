//! The authored set: the agents THIS BROWSER holds, folded out of the log.
//! `agents/roster.rs` installs them and `agents/authoring.rs` holds the routes that write
//! one; this file is only the fold that says which exist.
//!
//! An authored agent is not a second kind of agent: it is the same `agent.md`
//! `public/agents/` serves, held as a fact in the event log instead of as a
//! file on a static host — which is why it survives a refresh (the log is
//! replayed at boot), why deleting one is just another fact (I10), and why it
//! is projected rather than stored twice (I8).

use kernel::{EventKind, EventLog};

use crate::app::App;

/// An agent was written or replaced in this browser. Payload:
/// `[name, text, author]`.
pub(crate) const AUTHORED: &str = "core.agent_authored";
/// An authored record was removed. Payload: the name.
pub(crate) const DELETED: &str = "core.agent_deleted";

/// One authored record: the name, the whole `agent.md`, and WHO wrote it —
/// empty for the person at this keyboard, otherwise the agent that called
/// `write_agent`. Without the author a card cannot tell your own work from a
/// model's (11b walk), and a model-written agent may carry a `space:`, which
/// is a real shell grant.
pub type Authored = (String, String, String);

/// The payload's fields, tolerant of the two-element records written before
/// the author was recorded — an older log replays as written here by the
/// person, which is all it ever knew.
fn parts(payload_json: &str) -> Option<Authored> {
    let fields = serde_json::from_str::<Vec<String>>(payload_json).ok()?;
    let author = fields.get(2).cloned().unwrap_or_default();
    Some((fields.first()?.clone(), fields.get(1)?.clone(), author))
}

/// Every agent this browser has authored and not deleted, in the order they
/// were first written — a fold over the log, like every other view (I8).
pub(crate) fn set(log: &EventLog) -> Vec<Authored> {
    let mut found: Vec<Authored> = Vec::new();
    for event in log.iter() {
        let EventKind::Custom { kind, payload_json } = &event.kind else {
            continue;
        };
        if kind == DELETED {
            if let Ok(name) = serde_json::from_str::<String>(payload_json) {
                found.retain(|(n, _, _)| *n != name);
            }
        } else if let (AUTHORED, Some(record)) = (kind.as_str(), parts(payload_json)) {
            match found.iter().position(|(n, _, _)| *n == record.0) {
                Some(i) => found[i] = record,
                None => found.push(record),
            }
        }
    }
    found
}

/// The `(name, agent.md)` pairs the loader takes — precedence order is the
/// caller's, and the author rides beside the file rather than inside it.
pub(crate) fn files(authored: &[Authored]) -> Vec<(String, String)> {
    authored
        .iter()
        .map(|(name, text, _)| (name.clone(), text.clone()))
        .collect()
}

/// What THIS process authored — what a Worker hands back (`report_authored`).
pub fn authored_here(app: &App) -> Vec<Authored> {
    set(&app.log)
}

/// An agent a SUB-AGENT wrote, adopted by the page. A Worker is its own Wasm
/// instance with its own event log, so `write_agent` called there records the
/// fact THERE and the page would never see it — the create-agent superagent
/// would report success and install nothing. Not the seam (I4): the host
/// reporting a fact, exactly like `report_agent` and `report_memory`, landing
/// as the same event the page's own form emits so there is one record and one
/// precedence rule. An identical repeat is dropped — a Worker re-reports its
/// whole authored set every turn.
pub fn report_authored(app: &mut App, name: &str, text: &str, author: &str) {
    if set(&app.log).iter().any(|(n, t, _)| n == name && t == text) {
        return;
    }
    app.append(EventKind::Custom {
        kind: AUTHORED.into(),
        payload_json: serde_json::to_string(&(name, text, author)).unwrap_or_default(),
    });
}
