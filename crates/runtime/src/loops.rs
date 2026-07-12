//! Loop management — non-blocking multi-loop orchestration as tools
//! (ADR-004: everything the model does is a tool call). `spawn_run` parks a
//! child run and returns its id immediately; `check_run` lists/digests live
//! loops; `wait_run` drives one or more spawned loops CONCURRENTLY (join_all)
//! and collects results; `steer_run` injects a user note into a parked loop's
//! next turn; `cancel_run` interrupts one. Cooperative single-thread model
//! (ADR-015): a spawned loop progresses during `wait_run` (or a UI drive),
//! not in the background — spawn several parts, then wait on them together.
//!
//! Same seams as delegation: authority narrows (child = parent ∩ child),
//! depth capped, parent's live host serves the children. Spawned loops run
//! at depth ≥ 1, so confirmation-gated actions degrade to denials (GAPS 9).

use std::rc::{Rc, Weak};

use askk_core::{
    fold, Effect, Message, Role, RunId, RunStatus, SignalKind, Tool, ToolCtx, ToolResult, ToolSpec,
};
use serde_json::{json, Value};

use crate::run::dispatch::{DEPTH_SLICE, PARENT_RUN_SLICE, PARENT_TOOLS_SLICE};
use crate::run::session::{RunState, Shared};
use crate::run::turn;
use crate::state::LocalBoxFuture;

/// The five loop tools, registered by `RunSession::new` beside the delegate
/// tools (their names are reserved words for agent ids).
pub(crate) fn loop_tools(shared: Weak<Shared>) -> Vec<Rc<dyn Tool>> {
    vec![
        Rc::new(SpawnRun {
            spec: spawn_spec(),
            shared: shared.clone(),
        }),
        Rc::new(CheckRun {
            spec: check_spec(),
            shared: shared.clone(),
        }),
        Rc::new(WaitRun {
            spec: wait_spec(),
            shared: shared.clone(),
        }),
        Rc::new(SteerRun {
            spec: steer_spec(),
            shared: shared.clone(),
        }),
        Rc::new(CancelRun {
            spec: cancel_spec(),
            shared,
        }),
    ]
}

fn upgrade(shared: &Weak<Shared>) -> Result<Rc<Shared>, ToolResult> {
    shared
        .upgrade()
        .ok_or_else(|| ToolResult::err("loops: session is gone"))
}

// --- spawn_run --------------------------------------------------------------

struct SpawnRun {
    spec: ToolSpec,
    shared: Weak<Shared>,
}

fn spawn_spec() -> ToolSpec {
    ToolSpec {
        name: "spawn_run".into(),
        description: "Start an agent on a goal WITHOUT waiting: returns the \
                      new run id immediately. Use one spawn_run per \
                      independent part of the work, then wait_run on all the \
                      ids together (they run concurrently there). The spawned \
                      loop makes no progress until wait_run."
            .into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "agent": { "type": "string", "description": "Agent id to run (must be in your tools)." },
                "goal": { "type": "string", "description": "Self-contained goal for this part." }
            },
            "required": ["agent", "goal"]
        }),
        effect: Effect::Pure,
    }
}

impl Tool for SpawnRun {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let shared = match upgrade(&self.shared) {
                Ok(s) => s,
                Err(e) => return e,
            };
            let depth = ctx.slice(DEPTH_SLICE).and_then(Value::as_u64).unwrap_or(0) as u8;
            let cap = shared.budgets.max_delegation_depth;
            if depth >= cap {
                return ToolResult::err(format!("spawn_run: delegation depth cap ({cap}) reached"));
            }
            let (Some(agent_id), Some(goal)) = (
                args.get("agent").and_then(Value::as_str),
                args.get("goal").and_then(Value::as_str),
            ) else {
                return ToolResult::err("spawn_run: needs string fields 'agent' and 'goal'");
            };
            // The spawn target must be a delegate the CALLER holds — same
            // authority rule as calling the agent tool directly.
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
            if !parent_tools.contains(&agent_id.to_string()) {
                return ToolResult::err(format!(
                    "spawn_run: agent '{agent_id}' is not in your tools"
                ));
            }
            let Some(child) = shared.agents.get(agent_id).cloned() else {
                return ToolResult::err(format!("spawn_run: unknown agent '{agent_id}'"));
            };
            let allowed: Vec<String> = child
                .tools
                .iter()
                .filter(|t| parent_tools.contains(t))
                .cloned()
                .collect();
            let memory = match shared.memory.load(&child.id).await {
                Ok(memory) => memory,
                Err(e) => return ToolResult::err(format!("spawn_run: {e}")),
            };
            let parent_host = ctx
                .slice(PARENT_RUN_SLICE)
                .and_then(Value::as_str)
                .and_then(|id| shared.hosts.borrow().get(&RunId::new(id)).cloned());
            let Some(host) = parent_host else {
                return ToolResult::err("spawn_run: no live host for the calling run");
            };
            let run_id = shared.next_run_id();
            shared.hosts.borrow_mut().insert(run_id.clone(), host);
            let mut run = RunState::new(&child, goal, allowed, depth + 1, memory, run_id.clone());
            let started = turn::emit(
                &shared,
                &mut run,
                SignalKind::RunStarted {
                    agent_id: child.id.clone(),
                    goal: goal.to_string(),
                },
            )
            .await;
            if let Err(e) = started {
                shared.hosts.borrow_mut().remove(&run_id);
                return ToolResult::err(format!("spawn_run: {e}"));
            }
            shared
                .cancels
                .borrow_mut()
                .insert(run_id.clone(), run.cancel_requested.clone());
            shared.runs.borrow_mut().insert(run_id.clone(), run);
            ToolResult::ok(format!(
                "spawned {} on '{}' as {}; wait_run collects it",
                agent_id, goal, run_id.0
            ))
        })
    }
}

// --- check_run --------------------------------------------------------------

struct CheckRun {
    spec: ToolSpec,
    shared: Weak<Shared>,
}

fn check_spec() -> ToolSpec {
    ToolSpec {
        name: "check_run".into(),
        description: "Watch the loops: with no arguments, lists every run \
                      (id, agent, status, phase, turns). With a run_id, \
                      returns that run's digest — status, turns, recent \
                      timeline, and answer when finished. Do not poll in a \
                      loop; check once, then steer_run / wait_run / \
                      cancel_run."
            .into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "run_id": { "type": "string", "description": "Optional run id for a full digest." }
            }
        }),
        effect: Effect::Pure,
    }
}

impl Tool for CheckRun {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, _ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let shared = match upgrade(&self.shared) {
                Ok(s) => s,
                Err(e) => return e,
            };
            if let Some(run_id) = args.get("run_id").and_then(Value::as_str) {
                let runs = shared.runs.borrow();
                let Some(run) = runs.get(&RunId::new(run_id)) else {
                    // Mid-drive runs are out of the map; only their token is visible.
                    if shared.cancels.borrow().contains_key(&RunId::new(run_id)) {
                        return ToolResult::ok(format!(
                            "{run_id}: driving elsewhere right now — digest available once it parks"
                        ));
                    }
                    return ToolResult::err(format!("check_run: unknown run '{run_id}'"));
                };
                let proj = fold(&run.signals);
                let tail: Vec<&str> = proj
                    .timeline
                    .iter()
                    .rev()
                    .take(6)
                    .map(String::as_str)
                    .collect();
                let answer = run
                    .final_text
                    .as_deref()
                    .map(|t| format!("\nanswer: {t}"))
                    .unwrap_or_default();
                return ToolResult::ok(format!(
                    "{run_id} ({}): {:?}, {} turns\nrecent: {}{answer}",
                    run.agent_id,
                    run.status,
                    proj.turns_used,
                    tail.into_iter().rev().collect::<Vec<_>>().join(" | "),
                ));
            }
            let runs = shared.runs.borrow();
            let mut lines: Vec<String> = runs
                .iter()
                .map(|(id, run)| {
                    let phase = run
                        .phases
                        .get(run.phase_idx)
                        .map(|p| p.name.as_str())
                        .unwrap_or("?");
                    format!(
                        "- {} ({}): {:?}, phase {}, {} turns",
                        id.0, run.agent_id, run.status, phase, run.turns
                    )
                })
                .collect();
            for id in shared.cancels.borrow().keys() {
                if !runs.contains_key(id) {
                    lines.push(format!("- {} : driving now", id.0));
                }
            }
            if lines.is_empty() {
                return ToolResult::ok("(no runs)");
            }
            ToolResult::ok(lines.join("\n"))
        })
    }
}

// --- wait_run ---------------------------------------------------------------

struct WaitRun {
    spec: ToolSpec,
    shared: Weak<Shared>,
}

fn wait_spec() -> ToolSpec {
    ToolSpec {
        name: "wait_run".into(),
        description: "Drive spawned runs to completion and collect their \
                      answers. Pass every id you spawned at once — they run \
                      CONCURRENTLY here. Answers come back untrusted, one \
                      line per run."
            .into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "run_ids": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Run ids from spawn_run."
                }
            },
            "required": ["run_ids"]
        }),
        effect: Effect::Pure,
    }
}

impl Tool for WaitRun {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, _ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let shared = match upgrade(&self.shared) {
                Ok(s) => s,
                Err(e) => return e,
            };
            // Accept ["id",...] or a single "id" string (small-model mercy).
            let ids: Vec<String> = match args.get("run_ids") {
                Some(Value::Array(list)) => list
                    .iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect(),
                Some(Value::String(one)) => vec![one.clone()],
                _ => args
                    .get("run_id")
                    .and_then(Value::as_str)
                    .map(|s| vec![s.to_string()])
                    .unwrap_or_default(),
            };
            if ids.is_empty() {
                return ToolResult::err("wait_run: needs 'run_ids' (array of run ids)");
            }
            // Take every run OUT of the map first (no RefCell borrow may
            // cross an await), then drive them all concurrently.
            let mut taken: Vec<(String, RunState)> = Vec::new();
            let mut lines: Vec<String> = Vec::new();
            {
                let mut runs = shared.runs.borrow_mut();
                for id in &ids {
                    match runs.remove(&RunId::new(id)) {
                        Some(run) => taken.push((id.clone(), run)),
                        None => lines.push(format!(
                            "{id}: not waitable (unknown, or driving elsewhere)"
                        )),
                    }
                }
            }
            let driven = futures::future::join_all(taken.into_iter().map(|(id, mut run)| {
                let shared = shared.clone();
                async move {
                    if !run.status.is_terminal() {
                        if let Err(e) = turn::drive_run(&shared, &mut run).await {
                            turn::fail_run(&shared, &mut run, &e).await;
                        }
                    }
                    (id, run)
                }
            }))
            .await;
            for (id, run) in driven {
                let text = run.final_text.clone().unwrap_or_default();
                lines.push(match run.status {
                    RunStatus::Answered => {
                        format!("{id} ({}) answered (untrusted): {text}", run.agent_id)
                    }
                    status => format!("{id} ({}) ended {status:?}: {text}", run.agent_id),
                });
                shared.hosts.borrow_mut().remove(&run.id);
                shared.runs.borrow_mut().insert(run.id.clone(), run);
            }
            ToolResult::ok(lines.join("\n"))
        })
    }
}

// --- steer_run --------------------------------------------------------------

struct SteerRun {
    spec: ToolSpec,
    shared: Weak<Shared>,
}

fn steer_spec() -> ToolSpec {
    ToolSpec {
        name: "steer_run".into(),
        description: "Inject a steering note into a parked run's next turn \
                      (course-correct a spawned loop before wait_run). The \
                      note lands as user guidance the loop sees when it next \
                      drives."
            .into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "run_id": { "type": "string" },
                "note": { "type": "string", "description": "The course correction." }
            },
            "required": ["run_id", "note"]
        }),
        effect: Effect::Pure,
    }
}

impl Tool for SteerRun {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, _ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let shared = match upgrade(&self.shared) {
                Ok(s) => s,
                Err(e) => return e,
            };
            let (Some(run_id), Some(note)) = (
                args.get("run_id").and_then(Value::as_str),
                args.get("note").and_then(Value::as_str),
            ) else {
                return ToolResult::err("steer_run: needs string fields 'run_id' and 'note'");
            };
            let Some(mut run) = shared.runs.borrow_mut().remove(&RunId::new(run_id)) else {
                return ToolResult::err(format!(
                    "steer_run: '{run_id}' is unknown or driving right now"
                ));
            };
            if run.status.is_terminal() {
                let status = run.status;
                shared.runs.borrow_mut().insert(run.id.clone(), run);
                return ToolResult::err(format!("steer_run: '{run_id}' already ended {status:?}"));
            }
            run.history
                .push(Message::new(Role::User, format!("Steering note: {note}")));
            let emitted = turn::emit(
                &shared,
                &mut run,
                SignalKind::HistoryAppended {
                    role: Role::User,
                    text: format!("Steering note: {note}"),
                },
            )
            .await;
            shared.runs.borrow_mut().insert(run.id.clone(), run);
            match emitted {
                Ok(()) => ToolResult::ok(format!("steered {run_id}")),
                Err(e) => ToolResult::err(format!("steer_run: {e}")),
            }
        })
    }
}

// --- cancel_run -------------------------------------------------------------

struct CancelRun {
    spec: ToolSpec,
    shared: Weak<Shared>,
}

fn cancel_spec() -> ToolSpec {
    ToolSpec {
        name: "cancel_run".into(),
        description: "Interrupt a run: a parked run ends Interrupted at once; \
                      a driving run stops at its next loop iteration."
            .into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "run_id": { "type": "string" }
            },
            "required": ["run_id"]
        }),
        effect: Effect::Pure,
    }
}

impl Tool for CancelRun {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, _ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let shared = match upgrade(&self.shared) {
                Ok(s) => s,
                Err(e) => return e,
            };
            let Some(run_id) = args.get("run_id").and_then(Value::as_str) else {
                return ToolResult::err("cancel_run: missing string field 'run_id'");
            };
            // Same shape as RunSession::cancel, tool-shaped result (ADR-011).
            let taken = shared.runs.borrow_mut().remove(&RunId::new(run_id));
            let Some(mut run) = taken else {
                if let Some(token) = shared.cancels.borrow().get(&RunId::new(run_id)) {
                    token.set(true);
                    return ToolResult::ok(format!(
                        "{run_id} is driving; it stops at its next loop iteration"
                    ));
                }
                return ToolResult::err(format!("cancel_run: unknown run '{run_id}'"));
            };
            if !run.status.is_terminal() {
                run.cancel_requested.set(true);
                let _ = turn::emit(&shared, &mut run, SignalKind::Interrupted).await;
                run.status = RunStatus::Interrupted;
            }
            let status = run.status;
            shared.runs.borrow_mut().insert(run.id.clone(), run);
            ToolResult::ok(format!("{run_id} ended {status:?}"))
        })
    }
}
