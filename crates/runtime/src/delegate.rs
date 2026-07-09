//! Agent-as-tool: the ONE delegation seam (ADR-004). Every enabled agent is
//! registered as a `DelegateTool`; calling it runs a nested bounded loop.
//! Authority narrows (child toolset = parent ∩ child), depth is capped by
//! `Budgets::max_delegation_depth`, and the child's answer comes back as an
//! untrusted observation string.

use std::rc::Weak;

use askk_core::{Effect, RunId, RunStatus, SignalKind, Tool, ToolCtx, ToolResult, ToolSpec};
use serde_json::{json, Value};

use crate::config::AgentConfig;
use crate::run::dispatch::{DEPTH_SLICE, PARENT_RUN_SLICE, PARENT_TOOLS_SLICE};
use crate::run::session::{RunState, Shared};
use crate::run::turn;
use crate::state::LocalBoxFuture;

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
            // Authority narrows: child toolset = parent ∩ child.
            let parent_tools: Vec<String> = ctx
                .slice(PARENT_TOOLS_SLICE)
                .and_then(Value::as_array)
                .map(|names| {
                    names
                        .iter()
                        .filter_map(|n| n.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            let allowed: Vec<String> = child
                .tools
                .iter()
                .filter(|t| parent_tools.contains(t))
                .cloned()
                .collect();
            let memory = match shared.memory.load(&child.id).await {
                Ok(memory) => memory,
                Err(e) => return ToolResult::err(format!("delegate: {e}")),
            };
            // The nested run signals through the calling run's live host.
            let parent_host = ctx
                .slice(PARENT_RUN_SLICE)
                .and_then(Value::as_str)
                .and_then(|id| shared.hosts.borrow().get(&RunId::new(id)).cloned());
            let Some(host) = parent_host else {
                return ToolResult::err("delegate: no live host for the calling run");
            };
            let run_id = shared.next_run_id();
            shared.hosts.borrow_mut().insert(run_id.clone(), host);
            let mut run = RunState::new(&child, goal, allowed, depth + 1, memory, run_id);
            let started = turn::emit(
                &shared,
                &mut run,
                SignalKind::RunStarted {
                    agent_id: child.id.clone(),
                    goal: goal.to_string(),
                },
            )
            .await;
            let driven = match started {
                Ok(()) => turn::drive_run(&shared, &mut run).await,
                Err(e) => Err(e),
            };
            shared.hosts.borrow_mut().remove(&run.id);
            if let Err(e) = driven {
                return ToolResult::err(format!("delegate '{}': {e}", self.child_id));
            }
            let text = run.final_text.clone().unwrap_or_default();
            match run.status {
                RunStatus::Answered => ToolResult::ok(format!("Result (untrusted): {text}")),
                status => ToolResult::err(format!(
                    "delegate '{}' ended {status:?} without a verified answer: {text}",
                    self.child_id
                )),
            }
        })
    }
}
