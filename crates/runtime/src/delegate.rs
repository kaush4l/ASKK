//! Agent-as-tool: the ONE delegation seam (ADR-004). Every enabled agent is
//! registered as a `DelegateTool`; calling it runs a nested bounded loop.
//! Authority narrows (child toolset = parent ∩ child), depth is capped by
//! `Budgets::max_delegation_depth`, and the child's answer comes back as an
//! untrusted observation string. `HandoffTool` is the full-transfer variant:
//! the child's answer verbatim ends the CALLING run (run/dispatch.rs keys the
//! short-circuit on `HANDOFF_TOOL`).

use std::rc::Weak;

use askk_core::{Effect, RunId, RunStatus, SignalKind, Tool, ToolCtx, ToolResult, ToolSpec};
use serde_json::{json, Value};

use crate::config::AgentConfig;
use crate::run::dispatch::{DEPTH_SLICE, PARENT_RUN_SLICE, PARENT_TOOLS_SLICE};
use crate::run::session::{RunState, Shared};
use crate::run::turn;
use crate::state::LocalBoxFuture;

/// The tool name run/dispatch.rs keys the run-ending short-circuit on.
pub(crate) const HANDOFF_TOOL: &str = "handoff";

/// The caller's effective allowlist, read from the ToolCtx slice.
pub(crate) fn parent_tools(ctx: &ToolCtx) -> Vec<String> {
    ctx.slice(PARENT_TOOLS_SLICE)
        .and_then(Value::as_array)
        .map(|names| {
            names
                .iter()
                .filter_map(|n| n.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// Resolve authority, spin the nested run, drive it to a terminal, and hand
/// back `(status, final_text)` — the one child-run body shared by
/// `DelegateTool` and `HandoffTool`. `Err` is a readable message for the
/// caller's observation.
async fn drive_child(
    shared: &Shared,
    ctx: &ToolCtx,
    child: &AgentConfig,
    goal: &str,
    depth: u8,
) -> Result<(RunStatus, String), String> {
    // Authority narrows: child toolset = parent ∩ child.
    let parent_tools = parent_tools(ctx);
    let allowed: Vec<String> = child
        .tools
        .iter()
        .filter(|t| parent_tools.contains(t))
        .cloned()
        .collect();
    let memory = shared
        .memory
        .load(&child.id)
        .await
        .map_err(|e| e.to_string())?;
    // The nested run signals through the calling run's live host.
    let parent_host = ctx
        .slice(PARENT_RUN_SLICE)
        .and_then(Value::as_str)
        .and_then(|id| shared.hosts.borrow().get(&RunId::new(id)).cloned());
    let Some(host) = parent_host else {
        return Err("no live host for the calling run".into());
    };
    let run_id = shared.next_run_id();
    shared.hosts.borrow_mut().insert(run_id.clone(), host);
    let mut run = RunState::new(child, goal, allowed, depth + 1, memory, run_id);
    let started = turn::emit(
        shared,
        &mut run,
        SignalKind::RunStarted {
            agent_id: child.id.clone(),
            goal: goal.to_string(),
        },
    )
    .await;
    let driven = match started {
        Ok(()) => turn::drive_run(shared, &mut run).await,
        Err(e) => Err(e),
    };
    shared.hosts.borrow_mut().remove(&run.id);
    driven.map_err(|e| e.to_string())?;
    Ok((run.status, run.final_text.unwrap_or_default()))
}

pub struct DelegateTool {
    spec: ToolSpec,
    child_id: String,
    shared: Weak<Shared>,
}

impl DelegateTool {
    /// Tool card = the child's name + description (docs/MODELS.md).
    pub(crate) fn new(shared: Weak<Shared>, agent: &AgentConfig) -> Self {
        Self {
            spec: ToolSpec {
                name: agent.id.clone(),
                description: format!(
                    "Delegate a goal to the '{}' agent. {}",
                    agent.name, agent.description
                ),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "goal": {
                            "type": "string",
                            "description": "The self-contained goal for the sub-agent."
                        }
                    },
                    "required": ["goal"]
                }),
                effect: Effect::Pure,
            },
            child_id: agent.id.clone(),
            shared,
        }
    }
}

impl Tool for DelegateTool {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let Some(shared) = self.shared.upgrade() else {
                return ToolResult::err("delegate: session is gone");
            };
            let depth = ctx.slice(DEPTH_SLICE).and_then(Value::as_u64).unwrap_or(0) as u8;
            let cap = shared.budgets.max_delegation_depth;
            if depth >= cap {
                return ToolResult::err(format!(
                    "delegation depth cap ({cap}) reached; handle the goal yourself or answer"
                ));
            }
            let Some(goal) = args.get("goal").and_then(Value::as_str) else {
                return ToolResult::err("delegate: missing string field 'goal'");
            };
            let Some(child) = shared.agents.get(&self.child_id).cloned() else {
                return ToolResult::err(format!("delegate: unknown agent '{}'", self.child_id));
            };
            match drive_child(&shared, ctx, &child, goal, depth).await {
                Err(e) => ToolResult::err(format!("delegate '{}': {e}", self.child_id)),
                Ok((RunStatus::Answered, text)) => {
                    ToolResult::ok(format!("Result (untrusted): {text}"))
                }
                Ok((status, text)) => ToolResult::err(format!(
                    "delegate '{}' ended {status:?} without a verified answer: {text}",
                    self.child_id
                )),
            }
        })
    }
}

/// Full transfer (swarm-style): run the target agent, then the CALLING run
/// ends Answered with the child's answer verbatim — dispatch short-circuits
/// on a successful call, so no parent turn is spent rephrasing.
pub struct HandoffTool {
    spec: ToolSpec,
    shared: Weak<Shared>,
}

impl HandoffTool {
    pub(crate) fn new(shared: Weak<Shared>) -> Self {
        Self {
            spec: ToolSpec {
                name: HANDOFF_TOOL.into(),
                description: "Hand the WHOLE job over to another agent: it \
                              finishes the work and its answer becomes this \
                              run's final answer verbatim. Your run ends \
                              immediately — use it only when the remainder \
                              of the job is entirely theirs."
                    .into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "agent": {
                            "type": "string",
                            "description": "Agent id to hand off to (must be in your tools)."
                        },
                        "goal": {
                            "type": "string",
                            "description": "The self-contained goal for the agent."
                        }
                    },
                    "required": ["agent", "goal"]
                }),
                effect: Effect::Pure,
            },
            shared,
        }
    }
}

impl Tool for HandoffTool {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let Some(shared) = self.shared.upgrade() else {
                return ToolResult::err("handoff: session is gone");
            };
            let depth = ctx.slice(DEPTH_SLICE).and_then(Value::as_u64).unwrap_or(0) as u8;
            let cap = shared.budgets.max_delegation_depth;
            if depth >= cap {
                return ToolResult::err(format!("handoff: delegation depth cap ({cap}) reached"));
            }
            let (Some(agent_id), Some(goal)) = (
                args.get("agent").and_then(Value::as_str),
                args.get("goal").and_then(Value::as_str),
            ) else {
                return ToolResult::err("handoff: needs string fields 'agent' and 'goal'");
            };
            // Same authority rule as spawn_run: the target must be a
            // delegate the CALLER holds.
            if !parent_tools(ctx).contains(&agent_id.to_string()) {
                return ToolResult::err(format!(
                    "handoff: agent '{agent_id}' is not in your tools"
                ));
            }
            let Some(child) = shared.agents.get(agent_id).cloned() else {
                return ToolResult::err(format!("handoff: unknown agent '{agent_id}'"));
            };
            match drive_child(&shared, ctx, &child, goal, depth).await {
                Err(e) => ToolResult::err(format!("handoff '{agent_id}': {e}")),
                // Verbatim: dispatch makes this text the caller's final answer.
                Ok((RunStatus::Answered, text)) => ToolResult::ok(text),
                Ok((status, text)) => ToolResult::err(format!(
                    "handoff '{agent_id}' ended {status:?} without a verified answer: {text}"
                )),
            }
        })
    }
}
