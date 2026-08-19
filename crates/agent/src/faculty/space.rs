//! THE FIRST FACULTY, and the proof the seam is a generalisation rather than a
//! new thing beside the old one.
//!
//! Every field below is COPIED from what `components::SharedSpace` declared
//! when it was a component of its own, because the migration has to be inert:
//! the same id, the same slot, the same intent sentence and the same stability
//! render the same section, and `tests/prompt.rs` is the byte-for-byte proof.
//! The tools are what `subagent::with_the_space` returned — the space's three
//! and the workspace's set, which arrive together because the folder is the
//! space's (ADR-006, default deny: no space, no workspace).

use context::{Slot, Stability};

use super::Faculty;
use crate::components::Block;

/// The faculty's name, which is also its block's id and the key a host writes
/// its rendered parts under in `AgentState.senses`. One string, three jobs, so
/// they cannot drift apart.
pub const SPACE: &str = "space";

/// The one block this faculty contributes.
///
/// `SemiStatic`, and slotted ahead of the clock for that reason: a group's
/// facts change on the scale of a session, not of a turn, so the block belongs
/// inside the cacheable head — above the one section that can never be cached
/// rather than behind it.
const BLOCK: Block = Block {
    id: SPACE,
    slot: Slot::SPACE,
    intent: "The folder this group shares, what it has settled, what it has posted.",
    stability: Stability::SemiStatic,
};

/// The space faculty: what naming a space brings with it.
pub(super) fn faculty() -> Faculty {
    Faculty {
        name: SPACE,
        tools: [crate::space::space_tools(), crate::workspace::workspace_tools()].concat(),
        blocks: vec![BLOCK],
    }
}
