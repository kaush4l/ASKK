//! The agent (§11, ADR-010): a pure step function walking a phase machine
//! whose phases are data. No I/O of any kind lives here — `step` describes
//! effects, the `core` runtime executes them (I3, I7). The forge pipeline is
//! agent behavior (Scout proposes, Forge master builds) and a built-in
//! module, not a privileged subsystem (ARCHITECTURE §1a, I9).
//!
//! G3 interface freeze: types and signatures only; bodies are `todo!()`.

mod answer;
mod brief;
mod author;
mod calls;
mod components;
mod critic;
mod now;
mod effect;
mod environment;
mod ending;
mod error;
mod faculty;
mod forge;
mod goal;
mod memory;
mod paper;
mod passes;
mod skills;
mod phase;
mod space;
mod reply;
mod ask;
mod search;
mod spec;
mod state;
mod steer;
mod step;
mod stages;
mod stop;
mod strategy;
mod subagent;
mod supervisor;
mod toolbox;
mod tools;
mod verify;
mod window;
mod workspace;

pub use calls::{has_calls, named, parse_batches, swallowed_close, Call};
pub use effect::Effect;
pub use toolbox::{Toolbox, NOTHING_RAN};
pub use tools::{builtin_tools, Tool, ToolResult};
pub use error::AgentError;
pub use forge::{forge_manifest, forge_step, Draft, ForgeRun, ForgeStage};
pub use phase::{
    v1_phases, ExitCondition, PhaseConfig, PhaseExit, ResponseContract, ToolScope, Verdict,
};
pub use paper::{adopt_briefs, adopt_spec};
pub use now::{clock, environment};
pub use crate::environment::{
    facts as guest_facts, lines as guest_lines, Fact as GuestFact, ABSENT as GUEST_ABSENT,
    BINARIES as GUEST_BINARIES, DURABLE as GUEST_DURABLE, MEMORY as GUEST_MEMORY,
};
pub use window::{compacted, due, set_window, transcript, window, SUMMARIZE, SUMMARY_HEADING};
pub use components::{memory_parts, space_parts, Block, Sensed, SharedSpace, SESSION_STARTED};
pub use faculty::{
    all as faculty_names, blocks_of, declared as declared_faculties, of as faculty_of, Faculty,
    MEMORY as MEMORY_FACULTY, SPACE as SPACE_FACULTY,
};
pub use memory::{is_memory_tool, memory_tools, Kept, Memory, MEMORY_LIMIT};
pub use space::{is_space_tool, space_tools, Change, Space, NOTE_LIMIT};
pub use search::{results as search_results, search_path, WEB_SEARCH};
pub use workspace::{is_workspace_tool, process_name, relative_path, workspace_tools};
pub use author::{new_spec, render_agent_file, usable_agent_name};
pub use spec::loader::{load_agents, role_holder};
pub use skills::{
    catalogue, instruction, parse_skill_file, skills, Skill, LIST_SKILLS, NONE_INSTALLED,
    READ_SKILL,
};
pub use critic::{passed as critic_passed, FAULT as CRITIC_FAULT, PASS as CRITIC_PASS};
pub use spec::{
    parse_agent_file, AgentSpec, ENGINE_BASE, ENGINE_REACT, ROLES, ROLE_CRITIC, ROLE_ENTRY,
};
pub use brief::{load as load_briefs, Briefs, BRIEF_KEYS, DURABLE as BRIEF_DURABLE};
pub use stages::{
    is_stage, route_of, stage_of, tools_on, ANSWER as STAGE_ANSWER,
    CRITIQUE as STAGE_CRITIQUE, PLAN as STAGE_PLAN, STAGES, STAGE_ENTERED, ROUTE_CHOSEN,
    VERIFY as STAGE_VERIFY, WORK as STAGE_WORK,
};
pub use strategy::{route_of as vote_of, Route, STRATEGY as STAGE_STRATEGY};
/// The stage a state is on — `tests/strategy.rs` asserts a turn opens on the vote.
pub fn current_stage(state: &AgentState) -> &str {
    stages::current(state)
}
pub use state::{AgentState, PlanStep};
pub use reply::{malformed_call, parse_reply, ParsedReply};
pub use ending::{
    ended_rounds, ended_why, ANSWERED, BRIEF_MISSING, CRITIC_FAULTED, ENDED, GOAL_UNMET,
    NO_ANSWER, PASS_CEILING, ROUND_CEILING, UNCHECKED,
};
pub use passes::{pass_of, PASS_SPENT};
pub use goal::fact::{checked_of, GOAL_CHECKED};
pub use goal::{Goal, Standing};
pub use steer::STEERED;
pub use verify::{is_mutating, says_nothing, VERIFY_NUDGED};
pub use step::step;
pub use stop::{rounds, STOPPED, STOP_REQUESTED};
pub use subagent::{goal_from, toolbox_for, unresolved_tools};
pub use supervisor::{AgentRow, Board};
