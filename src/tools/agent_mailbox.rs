//! Mailbox tools — the supervisor's message queue and progress board, exposed to
//! agents as named tools so a running member (or the orchestrator) can:
//!   - `team_send({to, body})`     — drop a message into a specific agent's queue,
//!   - `team_progress({agent?})`   — read one agent's (or every agent's) live status
//!     and recent progress,
//!   - `team_list()`               — list the whole team roster and what each is doing.
//!
//! The `team_` prefix (rather than `agent_`) is deliberate: a tool named `agent_<x>`
//! is reserved for the peer-agent-as-tool convention and would be mis-read as a
//! sub-agent reference by the manifest validator.
//!
//! All three operate on the LIVE supervisor for the team that is currently running
//! (published in [`crate::supervisor`]'s thread-local registry by `delegate_team`).
//! When no team is running they return a clean, non-panicking error rather than a
//! fabricated result. The sender is taken to be the active agent (the front of the
//! snapshot's agent list, which is how the engine marks the running agent).

use serde_json::{Value, json};

use crate::state::{AppSnapshot, ToolSpec};
use crate::supervisor::{Message, with_active};

use super::common::{optional_string_arg, string_arg};
use super::{ToolDescriptor, ToolFuture};

/// Best-effort id of the agent making the call: the engine moves the active agent to
/// the front of the roster, so the first agent is the caller. Falls back to a generic
/// label when the snapshot has no agents.
fn active_agent_id(snapshot: &AppSnapshot) -> String {
    snapshot
        .agents
        .first()
        .map(|agent| agent.id.clone())
        .unwrap_or_else(|| "supervisor".to_string())
}

const NO_TEAM: &str =
    "No team is currently running, so there is no agent queue to use. This tool only works while a `delegate_team` run is in progress.";

// ---- agent_send ------------------------------------------------------------------

pub(crate) fn send_descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: send_spec(),
        handler: send_handler,
    }
}

fn send_spec() -> ToolSpec {
    ToolSpec {
        name: "team_send".to_string(),
        description: "Send a message to a specific other agent on the current team. It lands in that agent's queue and is folded into its next run's goal. Only works while a team is running. Usage: team_send({\"to\":\"coder-coder\",\"body\":\"the planner changed the target file to src/y.rs\"}).".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "to": { "type": "string", "description": "The id of the agent to message (e.g. \"coder-verifier\")." },
                "body": { "type": "string", "description": "The message text." }
            },
            "required": ["to", "body"]
        }),
    }
}

fn send_handler<'a>(snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let to = string_arg(args, "to")?;
        let body = string_arg(args, "body")?;
        let from = active_agent_id(snapshot);

        let routed = with_active(|supervisor| supervisor.send_to(&to, Message::new(&from, body)));
        match routed {
            None => Err(NO_TEAM.to_string()),
            Some(Err(error)) => Err(error),
            Some(Ok(())) => Ok(format!("Delivered message from `{from}` to `{to}`.")),
        }
    })
}

// ---- agent_progress --------------------------------------------------------------

pub(crate) fn progress_descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: progress_spec(),
        handler: progress_handler,
    }
}

fn progress_spec() -> ToolSpec {
    ToolSpec {
        name: "team_progress".to_string(),
        description: "Check the live status and recent progress of agents on the current team. Pass an `agent` id for one agent, or omit it for the whole roster. Only works while a team is running. Usage: team_progress({\"agent\":\"coder-coder\"}) or team_progress({}).".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "agent": { "type": "string", "description": "Optional id of a single agent to report on; omit for all." }
            }
        }),
    }
}

fn progress_handler<'a>(_snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let only = optional_string_arg(args, "agent");

        let report = with_active(|supervisor| match &only {
            Some(id) => match supervisor.instance(id) {
                Some(instance) => render_instance(instance),
                None => format!("No agent `{id}` is on the current team."),
            },
            None => {
                let lines: Vec<String> = supervisor.list().iter().map(|i| render_instance(i)).collect();
                if lines.is_empty() {
                    "The team roster is empty.".to_string()
                } else {
                    lines.join("\n\n")
                }
            }
        });

        report.ok_or_else(|| NO_TEAM.to_string())
    })
}

/// One agent's status line plus its recent progress milestones.
fn render_instance(instance: &crate::supervisor::AgentInstance) -> String {
    let mut block = format!(
        "{} [{}] — {}",
        instance.id,
        instance.role,
        instance.status.label()
    );
    if !instance.progress.is_empty() {
        // The freshest few milestones are the useful ones.
        let recent: Vec<&String> = instance.progress.iter().rev().take(5).collect();
        for note in recent.into_iter().rev() {
            block.push_str(&format!("\n  - {note}"));
        }
    }
    block
}

// ---- agent_list ------------------------------------------------------------------

pub(crate) fn list_descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: list_spec(),
        handler: list_handler,
    }
}

fn list_spec() -> ToolSpec {
    ToolSpec {
        name: "team_list".to_string(),
        description: "List every agent on the current team, in run order, with each one's current status. Only works while a team is running. Usage: team_list({}).".to_string(),
        input_schema: json!({ "type": "object", "properties": {} }),
    }
}

fn list_handler<'a>(_snapshot: &'a mut AppSnapshot, _args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let report = with_active(|supervisor| {
            let lines: Vec<String> = supervisor
                .list()
                .iter()
                .map(|instance| {
                    format!(
                        "- {} [{}]: {}",
                        instance.id,
                        instance.role,
                        instance.status.label()
                    )
                })
                .collect();
            if lines.is_empty() {
                "The team roster is empty.".to_string()
            } else {
                lines.join("\n")
            }
        });

        report.ok_or_else(|| NO_TEAM.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::agent_from_markdown;
    use crate::supervisor::{AgentStatus, Supervisor, install};
    use std::cell::RefCell;
    use std::rc::Rc;

    fn coder_snapshot() -> AppSnapshot {
        AppSnapshot {
            agents: vec![
                {
                    let mut a =
                        agent_from_markdown("agents/coder/1_planner.md", "---\n---\nPlan.").unwrap();
                    a.enabled = true;
                    a
                },
                agent_from_markdown("agents/coder/2_coder.md", "---\n---\nWrite code.").unwrap(),
                agent_from_markdown("agents/coder/3_verifier.md", "---\n---\nVerify.").unwrap(),
            ],
            ..AppSnapshot::default()
        }
    }

    #[test]
    fn send_without_a_running_team_is_a_clean_error() {
        let mut snapshot = coder_snapshot();
        let result = pollster::block_on((send_handler)(
            &mut snapshot,
            &json!({ "to": "coder-coder", "body": "hi" }),
        ));
        let error = result.expect_err("no team running");
        assert!(error.contains("No team"));
    }

    #[test]
    fn send_routes_into_the_live_supervisor_queue() {
        let snapshot = coder_snapshot();
        let mut supervisor = Supervisor::new();
        supervisor.spawn_team(&snapshot.agents, "coder").unwrap();
        let handle = Rc::new(RefCell::new(supervisor));
        let _guard = install(handle.clone());

        let mut snapshot = snapshot;
        let result = pollster::block_on((send_handler)(
            &mut snapshot,
            &json!({ "to": "coder-coder", "body": "use src/y.rs" }),
        ));
        assert!(result.is_ok());

        // The message is now queued on the coder's inbox in the live supervisor.
        let queued = handle.borrow_mut().drain_inbox("coder-coder");
        assert_eq!(queued.len(), 1);
        assert_eq!(queued[0].body, "use src/y.rs");
        assert_eq!(queued[0].from, "coder-planner");
    }

    #[test]
    fn progress_reports_status_for_one_and_all() {
        let snapshot = coder_snapshot();
        let mut supervisor = Supervisor::new();
        supervisor.spawn_team(&snapshot.agents, "coder").unwrap();
        supervisor.set_status(
            "coder-coder",
            AgentStatus::Running {
                turn: 1,
                phase: "Coder".to_string(),
            },
        );
        supervisor.note_progress("coder-coder", "started (Coder)");
        let handle = Rc::new(RefCell::new(supervisor));
        let _guard = install(handle.clone());

        let mut snapshot = snapshot;
        let one = pollster::block_on((progress_handler)(
            &mut snapshot,
            &json!({ "agent": "coder-coder" }),
        ))
        .unwrap();
        assert!(one.contains("coder-coder"));
        assert!(one.contains("started (Coder)"));

        let all = pollster::block_on((progress_handler)(&mut snapshot, &json!({}))).unwrap();
        assert!(all.contains("coder-planner"));
        assert!(all.contains("coder-coder"));
        assert!(all.contains("coder-verifier"));
    }

    #[test]
    fn list_enumerates_the_roster_in_order() {
        let snapshot = coder_snapshot();
        let mut supervisor = Supervisor::new();
        supervisor.spawn_team(&snapshot.agents, "coder").unwrap();
        let handle = Rc::new(RefCell::new(supervisor));
        let _guard = install(handle.clone());

        let mut snapshot = snapshot;
        let listed =
            pollster::block_on((list_handler)(&mut snapshot, &json!({}))).unwrap();
        let planner = listed.find("coder-planner").unwrap();
        let coder = listed.find("coder-coder").unwrap();
        let verifier = listed.find("coder-verifier").unwrap();
        assert!(planner < coder && coder < verifier);
    }
}
