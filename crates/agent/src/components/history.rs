//! The conversation so far.

/// WHAT A FRESH WINDOW HOLDS. Not the empty vector: the history block would
/// then render nothing, and `core::clear` needs to put a conversation BACK to
/// what a new one starts on rather than to something no new one has ever been.
pub const SESSION_STARTED: &str = "session started";

use context::{Component, Fidelity, Part, Slot, Stability};
use kernel::SectionId;

/// The transcript, one entry per turn, already tagged `role: text`.
///
/// Rendered as one `Part` per entry rather than one joined blob. That is not
/// an implementation detail: it is what lets compaction replace the window
/// wholesale, what lets the budget count turns rather than characters, and
/// what keeps `render` able to put a screenshot in the middle of a
/// conversation instead of only at its end.
///
/// Entries are separated by a blank line when rendered, because a transcript
/// packed line-to-line reads as one speaker to a model the same way it does
/// to a person.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct History {
    pub entries: Vec<String>,
}

impl Default for History {
    /// One marker entry, not an empty list. Two reasons, and both are load
    /// bearing: a section with no parts is rejected by the paper's own law
    /// (nothing is empty by default), and the window arithmetic that decides
    /// when to compact counts entries — starting at zero would move the
    /// trigger by one for every agent.
    fn default() -> Self {
        History {
            entries: vec![SESSION_STARTED.into()],
        }
    }
}

impl Component for History {
    fn id(&self) -> SectionId {
        SectionId("history".into())
    }
    fn slot(&self) -> Slot {
        Slot::HISTORY
    }
    fn intent(&self) -> String {
        "Conversation and prior steps, oldest first; the last line is the newest.".into()
    }
    fn stability(&self) -> Stability {
        Stability::Dynamic
    }
    fn floor(&self) -> Fidelity {
        Fidelity::Pointer
    }
    /// The highest number here, so the transcript is what the budget eats
    /// first. Everything else in the paper is either who the agent is or what
    /// it is doing now; the middle of a long conversation is the one part that
    /// can be summarised without the turn becoming incoherent.
    fn budget_priority(&self) -> u8 {
        9
    }
    fn cacheable(&self) -> bool {
        false
    }
    fn render(&self) -> Vec<Part> {
        self.entries
            .iter()
            .map(|text| Part::Text { text: text.clone() })
            .collect()
    }
}
