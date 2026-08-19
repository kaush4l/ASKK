//! What this turn, specifically, is being asked to do.
//!
//! Stage briefs used to be pushed into the transcript as `user:` turns wrapped
//! in square brackets. Three things were wrong with that, and the brackets are
//! the tell — they were there to mark text as not-really-a-turn inside a
//! structure that had no way to say so:
//!
//! 1. The person never said it. A prompt whose transcript contains turns
//!    nobody took is a prompt that lies about its own history.
//! 2. It stayed. A brief written on the plan stage was still sitting in the
//!    window ten turns later, competing with the instruction for the stage
//!    actually being run.
//! 3. It was compacted away, because it looked like conversation and
//!    conversation is what compaction eats — so the goal had to be copied into
//!    the shared space to survive its own prompt.
//!
//! As a component it is rebuilt each turn from the stage the agent is on, so
//! it is always the current instruction and never an old one, and compaction
//! cannot reach it because it is not part of the conversation.

use context::{text, Component, Fidelity, Part, Slot, Stability};
use kernel::SectionId;

/// The instruction for the stage being entered. Empty on stages that have
/// none — `work` has nothing to add, because the person's own request is the
/// instruction and a second one would compete with it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct Directive {
    pub text: String,
}

impl Component for Directive {
    fn id(&self) -> SectionId {
        SectionId("directive".into())
    }
    /// After the observations and immediately before the response contract:
    /// the last thing read before the shape of the reply, because it is what
    /// the reply is supposed to do.
    fn slot(&self) -> Slot {
        Slot::DIRECTIVE
    }
    fn intent(&self) -> String {
        "What to do on this turn, before replying.".into()
    }
    fn stability(&self) -> Stability {
        Stability::Volatile
    }
    /// Elided when absent, and never degraded when present: an instruction
    /// summarised down to its gist is an instruction the model will follow
    /// approximately.
    fn floor(&self) -> Fidelity {
        Fidelity::Elided
    }
    fn budget_priority(&self) -> u8 {
        1
    }
    fn cacheable(&self) -> bool {
        false
    }
    fn render(&self) -> Vec<Part> {
        text(self.text.trim())
    }
}
