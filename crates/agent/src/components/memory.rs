//! THE WORDS MEMORY IS WRITTEN IN: the lines this one agent chose to keep.
//!
//! It is not a `Component`. Memory is a FACULTY (`crate::faculty::memory`),
//! which declares the block — id, slot, intent, stability — and
//! `components::Sensed` renders whatever a host most recently wrote for it.
//! What lives here is the VOCABULARY, in one place, exactly as
//! `space_parts` holds the space's (`crates/agent/src/components/space.rs:52`).
//!
//! There is no header, no count and no apology around the lines. The block
//! already carries its own `## memory` heading and its intent sentence from
//! `context::render`, and every word spent restating that is a word of budget
//! not spent on what was actually kept.

use context::{text, Part};

use crate::memory::Memory;

/// The parts a host leaves in `AgentState.senses["memory"]` for
/// `components::Sensed` to render.
///
/// EMPTY when nothing is kept, and that is the whole rule: emptiness becomes
/// `Fidelity::Elided` (`assemble` starts a partless section there,
/// `crates/context/src/assemble.rs:110`), so an agent that has kept nothing
/// gets no heading and no blank section rather than a paragraph saying so.
/// Every capability may be absent (I15), and this is how the paper spells it.
///
/// One list, one dash per line, and no ad-hoc string building beyond it (I13):
/// the lines are the agent's own words and this only arranges them.
pub fn memory_parts(memory: &Memory) -> Vec<Part> {
    if memory.notes.is_empty() {
        return Vec::new();
    }
    let lines: Vec<String> = memory.notes.iter().map(|note| format!("- {note}")).collect();
    text(lines.join("\n"))
}
