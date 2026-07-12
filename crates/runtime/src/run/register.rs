//! Session tool registration: every enabled agent/team becomes a delegate
//! tool, plus the reserved-name session tools (loops, handoff, skill
//! discovery, spawn_agent). Split from session.rs for the file cap (ADR-012).

use std::cell::RefCell;
use std::rc::Weak;

use crate::config::{AgentConfig, SkillConfig, TeamConfig};
use crate::delegate::{DelegateTool, HandoffTool, TeamTool};
use crate::run::session::Shared;
use crate::tools::spawn::SpawnAgentTool;
use crate::tools::ToolRegistry;
use std::rc::Rc;

/// Register the whole session tool surface; config problems accumulate
/// instead of failing fast (one error, all problems — ADR-007).
pub(crate) fn register_session_tools(
    weak: &Weak<Shared>,
    registry: &mut ToolRegistry,
    agents: &[AgentConfig],
    teams: &[TeamConfig],
    skills: &[SkillConfig],
    problems: &RefCell<Vec<String>>,
) {
    for agent in agents.iter().filter(|a| a.enabled) {
        if let Err(e) = registry.register(Rc::new(DelegateTool::new(weak.clone(), agent))) {
            problems.borrow_mut().push(format!(
                "{}: cannot register agent as delegate tool: {e}",
                agent.source_path
            ));
        }
    }
    // Teams are delegate tools too (ADR-032): one per enabled team,
    // sharing the agent id namespace (validate rejects collisions).
    for team in teams.iter().filter(|t| t.enabled) {
        if let Err(e) = registry.register(Rc::new(TeamTool::new(weak.clone(), team))) {
            problems.borrow_mut().push(format!(
                "{}: cannot register team as delegate tool: {e}",
                team.source_path
            ));
        }
    }
    // Loop management tools (spawn/check/wait/steer/cancel) — their
    // names are reserved beside agent ids in the one registry.
    for tool in crate::loops::loop_tools(weak.clone()) {
        if let Err(e) = registry.register(tool) {
            problems
                .borrow_mut()
                .push(format!("cannot register loop tool: {e}"));
        }
    }
    // Handoff (full transfer) — same reserved-name rule.
    if let Err(e) = registry.register(Rc::new(HandoffTool::new(weak.clone()))) {
        problems
            .borrow_mut()
            .push(format!("cannot register handoff tool: {e}"));
    }
    // Skill discovery (progressive disclosure): skill_list is the
    // cheap index, skill_read loads one body on demand. Opt-in via
    // explicit `tools:` frontmatter only — no env preset.
    if let Err(e) = crate::tools::register_skills(registry, skills) {
        problems
            .borrow_mut()
            .push(format!("cannot register skill tools: {e}"));
    }
    // spawn_agent (runtime specialization) — same reserved-name rule.
    if let Err(e) = registry.register(Rc::new(SpawnAgentTool::new(weak.clone()))) {
        problems
            .borrow_mut()
            .push(format!("cannot register spawn_agent tool: {e}"));
    }
}
