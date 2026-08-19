//! A block a HOST fills and a pure component renders: the one generic section.
//!
//! Every other component in this folder knows what it is ABOUT — the toolbox,
//! the clock, the transcript. This one knows only where it sits and what it is
//! for; the bytes arrive from outside the pure core. It is [`SharedSpace`]
//! with the subject removed: `core` refreshes `AgentState.space` before every
//! pass and `SharedSpace` renders it at `Slot::SPACE`; a host refreshes
//! `AgentState.senses[id]` before every pass and [`Sensed`] renders it at the
//! slot its faculty declared. The chrome agent's "latest page snapshot, always
//! included" is that sentence with one id substituted — not a new mechanism.
//!
//! [`SharedSpace`]: crate::components::SharedSpace

use context::{Component, Fidelity, Part, Slot, Stability};
use kernel::SectionId;

/// What a faculty declares about ONE block it contributes.
///
/// `&'static str` rather than `String` because a faculty is Rust compiled into
/// this binary and selected by name. There is no plugin loading here, and
/// adding some would be a second module system beside the one the repo has.
///
/// There is no `floor` field, and the absence is the design — see
/// [`Sensed::floor`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Block {
    /// The section id, which is also the key the host writes under.
    pub id: &'static str,
    /// Where in the prompt this block renders. The faculty's choice, and the
    /// reason a page snapshot can sit beside the observations while a persona
    /// note sits up in the cacheable head.
    pub slot: Slot,
    /// One sentence: the question this block answers for the model.
    pub intent: &'static str,
    /// DECLARED, never derived, because it is a real authorial choice bound to
    /// the slot: a block sorting after `observations` must say `Volatile` or
    /// `context::validate` rejects the whole document with
    /// `InterleavedStability`. The cacheable head stays stability-monotonic,
    /// and only the author of the block knows which side of it they meant.
    pub stability: Stability,
}

/// One block of sensed state, as the prompt sees it. The declaration plus the
/// parts a host most recently left for it — and nothing else, because a
/// component is a value rebuilt from live state and holds none of its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sensed {
    pub block: Block,
    pub parts: Vec<Part>,
}

impl Component for Sensed {
    fn id(&self) -> SectionId {
        SectionId(self.block.id.into())
    }
    fn slot(&self) -> Slot {
        self.block.slot
    }
    fn intent(&self) -> String {
        self.block.intent.into()
    }
    fn stability(&self) -> Stability {
        self.block.stability
    }
    /// Elided, unconditionally, and that is why [`Block`] carries no floor to
    /// override it with. A sensed block is state a host MAY NOT HAVE WRITTEN —
    /// every capability may be absent (I15) — so it can always render nothing,
    /// and `assemble` starts a partless section at `Fidelity::Elided`
    /// (`crates/context/src/assemble.rs:110`), which `context::validate`
    /// rejects as `BelowFloor` against any higher floor. A declarable floor
    /// would therefore be a field whose every other value makes the first
    /// unwritten block an illegal document. Unrepresentable beats checked.
    fn floor(&self) -> Fidelity {
        Fidelity::Elided
    }
    /// A Volatile block can never be cached — a cached snapshot is a stale
    /// snapshot, the same reason a cached clock is a wrong clock. Anything
    /// steadier than that keeps the prefix-cache property its slot was chosen
    /// for. Derived rather than declared: there is no honest case for a
    /// Volatile block that caches, or a SemiStatic one that cannot — and
    /// `Component::section` (`crates/context/src/component.rs:149`) dates a
    /// cacheable section `Timestamp(0)`, so a constant `false` would stamp the
    /// shared space differently from the component it replaced.
    fn cacheable(&self) -> bool {
        self.block.stability != Stability::Volatile
    }
    /// 6: one past the trait's default, because lower survives longer and this
    /// is the most disposable block in the paper. Dropping a settled fact loses
    /// something nothing will rewrite; dropping a sense costs one turn of
    /// sight, and the host refreshes it before the next call anyway.
    fn budget_priority(&self) -> u8 {
        6
    }
    fn render(&self) -> Vec<Part> {
        self.parts.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paper::{seed, set_component};
    use context::{Budget, Document, State};
    use kernel::{PhaseId, Timestamp};

    /// A faculty's declaration, at the one slot a Volatile block may sit.
    const PAGE: Block = Block {
        id: "page",
        slot: Slot::OBSERVATIONS,
        intent: "what the page in front of this agent currently shows",
        stability: Stability::Volatile,
    };

    fn document(paper: &State) -> Document {
        context::assemble(paper, PhaseId::Work, Budget::unlimited())
    }

    /// The seeded paper with one sensed block attached, appended LAST.
    fn sensed(parts: Vec<Part>) -> Document {
        let mut paper = seed();
        let block = Sensed { block: PAGE, parts };
        set_component(&mut paper, &block, Timestamp(0));
        document(&paper)
    }

    #[test]
    fn a_block_no_host_ever_wrote_still_makes_a_legal_document() {
        let doc = sensed(Vec::new());
        assert!(
            context::validate(&doc).is_ok(),
            "an unwritten sense must elide, not poison the paper"
        );
    }

    #[test]
    fn a_written_block_renders_at_its_declared_slot_not_where_it_was_appended() {
        let doc = sensed(context::text("a button labelled Send"));
        assert!(context::validate(&doc).is_ok());
        let ids: Vec<&str> = doc.sections.iter().map(|s| s.id.0.as_str()).collect();
        let at = ids.iter().position(|i| *i == "page").expect("it attached");
        assert_eq!(ids[at - 1], "observations", "slot 90 sorts among slot 90");
        assert_eq!(ids[at + 1], "directive", "…and ahead of slot 95, not last");
        assert_eq!(
            doc.sections[at].parts,
            context::text("a button labelled Send")
        );
    }

    /// THE RULE BOTH WAYS, and the provenance it decides. Pinning one
    /// direction would pass against the constant `false` this replaced.
    #[test]
    fn caching_follows_the_stability_the_block_declared() {
        let at = Timestamp(1_753_800_000_000);
        let stamp = |c: &Sensed| c.section(at, context::Form::DEFAULT).provenance.produced_at;
        let moving = Sensed { block: PAGE, parts: context::text("moving") };
        let steady = Sensed {
            block: Block { stability: Stability::SemiStatic, ..PAGE },
            parts: context::text("settled"),
        };
        assert!(!moving.cacheable(), "a snapshot cached is a snapshot stale");
        assert!(steady.cacheable(), "…and the cacheable head stays cacheable");
        assert_eq!(stamp(&moving), at, "uncacheable is dated");
        assert_eq!(stamp(&steady), Timestamp(0), "…and cacheable is time zero");
    }

    /// I11: a paused agent resumes with its senses, or the field is a lie.
    #[test]
    fn faculties_and_senses_survive_a_round_trip_through_serde() {
        let mut before = crate::state::AgentState::new();
        before.faculties = vec!["browser".into()];
        before.senses.insert(
            "page".into(),
            vec![Part::Image {
                media_type: "image/png".into(),
                data_base64: "iVBOR".into(),
            }],
        );
        let json = serde_json::to_string(&before).expect("state serializes");
        let after: crate::state::AgentState =
            serde_json::from_str(&json).expect("state deserializes");
        assert_eq!(after.faculties, before.faculties);
        assert_eq!(after.senses, before.senses);
    }

    /// The two `#[serde(default)]`s: a stored state written before the keys
    /// existed still loads, which is what makes them additive (I11).
    #[test]
    fn a_state_stored_before_the_keys_existed_still_loads() {
        let json = serde_json::to_string(&crate::state::AgentState::new()).unwrap();
        let mut map: serde_json::Value = serde_json::from_str(&json).unwrap();
        let object = map.as_object_mut().expect("state is an object");
        object.remove("faculties").expect("the key was written");
        object.remove("senses").expect("the key was written");
        let old: crate::state::AgentState =
            serde_json::from_value(map).expect("an older state still loads");
        assert!(old.faculties.is_empty() && old.senses.is_empty());
    }
}
