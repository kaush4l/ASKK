//! The agent (§11, ADR-010): a pure step function walking a phase machine
//! whose phases are data. No I/O of any kind lives here — `step` describes
//! effects, the `core` runtime executes them (I3, I7). The forge pipeline is
//! agent behavior (Scout proposes, Forge master builds) and a built-in
//! module, not a privileged subsystem (ARCHITECTURE §1a, I9).
//!
//! G3 interface freeze: types and signatures only; bodies are `todo!()`.

mod answer;
mod defaults;
mod author;
mod calls;
mod now;
mod effect;
mod ending;
mod error;
mod forge;
mod paper;
mod seed;
mod phase;
mod space;
mod reply;
mod ask;
mod loader;
mod spec;
mod state;
mod steer;
mod step;
mod stages;
mod stop;
mod subagent;
mod supervisor;
mod toolbox;
mod tools;
mod verify;
mod window;
mod workspace;
mod yaml;

pub use calls::{has_calls, named, parse_batches, swallowed_close, Call};
pub use effect::Effect;
pub use toolbox::{Toolbox, NOTHING_RAN};
pub use tools::{builtin_tools, Tool, ToolResult};
pub use error::AgentError;
pub use forge::{forge_manifest, forge_step, Draft, ForgeRun, ForgeStage};
pub use phase::{
    v1_phases, ExitCondition, PhaseConfig, PhaseExit, ResponseContract, ToolScope, Verdict,
};
pub use paper::adopt_spec;
pub use now::{clock, environment};
pub use window::{compacted, due, set_window, transcript, window, SUMMARY_HEADING};
pub use space::{is_space_tool, space_tools, Change, Space, NOTE_LIMIT};
pub use workspace::{is_workspace_tool, process_name, relative_path, workspace_tools};
pub use author::{new_spec, render_agent_file, usable_agent_name};
pub use loader::{load_agents, role_holder};
pub use spec::{parse_agent_file, AgentSpec, ENGINE_BASE, ENGINE_REACT, ROLE_ENTRY, ROLE_SUMMARIZER};
pub use stages::{
    brief, is_stage, stage_of, tools_on, CRITIQUE as STAGE_CRITIQUE, PLAN as STAGE_PLAN,
    STAGES, STAGE_ENTERED, VERIFY as STAGE_VERIFY, WORK as STAGE_WORK,
};
pub use state::{AgentState, PlanStep};
pub use reply::{malformed_call, parse_reply, ParsedReply};
pub use ending::{
    ended_rounds, ended_why, ANSWERED, ENDED, NO_ANSWER, ROUND_CEILING, UNCHECKED,
};
pub use steer::STEERED;
pub use verify::{is_mutating, says_nothing, VERIFY_NUDGED};
pub use step::step;
pub use stop::{rounds, STOPPED, STOP_REQUESTED};
pub use subagent::{goal_from, toolbox_for, unresolved_tools};
pub use supervisor::{AgentRow, Board};
