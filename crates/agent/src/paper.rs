//! The agent's live paper: the §8.2 starter sections seeded as data, plus
//! the two mutations one Work turn needs (task set, history append). In G4
//! the agent owns its section sources directly; section-providers-as-modules
//! (§8.4) replace this seeding at G5+ — the assembly contract is unchanged.

use context::{Fidelity, Part, Provenance, Section, SectionSource, Stability, State};
use kernel::{ModuleId, SectionId, Timestamp, Version};

fn src(
    id: &str,
    intent: &str,
    stability: Stability,
    priority: u8,
    floor: Fidelity,
    text: &str,
) -> SectionSource {
    SectionSource {
        section: Section {
            id: SectionId(id.into()),
            intent: intent.into(),
            stability,
            priority,
            fidelity: Fidelity::Full,
            floor,
            budget_hint: 0, // assemble recomputes from real parts
            provenance: Provenance {
                module: ModuleId(format!("builtin.{id}")),
                version: Version(1),
                input_hash: "seed".into(),
                // Fixed at zero for seeds: static sections stay byte-identical
                // across turns and boots (the §8.3 cache-prefix property).
                produced_at: Timestamp(0),
            },
            parts: vec![Part::Text { text: text.into() }],
        },
        summary: None,
    }
}

/// The eleven starter sections (§8.2 table order), with honest skeleton
/// content — nothing pretends to be a provider that doesn't exist yet.
pub(crate) fn seed() -> State {
    State {
        sources: vec![
            src(
                "soul",
                "Who this agent is; values and voice.",
                Stability::Static,
                0,
                Fidelity::Summarized,
                "You are HARNESS, a personal agent living in this browser. Values: \
                 honesty over comfort, the smallest correct step, legibility over \
                 cleverness. Voice: plain, direct, unhurried.",
            ),
            src(
                "identity",
                "Name, role, presentation.",
                Stability::Static,
                1,
                Fidelity::Pointer,
                "Name: HARNESS. Role: resident assistant. Presentation: first \
                 person, no persona theatrics.",
            ),
            src(
                "operating_rules",
                "How to behave; the response discipline.",
                Stability::Static,
                1,
                Fidelity::Summarized,
                "Do one thing per turn. Never claim an action succeeded without an \
                 observation proving it. Prefer asking over guessing.",
            ),
            src(
                "response_contract",
                "The exact shape of the expected reply.",
                Stability::Static,
                0,
                Fidelity::Full,
                "Reply in plain prose to the user's message. Be concise.",
            ),
            src(
                "affordances",
                "What exists and how to use it.",
                Stability::SemiStatic,
                3,
                Fidelity::Pointer,
                "Dashboard modules: status panel. This chat is the only tool; \
                 no other affordances are installed yet.",
            ),
            src(
                "user",
                "Durable facts about the person.",
                Stability::SemiStatic,
                4,
                Fidelity::Pointer,
                "No durable user facts recorded yet.",
            ),
            src(
                "memory",
                "Retained knowledge across sessions.",
                Stability::SemiStatic,
                6,
                Fidelity::Elided,
                "First session; no memory retained yet.",
            ),
            src(
                "environment",
                "Time, locale, device, what is available right now.",
                Stability::Dynamic,
                5,
                Fidelity::Elided,
                "A browser tab; environment sensing not yet implemented.",
            ),
            src(
                "task",
                "What is being attempted.",
                Stability::Dynamic,
                2,
                Fidelity::Summarized,
                "Idle; awaiting a task.",
            ),
            src(
                "history",
                "Conversation and prior steps.",
                Stability::Dynamic,
                9,
                Fidelity::Pointer,
                "session started",
            ),
            src(
                "observations",
                "Results of the last actions.",
                Stability::Volatile,
                7,
                Fidelity::Elided,
                "No actions taken yet.",
            ),
        ],
    }
}

fn find<'a>(paper: &'a mut State, id: &str) -> &'a mut SectionSource {
    paper
        .sources
        .iter_mut()
        .find(|s| s.section.id.0 == id)
        .expect("seeded section exists")
}

/// Replace the task section's content (Dynamic: provenance moves with it).
pub(crate) fn set_task(paper: &mut State, text: &str, at: Timestamp) {
    let s = find(paper, "task");
    s.section.parts = vec![Part::Text { text: text.into() }];
    s.section.provenance.produced_at = at;
}

/// Replace a whole section's text. The toolbox reaches the model through
/// `affordances` and `response_contract` and through nothing else: there is no
/// prompt string in this codebase that could name a tool (I13).
pub(crate) fn set_text(paper: &mut State, id: &str, text: &str) {
    let s = find(paper, id);
    s.section.parts = vec![Part::Text { text: text.into() }];
}

/// Append one turn to the history section.
pub(crate) fn push_history(paper: &mut State, role: &str, text: &str, at: Timestamp) {
    let s = find(paper, "history");
    s.section.parts.push(Part::Text {
        text: format!("{role}: {text}"),
    });
    s.section.provenance.produced_at = at;
}

/// Adopt an agent's own file: the markdown body of `agent.md` IS this
/// agent's system prompt (the `soul` section), and its description is the
/// identity line. Nothing about `main` is hardcoded here afterwards — that
/// is what makes the `public/agents/` loader real rather than decorative.
pub fn adopt_spec(state: &mut crate::state::AgentState, spec: &crate::spec::AgentSpec) {
    state.model = spec.model.clone();
    let soul = find(&mut state.paper, "soul");
    soul.section.parts = vec![Part::Text {
        text: spec.prompt.clone(),
    }];
    let identity = find(&mut state.paper, "identity");
    identity.section.parts = vec![Part::Text {
        text: format!("Name: {}. {}", spec.name, spec.description),
    }];
}
