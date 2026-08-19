//! The toolbox, as the model is told about it.
//!
//! This component carries pre-rendered usage lines rather than the `Tool`
//! values themselves. Tools hold behaviour; a component is a value, and the
//! only thing the prompt ever needed from a tool was the one line describing
//! how to call it. Keeping the line and dropping the tool is what makes the
//! component hashable, comparable and cheap to rebuild every turn.

use context::{text, Component, Fidelity, Part, Slot, Stability};
use kernel::SectionId;

/// What exists and how to call it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct Affordances {
    /// One `name(args): description` line per tool, in toolbox order.
    pub usages: Vec<String>,
}

impl Affordances {
    pub fn new(usages: Vec<String>) -> Self {
        Affordances { usages }
    }

    /// This block as flat text. For callers that want the words rather than
    /// the section — the toolbox's own `instructions`, and the tests that read
    /// what the model was shown.
    pub fn text(&self) -> String {
        self.render()
            .iter()
            .filter_map(|p| match p {
                Part::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

/// How to write calls. Kept as a constant beside the component that emits it
/// because the reply parser is built to this exact description — the sentence
/// and the parser are one contract in two places, and they must move together.
const HOW_TO_CALL: &str = "Call them exactly as written above. Calls that do not depend on \
     each other go on one line, separated by commas, and run at the same time. A call that \
     needs an earlier call's result goes on its own line — lines run in order, top to \
     bottom. Results come back labelled with the tool name, in the order you wrote the calls.";

impl Component for Affordances {
    fn id(&self) -> SectionId {
        SectionId("affordances".into())
    }
    fn slot(&self) -> Slot {
        Slot::AFFORDANCES
    }
    fn intent(&self) -> String {
        "What exists and how to call it.".into()
    }
    /// SemiStatic, and slotted ahead of the transcript for that reason: an
    /// agent's toolbox changes far less often than its conversation, so it
    /// belongs inside the cacheable head rather than behind the part of the
    /// prompt that changes every single turn.
    fn stability(&self) -> Stability {
        Stability::SemiStatic
    }
    fn floor(&self) -> Fidelity {
        Fidelity::Pointer
    }
    fn budget_priority(&self) -> u8 {
        3
    }

    /// The signature block. Nothing here is prose about tools — it is the
    /// literal shape of a call, one per line, followed by the rules for
    /// ordering them. A model copies what it sees; showing it a JSON schema
    /// and asking for a call is a translation step that buys nothing.
    fn render(&self) -> Vec<Part> {
        if self.usages.is_empty() {
            return text("No tools are installed; answer from what you know.");
        }
        text(format!(
            "AVAILABLE TOOLS\n\n{}\n\n{HOW_TO_CALL}",
            self.usages.join("\n")
        ))
    }
}
