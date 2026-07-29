//! The §8.2 starter catalog: the eleven sections, their intents, stability
//! classes, and priorities. Split from assemble.rs to hold the ≤200-line
//! rule (§13); assemble.rs owns ordering and budget, this file owns content.

use crate::state::State;
use crate::types::{cost, Compaction, Part, Phase, Provenance, Section, Stability};

/// The eleven starter sections of §8.2, in table order. Priorities: higher
/// survives longer. history is the sacrificial mass; the contract and soul
/// go last of all.
pub(crate) fn starter_sections(state: &State, phase: Phase) -> Vec<Section> {
    let text = |t: &str| vec![Part::Text { text: t.into() }];
    let history_parts: Vec<Part> = state
        .history
        .iter()
        .map(|(role, msg)| Part::Text {
            text: format!("{role}: {msg}"),
        })
        .collect();
    vec![
        sec(
            "soul",
            "Who this agent is; values and voice.",
            Stability::Static,
            240,
            text(&state.soul),
            "soul.module",
            state,
        ),
        sec(
            "identity",
            "Name, role, presentation.",
            Stability::Static,
            220,
            text(&state.identity),
            "identity.module",
            state,
        ),
        sec(
            "operating_rules",
            "How to behave; the response discipline.",
            Stability::Static,
            230,
            text(&state.operating_rules),
            "rules.module",
            state,
        ),
        sec(
            "affordances",
            "What exists and how to use it.",
            Stability::SemiStatic,
            180,
            state.affordances.clone(),
            "registry.module",
            state,
        ),
        sec(
            "user",
            "Durable facts about the person.",
            Stability::SemiStatic,
            160,
            text(&state.user_facts),
            "user.module",
            state,
        ),
        sec(
            "memory",
            "Retained knowledge across sessions.",
            Stability::SemiStatic,
            120,
            text(&state.memory),
            "memory.module",
            state,
        ),
        sec(
            "environment",
            "Time, locale, device, what is available right now.",
            Stability::Dynamic,
            140,
            text(&state.environment),
            "env.module",
            state,
        ),
        sec(
            "task",
            "What is being attempted.",
            Stability::Dynamic,
            200,
            text(&state.task),
            "task.module",
            state,
        ),
        sec(
            "history",
            "Conversation and prior steps.",
            Stability::Dynamic,
            80,
            history_parts,
            "history.module",
            state,
        ),
        sec(
            "observations",
            "Results of the last actions.",
            Stability::Volatile,
            100,
            state.observations.clone(),
            "executor.module",
            state,
        ),
        // "Static per phase" (§8.2): static for a fixed phase, so it sorts
        // into the static prefix. Tension with recency-position lore noted in
        // the README for ADR-009.
        sec(
            "response_contract",
            "The exact shape of the expected reply.",
            Stability::Static,
            250,
            text(contract_for(phase)),
            "phase.module",
            state,
        ),
    ]
}

fn contract_for(phase: Phase) -> &'static str {
    match phase {
        Phase::Converse => "Reply in plain prose, at most three sentences, no lists unless asked.",
        Phase::Act => {
            "Reply with exactly one JSON object: {\"action\": <module.verb>, \
             \"args\": {..}, \"why\": <one sentence>}. No prose outside the object."
        }
    }
}

/// Section constructor; enforces §8.2's two hard rules at the door:
/// intent is mandatory, and nothing is empty by default.
fn sec(
    id: &str,
    intent: &str,
    stability: Stability,
    priority: u8,
    content: Vec<Part>,
    module: &str,
    state: &State,
) -> Section {
    assert!(
        !intent.is_empty(),
        "section '{id}' has no intent — it should not be in the paper (§8.2)"
    );
    assert!(
        !content.is_empty(),
        "section '{id}' is empty — an empty section is a bug, not a blank (§8.2)"
    );
    let mut s = Section {
        id: id.into(),
        intent: intent.into(),
        stability,
        priority,
        compaction: Compaction::Full,
        budget_hint: 0,
        provenance: Provenance {
            module: module.into(),
            at: state.now.clone(),
        },
        content,
    };
    s.budget_hint = cost(&s.effective_parts());
    s
}
