//! `spawn_agent` — runtime sub-agent generation via specialization (the
//! hybrid registry): the orchestrator never authors an agent from nothing,
//! it SPECIALIZES a base roster agent at call time — narrowed tools,
//! replaced skills, an extra directive paragraph, a clamped turn budget —
//! and drives the child through the same delegation seam as `DelegateTool`.
//! Authority only narrows: replacement tools must be ⊆ the base's, and the
//! child's run allowlist is additionally ∩ the caller's, like any delegation.
//! Spawned configs are run-scoped: they live in `Shared::spawned` for the
//! session (the turn loop re-resolves the agent by id every turn) and are
//! never persisted to any config store.

use std::rc::Weak;

use askk_core::{Effect, RunStatus, Tool, ToolCtx, ToolResult, ToolSpec};
use serde_json::{json, Value};

use crate::config::agent::MAX_SPAWNED_MAX_TURNS;
use crate::delegate::{depth_cap, drive_child};
use crate::run::dispatch::DEPTH_SLICE;
use crate::run::session::Shared;
use crate::state::LocalBoxFuture;

/// Base agent used when the call names none.
const DEFAULT_BASE: &str = "worker";

pub struct SpawnAgentTool {
    spec: ToolSpec,
    shared: Weak<Shared>,
}

impl SpawnAgentTool {
    pub(crate) fn new(shared: Weak<Shared>) -> Self {
        Self {
            spec: ToolSpec {
                name: "spawn_agent".into(),
                description: "Spawn a specialized sub-agent for one goal: \
                              pick a base roster agent and narrow it — fewer \
                              tools, different skills, an extra directive, a \
                              turn cap. The child runs the full agent loop \
                              (skills, react, verification) and its answer \
                              comes back untrusted. Authority only narrows: \
                              tools must be a subset of the base's and of \
                              your own."
                    .into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "goal": {
                            "type": "string",
                            "description": "Self-contained goal for the sub-agent."
                        },
                        "base": {
                            "type": "string",
                            "description": "Base agent id to specialize (default: worker)."
                        },
                        "directive": {
                            "type": "string",
                            "description": "Extra instructions appended to the base prompt."
                        },
                        "tools": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Replacement toolset; must be a subset of the base's tools."
                        },
                        "skills": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Replacement skill ids; each must exist."
                        },
                        "max_turns": {
                            "type": "integer",
                            "description": "Turn budget for the child (clamped to 64)."
                        }
                    },
                    "required": ["goal"]
                }),
                effect: Effect::Pure,
            },
            shared,
        }
    }
}

/// Optional array-of-strings arg; present with any other shape is an error.
fn str_list(args: &Value, key: &str) -> Result<Option<Vec<String>>, String> {
    match args.get(key) {
        None => Ok(None),
        Some(Value::Array(items)) => items
            .iter()
            .map(|v| {
                v.as_str()
                    .map(String::from)
                    .ok_or_else(|| format!("'{key}' must be an array of strings"))
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Some),
        Some(_) => Err(format!("'{key}' must be an array of strings")),
    }
}

impl Tool for SpawnAgentTool {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let Some(shared) = self.shared.upgrade() else {
                return ToolResult::err("spawn_agent: session is gone");
            };
            let depth = ctx.slice(DEPTH_SLICE).and_then(Value::as_u64).unwrap_or(0) as u8;
            let cap = depth_cap(&shared, ctx);
            if depth >= cap {
                return ToolResult::err(format!(
                    "spawn_agent: delegation depth cap ({cap}) reached"
                ));
            }
            let Some(goal) = args.get("goal").and_then(Value::as_str) else {
                return ToolResult::err("spawn_agent: missing string field 'goal'");
            };
            let base_id = args
                .get("base")
                .and_then(Value::as_str)
                .unwrap_or(DEFAULT_BASE);
            let Some(base) = shared.agents.get(base_id).filter(|a| a.enabled).cloned() else {
                return ToolResult::err(format!(
                    "spawn_agent: unknown or disabled base agent '{base_id}'"
                ));
            };
            let (tools, skills) = match (str_list(&args, "tools"), str_list(&args, "skills")) {
                (Ok(t), Ok(s)) => (t, s),
                (Err(e), _) | (_, Err(e)) => return ToolResult::err(format!("spawn_agent: {e}")),
            };
            let max_turns = match args.get("max_turns") {
                None => None,
                Some(v) => match v.as_u64() {
                    Some(n) => Some(n.min(u64::from(MAX_SPAWNED_MAX_TURNS)) as u32),
                    None => {
                        return ToolResult::err(
                            "spawn_agent: 'max_turns' must be a positive integer",
                        )
                    }
                },
            };
            let directive = args.get("directive").and_then(Value::as_str);
            let known_skills: Vec<String> = shared.skills.iter().map(|s| s.id.clone()).collect();
            // Unique per spawn: entries are never removed, so the map length
            // grows monotonically across the session.
            let child_id = format!("spawned-{base_id}-{}", shared.spawned.borrow().len() + 1);
            let child = match base.specialize(
                child_id.clone(),
                directive,
                tools,
                skills,
                max_turns,
                &known_skills,
            ) {
                Ok(child) => child,
                Err(e) => return ToolResult::err(format!("spawn_agent: {e}")),
            };
            // Registered BEFORE driving: every turn re-resolves the agent by
            // id, and post-run digests may look the run's agent up too.
            shared
                .spawned
                .borrow_mut()
                .insert(child_id.clone(), child.clone());
            match drive_child(&shared, ctx, &child, goal, depth, None).await {
                Err(e) => ToolResult::err(format!("spawn_agent '{child_id}': {e}")),
                Ok((RunStatus::Answered, text)) => {
                    ToolResult::ok(format!("Result (untrusted): {text}"))
                }
                Ok((status, text)) => ToolResult::err(format!(
                    "spawn_agent '{child_id}' ended {status:?} without a verified answer: {text}"
                )),
            }
        })
    }
}
