//! WHO MAY WRITE THIS AGENT'S LOG when the same agent is running in more than
//! one place at once.
//!
//! Two tabs of this page both run `main`, and `main`'s log is one key range in
//! one IndexedDB — `main/0 … main/n` (`log::decisions::key`). Neither tab can
//! see the other's window, so both number their entries from their own memory:
//! tab B's `main/3` silently overwrites tab A's, and a compaction in either one
//! calls `replace_prefix`, which drops every key past the summary — including
//! everything the other tab appended. Nothing here detects that and nothing
//! repairs it. The conversation simply comes back wrong on the next reload.
//!
//! The fix is not merging two windows; there is no rule that could. It is
//! deciding, once, whether THIS context owns the log — and the browser already
//! has the primitive: an exclusive Web Lock is granted to one context at a time
//! and released when that context dies, which is exactly the lifetime of the
//! ownership we want. This module is the DECISION and it is pure (I3);
//! `adapters_web::locks` is the twenty lines that ask the browser, and is the
//! only part no host test can reach.
//!
//! The state is a FACT IN THE LOG, not a field on `App` (I8): every projection
//! that has to say "this tab is not writing" — the conversation today, anything
//! later — folds the same record rather than reading a flag some other layer
//! set.

use kernel::EventKind;

use crate::app::App;

/// Whether this context owns the log it is holding a conversation in.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Writership {
    /// Nobody was asked, because there was nobody to ask: this browser or this
    /// context has no `navigator.locks`. Behaviour is exactly what it was
    /// before this module existed — write, and let the last tab win (I15). That
    /// is the bug above, and it is still the right answer here: refusing turns
    /// on the strength of a race we could not test for would break a single
    /// tab, today, to protect a second one that may never open.
    #[default]
    Unguarded,
    /// This context holds the lock. It is the one that writes.
    Leader,
    /// Another context holds it. This one reads, and writes nothing.
    Follower,
}

/// What the browser's answer means. `None` is "there was no lock manager to
/// ask", which is not the same as "somebody else has it" and must never be
/// read as one.
pub fn decide(granted: Option<bool>) -> Writership {
    match granted {
        None => Writership::Unguarded,
        Some(true) => Writership::Leader,
        Some(false) => Writership::Follower,
    }
}

/// Whether this context may put bytes in the store at all — the ONE predicate.
/// Taking a turn is writing: a `UserMessage` becomes a window entry becomes an
/// `Append`, so "may take a turn" and "may write" cannot be two answers without
/// one of them being a lie.
pub(crate) fn writes(w: Writership) -> bool {
    !matches!(w, Writership::Follower)
}

/// Whether this context must keep its bytes to itself — the question the two
/// I/O halves of `log::store` ask, phrased so the answer reads as the gate.
pub(crate) fn muted(app: &App) -> bool {
    !writes(of(app))
}

/// The lock ONE agent's log is guarded by.
///
/// Per agent, not per origin. `main` runs on the page and `critic` runs in its
/// own Worker; they write disjoint key ranges and race nothing. A single
/// origin-wide lock would make every Worker a follower of the page that started
/// it and silence logs no second tab was ever touching.
pub fn lock_name(agent: &str) -> String {
    format!("askk/log/{agent}")
}

/// THE LOCK THAT EXISTS ONLY TO BE WAITED ON.
///
/// Chrome 133+ freezes a hidden, CPU-heavy context group — the page AND its
/// Workers — after five minutes, and an agent loop driving a wasm x86 emulator
/// is the described case exactly. The documented way out is to hold a Web Lock
/// that another context is *waiting* on; an uncontended lock buys nothing, so
/// the contention has to be built rather than hoped for. `adapters_web::locks`
/// says which context holds this and which queue behind it. Nothing reads the
/// lock's value, because it has none: the queue IS the mechanism.
pub const AWAKE_LOCK: &str = "askk/awake";

/// The fact this decision is recorded as.
pub(crate) const WRITERSHIP: &str = "core.writership";

/// Record what this context decided, once, at boot. Appended even when it is
/// `Unguarded`: a store written by an earlier load carries the last answer, and
/// a replayed `Leader` from yesterday must not out-vote the silence of a
/// browser that has no locks today. Recording it claims nothing to the person —
/// only `Follower` is ever spoken aloud.
pub fn note(app: &mut App, w: Writership) {
    app.append(EventKind::Custom {
        kind: WRITERSHIP.into(),
        payload_json: serde_json::Value::String(word(w).into()).to_string(),
    });
}

/// What this context last decided — a fold over the log like every other view
/// (I8). Facts from earlier loads are in there too; the last one wins, and
/// `note` runs at boot, so the last one is always this context's own.
pub(crate) fn of(app: &App) -> Writership {
    app.log
        .iter()
        .filter_map(|event| match &event.kind {
            EventKind::Custom { kind, payload_json } if kind == WRITERSHIP => {
                Some(from_word(payload_json))
            }
            _ => None,
        })
        .last()
        .unwrap_or_default()
}

fn word(w: Writership) -> &'static str {
    match w {
        Writership::Unguarded => "unguarded",
        Writership::Leader => "leader",
        Writership::Follower => "follower",
    }
}

/// A payload this build does not recognise reads as `Unguarded`, which is the
/// only safe direction: an unreadable record must not silence a tab.
fn from_word(payload_json: &str) -> Writership {
    match serde_json::from_str::<String>(payload_json).unwrap_or_default().as_str() {
        "leader" => Writership::Leader,
        "follower" => Writership::Follower,
        _ => Writership::Unguarded,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_absent_lock_manager_is_not_a_lost_race() {
        assert_eq!(decide(None), Writership::Unguarded);
        assert!(writes(decide(None)));
    }

    #[test]
    fn the_grant_decides_and_nothing_else() {
        assert_eq!(decide(Some(true)), Writership::Leader);
        assert!(writes(decide(Some(true))));
        assert_eq!(decide(Some(false)), Writership::Follower);
        assert!(!writes(decide(Some(false))));
    }

    #[test]
    fn every_state_survives_the_round_trip_through_a_payload() {
        for w in [Writership::Unguarded, Writership::Leader, Writership::Follower] {
            let payload = serde_json::Value::String(word(w).into()).to_string();
            assert_eq!(from_word(&payload), w);
        }
        assert_eq!(from_word("\"something else\""), Writership::Unguarded);
        assert_eq!(from_word("not json at all"), Writership::Unguarded);
    }

    #[test]
    fn one_lock_per_agent_so_a_worker_is_not_a_follower_of_its_page() {
        assert_eq!(lock_name("main"), "askk/log/main");
        assert_ne!(lock_name("main"), lock_name("critic"));
    }
}
