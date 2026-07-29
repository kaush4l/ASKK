//! Everything `assemble` reads. All clocks and environment facts are data —
//! the caller injects them, which is what keeps assembly pure (§8.1).

use crate::types::Part;

/// Input state for one assembly. One field per content source; the eleven
/// starter sections of §8.2 are built from these.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct State {
    pub soul: String,
    pub identity: String,
    pub operating_rules: String,
    /// Generated module manifest (§6) — carries a Fragment part.
    pub affordances: Vec<Part>,
    pub user_facts: String,
    pub memory: String,
    /// Includes the injected clock; deliberately Dynamic, never earlier.
    pub environment: String,
    pub task: String,
    /// (role, text) turns, oldest first.
    pub history: Vec<(String, String)>,
    /// Results of the last actions — Volatile; may carry images.
    pub observations: Vec<Part>,
    /// Injected wall clock for provenance stamps.
    pub now: String,
}

impl State {
    /// Representative fixture: every section populated (§8.2 — nothing empty),
    /// multimodal parts in `affordances` and `observations`, enough history
    /// mass for a budget to bite on. Tests and the golden snapshot share it.
    pub fn example() -> State {
        State {
            soul: "You are Harness, a personal agent that lives in the browser. \
                   Values: honesty over comfort, the smallest correct step, \
                   legibility over cleverness. Voice: plain, direct, unhurried."
                .into(),
            identity: "Name: Harness. Role: resident assistant on this device. \
                       Presentation: first person, no persona theatrics."
                .into(),
            operating_rules: "Do one thing per turn. Never claim an action succeeded \
                              without an observation proving it. Prefer asking over \
                              guessing when a step is irreversible."
                .into(),
            affordances: vec![
                Part::Text {
                    text: "Modules available: notes.search(query), notes.append(text), \
                           timer.set(minutes), dashboard.panel(id)."
                        .into(),
                },
                Part::Fragment {
                    id: "notes-panel".into(),
                    html: "<div class=\"panel\"><h3>Notes</h3><ul><li>3 pinned</li></ul></div>"
                        .into(),
                },
            ],
            user_facts: "Kaushal. Timezone America/Chicago. Prefers terse answers. \
                         Works on browser-only agent infrastructure."
                .into(),
            memory: "Last session ended after shipping the module registry spike. \
                     Open thread: golden tests were flaky under locale formatting — resolved \
                     by forbidding locale-dependent rendering."
                .into(),
            environment: "Time: 2026-07-29T10:00:00-05:00. Device: laptop, online. \
                          Offline models: none loaded."
                .into(),
            task: "Summarize yesterday's notes and pin the three action items.".into(),
            history: vec![
                ("user".into(), "Did the registry spike land?".into()),
                (
                    "assistant".into(),
                    "Yes — committed and green; golden snapshots updated.".into(),
                ),
                ("user".into(), "Good. Next: yesterday's notes.".into()),
                (
                    "assistant".into(),
                    "Opening notes for 2026-07-28; 14 entries found.".into(),
                ),
                ("user".into(), "Pull the action items out of them.".into()),
            ],
            observations: vec![
                Part::Text {
                    text: "notes.search(\"2026-07-28\") -> 14 entries, 3 tagged #action.".into(),
                },
                Part::Image {
                    media_type: "image/png".into(),
                    data_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAA=".into(),
                },
            ],
            now: "2026-07-29T10:00:00-05:00".into(),
        }
    }
}
