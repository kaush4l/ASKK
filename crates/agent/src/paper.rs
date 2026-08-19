//! The agent's live paper: rebuilding a section from its component, appending
//! to the window, and adopting an agent file. The components themselves live
//! in `components/`; the rolling window lives in `window.rs`.
//!
//! There is no longer a way to write a string into a section from outside the
//! component that owns it. That is the point: `set_text(paper, id, text)` let
//! any caller invent both the content and, implicitly, its shape — and the two
//! drifted, because nothing held them together. Now a caller can only hand
//! over a component, and the component decides how it reads.

use context::{Part, SectionSource, State};
use kernel::Timestamp;

pub(crate) use crate::components::seed;

/// The speaker a compaction call is attributed to. A LABEL on a model call,
/// not an agent: `window::compaction` builds the sheet itself, so nothing
/// looks this up in `public/agents/`.
pub(crate) const SUMMARIZER: &str = "summarizer";

/// The section owning `id`, or a panic. STRICT ON PURPOSE, and only for the
/// history writers: a window out of nowhere is a bug, not a feature.
fn find<'a>(paper: &'a mut State, id: &str) -> &'a mut SectionSource {
    paper
        .sources
        .iter_mut()
        .find(|s| s.section.id.0 == id)
        .expect("seeded section exists")
}

/// Rebuild one section from the component that owns it.
///
/// This is the seam that makes the component contract real at runtime rather
/// than only at seeding: the component renders itself, and its own declared
/// slot, stability and floor come with the parts, so a section can never be
/// shaped by one place and filled by another.
///
/// It UPSERTS: an id the seed never carried is APPENDED, which is what opens
/// the prompt to blocks that were not compiled into `seed()`. Appending is
/// safe because ORDERING IS STRUCTURAL — `assemble` sorts by `Section::slot`
/// and nothing else, stably, so a source's POSITION in `State.sources` never
/// reaches the prompt; the component's own `slot()` decides where it renders.
/// The cost: a typo'd id adds a block instead of panicking, and only a
/// COLLIDING one is still refused (`ContextError::DuplicateSection`).
pub(crate) fn set_component(paper: &mut State, c: &dyn context::Component, at: Timestamp) {
    let built = crate::components::source(c, at, paper.form);
    match paper.sources.iter_mut().find(|s| s.section.id == built.section.id) {
        Some(s) => *s = built,
        None => paper.sources.push(built),
    }
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
    state.temperature = spec.temperature;
    // Naming the space IS the request: the tools come with it rather than
    // having to be listed too (Python `utils.load_agent`), and a name that
    // could walk out of `spaces/` attaches nothing at all.
    state.space = crate::space::Space::named(&spec.space);
    state.toolbox = crate::subagent::toolbox_for(spec, peers);
    (state.compact_at, state.keep_recent) = (spec.compact_at, spec.keep_recent);
    state.max_rounds = spec.max_rounds;
    // THE LOOP THIS AGENT RUNS, from its own file and nowhere else (20).
    state.declared = spec.stages.clone();
    state.stages = spec.stages.clone();
    // …and how many times it may walk it (22).
    state.passes = spec.passes;
    // THE SUMMARIZER IS NOT AN AGENT ANY MORE. Compaction builds its own
    // sheet with its own prompt (`window::SUMMARIZE`) and runs on this agent's
    // model, so there is no peer to find and no role to hold. Three fields and
    // a lookup went with it.
    state.critic = critic_among(spec, peers);
    // The agent file IS the soul and the identity — rebuilt through the
    // components that own those shapes, so adopting a spec cannot produce a
    // section shaped differently from a seeded one.
    let soul = crate::components::Soul { text: spec.prompt.clone() };
    let identity = crate::components::Identity {
        name: spec.name.clone(),
        description: spec.description.clone(),
    };
    set_component(&mut state.paper, &soul, Timestamp(0));
    set_component(&mut state.paper, &identity, Timestamp(0));
}

/// WHO REVIEWS THIS AGENT'S WORK (25), by the job the file declares and not by
/// the name `critic` — 20's rule, for the same reason: a hardcoded name means
/// renaming the folder silently unhooks the machinery.
///
/// It is recorded even where this agent cannot CALL the critic, because the
/// field only decides whether a tool result is read as a verdict, and a result
/// can only arrive from a tool the allowlist already granted. An agent that is
/// itself the critic gets an empty name: nothing here reviews itself.
fn critic_among(
    spec: &crate::spec::AgentSpec,
    peers: &[crate::spec::AgentSpec],
) -> String {
    crate::loader::role_holder(peers, crate::spec::ROLE_CRITIC)
        .filter(|c| c.name != spec.name)
        .map(|c| c.name.clone())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    // `set_component` is `pub(crate)`: proved here, not widened for a test.
    use super::*;
    use context::{Budget, Component, Document, Slot, Stability};
    use kernel::{PhaseId, SectionId};
    /// A block the seed never heard of, live, at the observations slot.
    struct Note;
    impl Component for Note {
        fn id(&self) -> SectionId { SectionId("note".into()) }
        fn slot(&self) -> Slot { Slot::OBSERVATIONS }
        fn stability(&self) -> Stability { Stability::Volatile }
        fn render(&self) -> Vec<Part> { context::text("a note") }
        fn intent(&self) -> String { "what a late-attached block says".into() }
    }
    fn document(paper: &State) -> Document {
        context::assemble(paper, PhaseId::Work, Budget::unlimited())
    }
    /// The seeded paper plus a component never compiled into it.
    fn noted() -> Document {
        let mut paper = seed();
        set_component(&mut paper, &Note, Timestamp(0));
        document(&paper)
    }

    #[test]
    fn an_unseeded_component_renders_at_its_slot_not_where_it_was_appended() {
        let doc = noted();
        let ids: Vec<&str> = doc.sections.iter().map(|s| s.id.0.as_str()).collect();
        let at = ids.iter().position(|i| *i == "note").expect("it attached");
        assert_eq!(ids[at - 1], "observations", "slot 90 sorts among slot 90");
        assert_eq!(ids[at + 1], "directive", "…and ahead of slot 95, not last");
    }

    #[test]
    fn an_attached_component_still_makes_a_legal_document() {
        assert!(context::validate(&noted()).is_ok());
    }

    #[test]
    fn a_seeded_id_updates_in_place_rather_than_duplicating() {
        let mut paper = seed();
        let before = document(&paper).sections.len();
        set_component(&mut paper, &crate::components::OperatingRules, Timestamp(0));
        set_component(&mut paper, &crate::components::OperatingRules, Timestamp(0));
        assert_eq!(document(&paper).sections.len(), before);
    }
}
