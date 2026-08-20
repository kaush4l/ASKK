//! The space, as an ORDINARY SENSE — the first user of the faculty port, and
//! the reason the port is one mechanism rather than a second one.
//!
//! This is a migration, not a feature. `shared::refresh` used to write
//! `AgentState.senses["space"]` by hand, with a comment saying it was interim;
//! the bytes it wrote are the bytes this writes, so the prompt does not move
//! (`crates/agent/tests/prompt.rs` is the byte-for-byte proof). What changed
//! is WHO writes them: the oldest faculty now arrives through the same door a
//! browser faculty would, and a faculty keeping a private path beside that
//! door would make the port a duplicate of what `space:` already did.
//!
//! It senses nothing itself. `shared::refresh` runs first in `runtime::drive`
//! and re-reads the store into `AgentState.space` — the state the space TOOLS
//! read — and this renders that same state for the PROMPT. Two readers of one
//! fact, which is what stops the two from disagreeing.

use context::Part;
use kernel::BoxFuture;

use crate::faculty::{Sense, Sensing};

/// The host half of `agent::faculty::space`. A unit struct: everything it
/// needs arrives in [`Sensing`], so there is no handle to hold and no state
/// that could go stale between passes.
pub(crate) struct SpaceSense;

impl Sense for SpaceSense {
    fn faculty(&self) -> &'static str {
        agent::SPACE_FACULTY
    }

    /// One block, whose id is the faculty's own name — the string
    /// `agent::faculty::space::SPACE` is deliberately all three of the
    /// faculty name, the block id and this key, so they cannot drift.
    ///
    /// An agent with no space yields no parts and therefore no section: that
    /// is `space_parts`' own rule (`crates/agent/src/components/space.rs:63`),
    /// and it is the same degradation any absent capability gets (I15).
    ///
    /// The TOOLBOX goes with the space for the same invariant one step in:
    /// the paragraph names the tools that reach into that folder, and an agent
    /// holding none of them must be told about a folder and not about calls it
    /// cannot make. Both facts arrive in [`Sensing`], so this still holds no
    /// state and still reads nothing itself.
    fn read<'a>(&'a self, of: &'a Sensing) -> BoxFuture<'a, Vec<(String, Vec<Part>)>> {
        Box::pin(async move {
            vec![(
                agent::SPACE_FACULTY.to_string(),
                agent::space_parts(&of.space, &of.tools),
            )]
        })
    }
}
