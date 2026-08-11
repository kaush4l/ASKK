//! The agent (§11, ADR-010): a pure step function walking a phase machine
//! whose phases are data. No I/O of any kind lives here — `step` describes
//! effects, the `core` runtime executes them (I3, I7). The forge pipeline is
//! agent behavior (Scout proposes, Forge master builds) and a built-in
//! module, not a privileged subsystem (ARCHITECTURE §1a, I9).
//!
//! G3 interface freeze: types and signatures only; bodies are `todo!()`.

mod calls;
mod effect;
mod error;
mod forge;
mod paper;
mod phase;
mod reply;
mod spec;
mod state;
mod step;
mod subagent;
mod supervisor;
mod toolbox;
mod tools;

pub use calls::{has_calls, parse_batches, Call};
pub use effect::Effect;
pub use toolbox::Toolbox;
pub use tools::{builtin_tools, Tool, ToolResult};
pub use error::AgentError;
pub use forge::{forge_manifest, forge_step, Draft, ForgeRun, ForgeStage};
pub use phase::{
    v1_phases, ExitCondition, PhaseConfig, PhaseExit, ResponseContract, ToolScope, Verdict,
};
pub use paper::adopt_spec;
pub use spec::{load_agents, parse_agent_file, AgentSpec};
pub use state::{AgentState, PlanStep};
pub use reply::{parse_reply, ParsedReply};
pub use step::step;
pub use subagent::{goal_from, toolbox_for};
pub use supervisor::{AgentRow, Board};
