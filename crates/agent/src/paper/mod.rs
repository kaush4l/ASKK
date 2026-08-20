//! The agent's live paper: rebuilding a section from its component, and
//! appending to the window. The components themselves live in `components/`;
//! the rolling window lives in `window.rs`; writing a whole agent file onto a
//! state is [`adopt`], which is the one caller here that is about an AGENT
//! rather than about a page.
//!
//! There is no longer a way to write a string into a section from outside the
//! component that owns it. That is the point: `set_text(paper, id, text)` let
//! any caller invent both the content and, implicitly, its shape — and the two
//! drifted, because nothing held them together. Now a caller can only hand
//! over a component, and the component decides how it reads.

mod adopt;

use context::{Part, SectionSource, State};
use kernel::Timestamp;

pub(crate) use crate::components::seed;
pub use adopt::{adopt_briefs, adopt_spec};

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
