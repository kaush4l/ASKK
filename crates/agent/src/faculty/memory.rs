//! THE SECOND FACULTY, and the first one that is not a rename of something the
//! system already had. `space` was `space:` generalised — the same block, the
//! same tools, byte-for-byte inert. This one adds a capability, from a row in a
//! table and a word in an agent file, with no edit to `components::dynamic`, no
//! edit to the toolbox and no new mechanism. That is the seam's claim, tested.
//!
//! What it is, and why it is not part of `space`:
//!
//! 1. An agent that names NO space can declare it. The space faculty is
//!    declared only when `Space::named` resolves (`super::declared`), so
//!    without a folder there is nowhere to keep anything at all.
//! 2. It is PRIVATE to one agent; a space is shared by everyone who names it,
//!    and its board is read inside all of their prompts rather than one.
//! 3. It brings NO workspace and no Linux with it (ADR-006, default deny) —
//!    two tools and one block, and nothing arrives alongside.
//!
//! The full argument, and the two places the product already named this hole,
//! are in `crate::memory`.

use context::{Slot, Stability};

use super::Faculty;
use crate::components::Block;

/// The faculty's name, which is also its block's id and the key a host writes
/// its rendered parts under in `AgentState.senses`. One string, three jobs, so
/// they cannot drift apart.
pub const MEMORY: &str = "memory";

/// The one block this faculty contributes, at the slot that was declared for
/// it and never filled (`crates/context/src/slot.rs:47`).
///
/// `SemiStatic`, and above the clock for that reason: a line an agent chose to
/// keep changes on the scale of a decision, not of a turn, so it belongs inside
/// the cacheable head. Slot and stability are ONE choice — anything at or after
/// `observations` must declare `Volatile` or the document is illegal, which is
/// what `tests/faculty.rs` checks once for every faculty rather than per author.
const BLOCK: Block = Block {
    id: MEMORY,
    slot: Slot::MEMORY,
    intent: "What you chose to keep, across every conversation you have had.",
    stability: Stability::SemiStatic,
};

/// The memory faculty: what naming it brings with it, and all of what it does.
pub(super) fn faculty() -> Faculty {
    Faculty {
        name: MEMORY,
        tools: crate::memory::memory_tools(),
        blocks: vec![BLOCK],
    }
}
