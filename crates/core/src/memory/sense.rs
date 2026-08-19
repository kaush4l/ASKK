//! The PROMPT half of the memory faculty: the kept lines, read back to the
//! agent before every model call.

use std::rc::Rc;

use context::Part;
use kernel::{BoxFuture, StorePort};

use crate::faculty::{Sense, Sensing};
use crate::memory::load;

/// The host half of `agent::faculty::memory`'s perception. It holds the store
/// rather than a copy of the memory, because a copy is a thing that can be
/// stale and a handle is not.
pub(crate) struct MemorySense {
    store: Rc<dyn StorePort>,
}

impl MemorySense {
    pub(crate) fn new(store: Rc<dyn StorePort>) -> MemorySense {
        MemorySense { store }
    }
}

impl Sense for MemorySense {
    fn faculty(&self) -> &'static str {
        agent::MEMORY_FACULTY
    }

    /// One block, whose id is the faculty's own name — `agent::faculty::memory`
    /// makes that one string do all three jobs so they cannot drift.
    ///
    /// **ONE READER, AND THAT IS THE ONE WAY THIS IS BETTER ARRANGED THAN THE
    /// SPACE.** The space needs two host paths: `space::shared::refresh`
    /// re-reads the store into `AgentState.space`, which is the state the space
    /// TOOLS read, and `SpaceSense` then renders that field for the PROMPT —
    /// two steps, in that order, at the top of every pass
    /// (`crates/core/src/runtime/mod.rs:58-59`). Memory needs only this sense:
    /// `memory::host` reads the store itself on every call, so there is no
    /// field in `AgentState` to keep in step with the store and nothing that
    /// can disagree with it.
    ///
    /// An agent that has kept nothing yields no parts and therefore no section
    /// — `memory_parts`' own rule (`crates/agent/src/components/memory.rs:29`),
    /// and the same degradation any absent capability gets (I15).
    fn read<'a>(&'a self, _of: &'a Sensing) -> BoxFuture<'a, Vec<(String, Vec<Part>)>> {
        Box::pin(async move {
            let memory = load(self.store.kv()).await;
            vec![(
                agent::MEMORY_FACULTY.to_string(),
                agent::memory_parts(&memory),
            )]
        })
    }
}
