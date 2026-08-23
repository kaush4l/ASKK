//! THE THIRD FACULTY, and the first one whose state is SHARED and whose subject
//! is neither a folder nor a private line: what this group has PRODUCED.
//!
//! Why it is not part of `space`, which is the obvious place to put it:
//!
//! 1. A space's facts and notes are things agents SAY to each other; an
//!    artifact is a thing they MADE, and the two have different lifetimes. A
//!    note falls off the board at `NOTE_LIMIT`; a deliverable may not.
//! 2. It is declarable on its own. An agent that names a space gets the shelf
//!    only if it also names this faculty, so a read-only agent with a folder
//!    and no shelf is representable (ADR-006, default deny).
//! 3. Its block answers a different question, so it is a different section:
//!    `## space` says where the group works and what it has settled, this says
//!    what came out of that work and who it is for.
//!
//! The full argument, and the cross-thread ruling this faculty rests on, are in
//! `crate::artifact`.

use context::{Slot, Stability};

use super::Faculty;
use crate::components::Block;

/// The one block this faculty contributes, at `Slot(57)` — between the space it
/// belongs to (`Slot::SPACE`, 55) and the clock (`Slot::ENVIRONMENT`, 60). The
/// gaps of ten exist for exactly this (`crates/context/src/slot.rs:14-18` names
/// an artifacts block as the worked example), so nothing is renumbered.
///
/// `SemiStatic`, and inside the cacheable head for that reason: a deliverable
/// changes on the scale of a piece of work, not of a turn. Slot and stability
/// are ONE choice — anything at or after `observations` must declare `Volatile`
/// or the document is illegal, which `tests/faculty.rs` checks for every
/// faculty rather than per author.
const BLOCK: Block = Block {
    id: crate::artifact::ARTIFACTS_FACULTY,
    slot: Slot(57),
    intent: "What this group has produced that outlives a turn, and who each piece is for.",
    stability: Stability::SemiStatic,
};

/// The artifacts faculty: two tools and one block, and nothing arrives
/// alongside — no workspace, no shell, no folder (ADR-006, default deny).
pub(super) fn faculty() -> Faculty {
    Faculty {
        name: crate::artifact::ARTIFACTS_FACULTY,
        tools: crate::artifact::artifact_tools(),
        blocks: vec![BLOCK],
    }
}
