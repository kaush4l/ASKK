//! What is known about the person, and what was kept from before.

use context::{text, Component, Fidelity, Part, Slot, Stability};
use kernel::SectionId;

/// Durable facts about the person this agent works for.
///
/// Renders as one fact per line rather than prose: these are looked up, not
/// read, and a model scanning for "what city do they live in" should find a
/// line, not a sentence buried in a paragraph.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct User {
    pub facts: Vec<(String, String)>,
}

impl Component for User {
    fn id(&self) -> SectionId {
        SectionId("user".into())
    }
    fn slot(&self) -> Slot {
        Slot::User
    }
    fn intent(&self) -> String {
        "Durable facts about the person.".into()
    }
    fn stability(&self) -> Stability {
        Stability::SemiStatic
    }
    fn floor(&self) -> Fidelity {
        Fidelity::Pointer
    }
    fn budget_priority(&self) -> u8 {
        4
    }
    fn render(&self) -> Vec<Part> {
        match self.facts.is_empty() {
            true => text("No durable user facts recorded yet."),
            false => text(lines(&self.facts)),
        }
    }
}

/// Knowledge retained across sessions.
///
/// Each entry is dated, because a remembered fact without a date is a fact the
/// model cannot tell is stale — and a confidently stated stale fact is worse
/// than an absent one.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct Memory {
    pub entries: Vec<(String, String)>,
}

impl Component for Memory {
    fn id(&self) -> SectionId {
        SectionId("memory".into())
    }
    fn slot(&self) -> Slot {
        Slot::Memory
    }
    fn intent(&self) -> String {
        "Retained knowledge across sessions.".into()
    }
    fn stability(&self) -> Stability {
        Stability::SemiStatic
    }
    fn floor(&self) -> Fidelity {
        Fidelity::Elided
    }
    fn budget_priority(&self) -> u8 {
        6
    }
    fn render(&self) -> Vec<Part> {
        match self.entries.is_empty() {
            true => text("First session; no memory retained yet."),
            false => text(lines(&self.entries)),
        }
    }
}

/// `- key: value` per pair. The dash matters: it tells the model these are a
/// list of separate facts rather than one statement that happens to wrap.
fn lines(pairs: &[(String, String)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("- {k}: {v}"))
        .collect::<Vec<_>>()
        .join("\n")
}
