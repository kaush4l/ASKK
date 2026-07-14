//! Engine-side delegation — deliberately under `run/`, not `tools/`: these
//! tools hold a `Weak<Shared>` into the live engine and drive nested child
//! runs through the same turn loop as the parent. The authority-narrowing
//! invariant (child toolset = parent ∩ child, depth capped) lives here.
//!
//! - [`delegate`] — agent-as-tool seam: `DelegateTool` / `HandoffTool` /
//!   `TeamTool` (ADR-004/030/032).
//! - [`loops`] — multi-loop orchestration: spawn/check/wait/steer/cancel_run
//!   (ADR-022).
//! - [`spawn`] — `spawn_agent`, runtime specialization of a roster base
//!   (ADR-034).

pub mod delegate;
pub mod loops;
pub mod spawn;

pub use delegate::{DelegateTool, HandoffTool, TeamTool};
pub use spawn::SpawnAgentTool;
