//! The PROMPT half of the artifacts faculty: what this group has produced,
//! read back to every agent in the space before every model call.

use std::rc::Rc;

use context::Part;
use kernel::{BoxFuture, KvStore};

use crate::faculty::{Sense, Sensing};
use crate::space::artifact::load;

/// The host half of `agent::faculty::artifact`'s perception. It holds the
/// SPACES store rather than a copy of the shelf, because a copy is a thing that
/// can be stale and a handle is not — `MemorySense`'s reason, one store over.
pub(crate) struct ArtifactSense {
    spaces: Rc<dyn KvStore>,
}

impl ArtifactSense {
    pub(crate) fn new(spaces: Rc<dyn KvStore>) -> ArtifactSense {
        ArtifactSense { spaces }
    }
}

impl Sense for ArtifactSense {
    fn faculty(&self) -> &'static str {
        agent::ARTIFACTS_FACULTY
    }

    /// One block, whose id is the faculty's own name.
    ///
    /// AN AGENT THAT NAMED NO SPACE HAS NO SHELF, and yields nothing. The
    /// artifacts faculty can be declared without a space — the table does not
    /// gate it the way `Space::named` gates the space faculty — and this is
    /// where that costs exactly one empty block and nothing else (I15). There is
    /// no error to report: a shelf belongs to a group, and an agent working
    /// alone is not in one.
    ///
    /// `of.tools` travels WITH the subject for the reason `SpaceSense` takes it:
    /// the block's closing line names calls by name, and a name the agent was
    /// never granted advertises a capability that is not there. This is the
    /// TOOLBOX-DERIVED half, and it is derived here rather than looked up by
    /// whoever renders the block.
    fn read<'a>(&'a self, of: &'a Sensing) -> BoxFuture<'a, Vec<(String, Vec<Part>)>> {
        Box::pin(async move {
            let Some(space) = of.space.as_ref() else {
                return Vec::new();
            };
            let shelf = load(self.spaces.as_ref(), &space.name).await;
            vec![(
                agent::ARTIFACTS_FACULTY.to_string(),
                agent::artifact_parts(&shelf, &of.tools),
            )]
        })
    }
}
