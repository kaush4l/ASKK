//! The representative 11-section fixture (§8.2 starter set), ported from
//! Spike C's `State::example()`: every section populated, multimodal parts,
//! enough history mass for a budget to bite. Timestamps are fixed data (I7).

use context::{Fidelity, Part, Provenance, Section, SectionSource, Slot, Stability, State};
use kernel::{ModuleId, SectionId, Timestamp, Version};

fn text(t: &str) -> Vec<Part> {
    vec![Part::Text { text: t.into() }]
}

/// The canonical eleven, each at the slot it owns. A lookup rather than an
/// argument: the fixture is the STARTER SET, and letting a test place `soul`
/// anywhere but first would let it prove something the real paper cannot do.
fn slot_for(id: &str) -> Slot {
    match id {
        "soul" => Slot::SOUL,
        "identity" => Slot::IDENTITY,
        "operating_rules" => Slot::OPERATING_RULES,
        "affordances" => Slot::AFFORDANCES,
        "user" => Slot::USER,
        "memory" => Slot::MEMORY,
        "environment" => Slot::ENVIRONMENT,
        "task" => Slot::TASK,
        "history" => Slot::HISTORY,
        "observations" => Slot::OBSERVATIONS,
        "response_contract" => Slot::RESPONSE,
        other => panic!("fixture section '{other}' has no slot"),
    }
}

#[allow(clippy::too_many_arguments)]
fn src(
    id: &str,
    intent: &str,
    stability: Stability,
    priority: u8,
    floor: Fidelity,
    parts: Vec<Part>,
    module: &str,
) -> SectionSource {
    SectionSource {
        section: Section {
            id: SectionId(id.into()),
            intent: intent.into(),
            slot: slot_for(id),
            stability,
            priority,
            fidelity: Fidelity::Full,
            floor,
            budget_hint: 0, // assemble recomputes
            provenance: Provenance {
                module: ModuleId(module.into()),
                version: Version(1),
                input_hash: "fixture".into(),
                produced_at: Timestamp(1_753_800_000_000),
            },
            parts,
        },
        summary: None,
    }
}

/// Canonical §8.2 declaration order. Priorities follow ADR-009's sense:
/// LOWER survives longer — soul/contract at 0, history the sacrificial mass.
pub fn example() -> State {
    State {
        form: context::Form::DEFAULT,
        sources: vec![
            src(
                "soul",
                "Who this agent is; values and voice.",
                Stability::Static,
                0,
                Fidelity::Summarized,
                text(
                    "You are Harness, a personal agent that lives in the browser. \
                     Values: honesty over comfort, the smallest correct step, \
                     legibility over cleverness. Voice: plain, direct, unhurried.",
                ),
                "soul.module",
            ),
            src(
                "identity",
                "Name, role, presentation.",
                Stability::Static,
                1,
                Fidelity::Pointer,
                text(
                    "Name: Harness. Role: resident assistant on this device. \
                     Presentation: first person, no persona theatrics.",
                ),
                "identity.module",
            ),
            src(
                "operating_rules",
                "How to behave; the response discipline.",
                Stability::Static,
                1,
                Fidelity::Summarized,
                text(
                    "Do one thing per turn. Never claim an action succeeded \
                     without an observation proving it. Prefer asking over \
                     guessing when a step is irreversible.",
                ),
                "rules.module",
            ),
            src(
                "response_contract",
                "The exact shape of the expected reply.",
                Stability::Static,
                0,
                Fidelity::Full, // floors at Full: never degrades (ADR-009)
                text(
                    "Reply with exactly one JSON object: {\"action\": <module.verb>, \
                     \"args\": {..}, \"why\": <one sentence>}. No prose outside the object.",
                ),
                "phase.module",
            ),
            src(
                "affordances",
                "What exists and how to use it.",
                Stability::SemiStatic,
                3,
                Fidelity::Pointer,
                vec![
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
                "registry.module",
            ),
            src(
                "user",
                "Durable facts about the person.",
                Stability::SemiStatic,
                4,
                Fidelity::Pointer,
                text(
                    "Kaushal. Timezone America/Chicago. Prefers terse answers. \
                     Works on browser-only agent infrastructure.",
                ),
                "user.module",
            ),
            src(
                "memory",
                "Retained knowledge across sessions.",
                Stability::SemiStatic,
                6,
                Fidelity::Elided,
                text(
                    "Last session ended after shipping the module registry spike. \
                     Open thread: golden tests were flaky under locale formatting — \
                     resolved by forbidding locale-dependent rendering.",
                ),
                "memory.module",
            ),
            src(
                "environment",
                "Time, locale, device, what is available right now.",
                Stability::Dynamic,
                5,
                Fidelity::Elided,
                text(
                    "Time: 2026-07-29T10:00:00-05:00. Device: laptop, online. \
                     Offline models: none loaded.",
                ),
                "env.module",
            ),
            src(
                "task",
                "What is being attempted.",
                Stability::Dynamic,
                2,
                Fidelity::Summarized,
                text("Summarize yesterday's notes and pin the three action items."),
                "task.module",
            ),
            src(
                "history",
                "Conversation and prior steps.",
                Stability::Dynamic,
                9,
                Fidelity::Pointer, // history floors at Pointer (ADR-009)
                vec![
                    ("user", "Did the registry spike land?"),
                    (
                        "assistant",
                        "Yes — committed and green; golden snapshots updated.",
                    ),
                    ("user", "Good. Next: yesterday's notes."),
                    (
                        "assistant",
                        "Opening notes for 2026-07-28; 14 entries found.",
                    ),
                    ("user", "Pull the action items out of them."),
                ]
                .into_iter()
                .map(|(role, msg)| Part::Text {
                    text: format!("{role}: {msg}"),
                })
                .collect(),
                "history.module",
            ),
            src(
                "observations",
                "Results of the last actions.",
                Stability::Volatile,
                7,
                Fidelity::Elided,
                vec![
                    Part::Text {
                        text: "notes.search(\"2026-07-28\") -> 14 entries, 3 tagged #action."
                            .into(),
                    },
                    Part::Image {
                        media_type: "image/png".into(),
                        data_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAA=".into(),
                    },
                ],
                "executor.module",
            ),
        ],
    }
}
