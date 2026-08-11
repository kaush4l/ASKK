//! The agent's live paper: the two mutations one Work turn needs (task set,
//! history append) plus adopting an agent file. The seeded starter sections
//! live in `seed.rs`; the rolling window lives in `window.rs`.

use context::{Part, SectionSource, State};
use kernel::Timestamp;

pub(crate) use crate::seed::seed;

/// The agent that compacts every other agent's history (Python
/// `registry.SUMMARIZER_AGENT`).
pub(crate) const SUMMARIZER: &str = "summarizer";

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

/// Replace a Dynamic section's content AND move its provenance with it — the
/// environment block is rebuilt from the injected clock every single call, so a
/// section claiming it was produced at time zero would be a stale fact about a
/// fresh one.
pub(crate) fn set_dynamic(paper: &mut State, id: &str, text: &str, at: Timestamp) {
    let s = find(paper, id);
    s.section.parts = vec![Part::Text { text: text.into() }];
    s.section.provenance.produced_at = at;
}

/// Append one turn to the history section.
pub(crate) fn push_history(paper: &mut State, role: &str, text: &str, at: Timestamp) {
    let s = find(paper, "history");
    s.section.parts.push(Part::Text {
        text: format!("{role}: {text}"),
    });
    s.section.provenance.produced_at = at;
}

/// The history section's entries, in order — the agent's WINDOW.
pub(crate) fn history(paper: &State) -> Vec<String> {
    paper
        .sources
        .iter()
        .find(|s| s.section.id.0 == "history")
        .map(|s| {
            s.section
                .parts
                .iter()
                .map(|p| match p {
                    Part::Text { text } => text.clone(),
                    other => format!("{other:?}"),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Replace the whole window — compaction, and restoring a stored log.
pub(crate) fn set_history(paper: &mut State, lines: &[String], at: Timestamp) {
    let s = find(paper, "history");
    s.section.parts = lines
        .iter()
        .map(|text| Part::Text { text: text.clone() })
        .collect();
    s.section.provenance.produced_at = at;
}

/// Adopt an agent's own file: the markdown body of `agent.md` IS this
/// agent's system prompt (the `soul` section), and its description is the
/// identity line. Nothing about `main` is hardcoded here afterwards — that
/// is what makes the `public/agents/` loader real rather than decorative.
/// `peers` are the other loaded agents, from which this one's `tools:` list
/// picks its sub-agents — so a change to the file changes the toolbox with no
/// rebuild, exactly as it changes the prompt.
pub fn adopt_spec(
    state: &mut crate::state::AgentState,
    spec: &crate::spec::AgentSpec,
    peers: &[crate::spec::AgentSpec],
) {
    state.model = spec.model.clone();
    // Naming the space IS the request: the tools come with it rather than
    // having to be listed too (Python `utils.load_agent`), and a name that
    // could walk out of `spaces/` attaches nothing at all.
    state.space = crate::space::Space::named(&spec.space);
    state.toolbox = crate::subagent::toolbox_for(spec, peers);
    (state.compact_at, state.keep_recent) = (spec.compact_at, spec.keep_recent);
    // The summarizer is an ordinary agent, found among the peers by name — the
    // Python registry gives it to every OTHER engine as the thing that compacts
    // a history, and to nobody as a tool (`registry.SUMMARIZER_AGENT`).
    if let Some(s) = peers.iter().find(|p| p.name == SUMMARIZER && p.name != spec.name) {
        state.summarizer_prompt = s.prompt.clone();
        state.summarizer_model = s.model.clone();
    }
    let soul = find(&mut state.paper, "soul");
    soul.section.parts = vec![Part::Text {
        text: spec.prompt.clone(),
    }];
    let identity = find(&mut state.paper, "identity");
    identity.section.parts = vec![Part::Text {
        text: format!("Name: {}. {}", spec.name, spec.description),
    }];
}
