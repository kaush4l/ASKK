//! ReAct harness loop: the runtime spine that drives one agent goal to a final answer.
//!
//! The loop is deliberately small. Each turn it asks the model for a single
//! [`ReActResponse`], then either executes one compiled tool call (feeding the
//! observation back as untrusted data) or accepts the model's final answer. Tool
//! results are always treated as data, never as instructions to follow.

use crate::execution::{BrowserExecutionProvider, ExecutionProvider};
use crate::inference::{InferenceProvider, InferenceRequest, get_implementation};
use crate::responses::{ReActAction, parse_tool_calls};
use crate::state::{
    Agent, AgentEventKind, AgentRun, AppResult, AppSnapshot, Message, RunBudgets, RunLane,
    RunScratchpad, ScratchpadObservation, ToolCall, default_tool_names, event, now_iso,
};
use std::cell::Cell;
use std::future::Future;
use std::pin::Pin;
use uuid::Uuid;

/// Boxed future returned by the engine entry points.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = AppResult<T>> + 'a>>;

thread_local! {
    /// Cooperative stop flag. WASM is single-threaded, so a thread-local `Cell`
    /// is sufficient to signal an in-flight run to halt after its current turn.
    static INTERRUPT: Cell<bool> = const { Cell::new(false) };
}

/// Request that the active run stop after the current turn.
pub fn request_interrupt() {
    INTERRUPT.with(|flag| flag.set(true));
}

/// Clear any pending interrupt before starting a new run.
pub fn clear_interrupt() {
    INTERRUPT.with(|flag| flag.set(false));
}

fn interrupt_requested() -> bool {
    INTERRUPT.with(Cell::get)
}

/// Drives agent goals through the ReAct loop using browser-safe compiled tools.
#[derive(Clone, Debug)]
pub struct ReActEngine {
    executor: BrowserExecutionProvider,
}

impl Default for ReActEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl ReActEngine {
    pub fn new() -> Self {
        Self {
            executor: BrowserExecutionProvider::new(),
        }
    }

    /// Run a fresh goal to completion, notifying `observer` after every state change.
    pub fn run_goal_with_observer<F>(
        &self,
        snapshot: AppSnapshot,
        goal: String,
        observer: F,
    ) -> BoxFuture<'_, AppSnapshot>
    where
        F: FnMut(AgentRun) + 'static,
    {
        let executor = self.executor.clone();
        Box::pin(async move { run_react_session(executor, snapshot, goal, observer).await })
    }

    /// Resume a persisted job by re-running its recorded goal through the loop.
    pub fn resume_job_with_observer<F>(
        &self,
        snapshot: AppSnapshot,
        job_id: String,
        observer: F,
    ) -> BoxFuture<'_, AppSnapshot>
    where
        F: FnMut(AgentRun) + 'static,
    {
        let executor = self.executor.clone();
        Box::pin(async move {
            let goal = snapshot
                .jobs
                .iter()
                .find(|job| job.id == job_id)
                .map(|job| job.goal.clone());
            match goal {
                Some(goal) => run_react_session(executor, snapshot, goal, observer).await,
                None => Err(format!("No job found with id {job_id}")),
            }
        })
    }
}

async fn run_react_session<F>(
    executor: BrowserExecutionProvider,
    mut snapshot: AppSnapshot,
    goal: String,
    mut observer: F,
) -> AppResult<AppSnapshot>
where
    F: FnMut(AgentRun),
{
    clear_interrupt();

    let lane = classify_goal(&goal);
    let run_id = Uuid::new_v4().to_string();
    let agent = pick_agent(&snapshot);
    let agent_id = agent.id.clone();
    let enabled_tools = if agent.enabled_tools.is_empty() {
        default_tool_names()
    } else {
        agent.enabled_tools.clone()
    };

    let mut run = AgentRun {
        id: run_id.clone(),
        goal: goal.clone(),
        status: "running".to_string(),
        lane,
        scratchpad: initial_scratchpad(&snapshot, &goal, lane),
        messages: Vec::new(),
        events: vec![event(
            &run_id,
            None,
            AgentEventKind::Started,
            "Run started",
            format!("Goal: {goal}"),
        )],
        tool_calls: Vec::new(),
        tool_results: Vec::new(),
        final_answer: String::new(),
        created_at: now_iso(),
    };
    run.events.push(event(
        &run_id,
        Some(agent_id.clone()),
        AgentEventKind::Routing,
        format!("Routing: {}", lane.as_label()),
        format!(
            "Classified into the {} ({}) lane. Compiled tools: {}.",
            lane.as_label(),
            lane.as_str(),
            enabled_tools.join(", ")
        ),
    ));
    observer(run.clone());

    // Resolve the model profile (per-agent first, then the workspace active profile)
    // and apply its tuning onto the provider config used for this run.
    let mut provider = snapshot.provider.clone();
    let profile_id = agent
        .model_profile_id
        .clone()
        .or_else(|| snapshot.active_model_profile_id.clone());
    if let Some(profile_id) = profile_id
        && let Some(profile) = snapshot
            .model_profiles
            .iter()
            .find(|profile| profile.id == profile_id)
    {
        provider.temperature = profile.temperature;
        provider.max_tokens = profile.max_tokens;
        provider.top_p = profile.top_p;
        provider.context_window = profile.context_window;
    }
    let inference = get_implementation(&provider);
    let specs = executor.domain_specs_for_agent(&enabled_tools);
    let max_steps = run.scratchpad.budgets.max_steps.max(1);
    let mut answered = false;

    for step in 0..max_steps {
        if interrupt_requested() {
            mark_interrupted(&mut run, "Run interrupted before the next model call.");
            observer(run.clone());
            break;
        }

        let turn = step + 1;
        run.scratchpad.budgets.steps_used = turn;
        run.events.push(event(
            &run.id,
            Some(agent_id.clone()),
            AgentEventKind::LlmRequest,
            format!("Model call (turn {turn})"),
            format!(
                "Sending the goal and {} prior messages.",
                run.messages.len()
            ),
        ));
        observer(run.clone());

        let request = InferenceRequest {
            agent_name: agent.name.clone(),
            agent_role: agent.role.clone(),
            soul: snapshot.soul.clone(),
            skills: snapshot.skills.clone(),
            goal: run.goal.clone(),
            history: run.messages.clone(),
            tools: specs.clone(),
            response_format: agent.response_format,
        };

        let mut sink = |_partial: String| {};
        let output = match inference
            .invoke_react_streaming(&provider, request, &mut sink)
            .await
        {
            Ok(output) => output,
            Err(err) => {
                run.status = "error".to_string();
                run.events.push(event(
                    &run.id,
                    Some(agent_id.clone()),
                    AgentEventKind::Error,
                    "Model call failed",
                    err,
                ));
                observer(run.clone());
                break;
            }
        };

        let parsed = output.parsed;
        run.messages.push(Message {
            role: "assistant".to_string(),
            content: output.raw_text.clone(),
        });
        let thinking = if parsed.thinking.trim().is_empty() {
            parsed.observation.clone()
        } else {
            parsed.thinking.clone()
        };
        run.events.push(event(
            &run.id,
            Some(agent_id.clone()),
            AgentEventKind::LlmResponse,
            format!("Model responded (turn {turn})"),
            truncate(&thinking, 600),
        ));
        if !thinking.trim().is_empty() {
            push_observation(&mut run, &agent.name, thinking);
        }

        match parsed.action {
            ReActAction::Answer => {
                run.final_answer = parsed.final_text();
                run.events.push(event(
                    &run.id,
                    Some(agent_id.clone()),
                    AgentEventKind::FinalAnswer,
                    "Final answer",
                    truncate(&run.final_answer, 600),
                ));
                answered = true;
                observer(run.clone());
                break;
            }
            ReActAction::Tool => {
                let calls = parse_tool_calls(&parsed.response);
                if calls.is_empty() {
                    // The model chose a tool but produced no parseable call. Fall back
                    // to surfacing its text rather than looping uselessly.
                    run.final_answer = parsed.final_text();
                    run.events.push(event(
                        &run.id,
                        Some(agent_id.clone()),
                        AgentEventKind::FinalAnswer,
                        "Final answer (no tool call parsed)",
                        truncate(&run.final_answer, 600),
                    ));
                    answered = true;
                    observer(run.clone());
                    break;
                }

                for call in calls {
                    let call_id = Uuid::new_v4().to_string();
                    run.tool_calls.push(ToolCall {
                        id: call_id.clone(),
                        agent_id: agent_id.clone(),
                        tool_name: call.name.clone(),
                        arguments: call.args.clone(),
                    });
                    run.events.push(event(
                        &run.id,
                        Some(agent_id.clone()),
                        AgentEventKind::ToolRequested,
                        format!("Tool requested: {}", call.name),
                        truncate(&call.args.to_string(), 400),
                    ));
                    observer(run.clone());

                    let result = executor
                        .execute_domain_tool(
                            &mut snapshot,
                            call_id.clone(),
                            &call.name,
                            call.args.clone(),
                        )
                        .await;
                    let kind = if result.ok {
                        AgentEventKind::ToolCompleted
                    } else {
                        AgentEventKind::Error
                    };
                    run.events.push(event(
                        &run.id,
                        Some(agent_id.clone()),
                        kind,
                        format!(
                            "Tool {}: {}",
                            if result.ok { "completed" } else { "failed" },
                            call.name
                        ),
                        truncate(&result.content, 600),
                    ));
                    // Tool output is untrusted DATA. It enters the conversation as an
                    // observation only; it is never executed as an instruction.
                    run.messages.push(Message {
                        role: "tool".to_string(),
                        content: format!("{} -> {}", call.name, result.content),
                    });
                    push_observation(&mut run, &call.name, truncate(&result.content, 400));
                    run.tool_results.push(result);
                    observer(run.clone());
                }
            }
        }

        observer(run.clone());
    }

    finalize_status(&mut run, answered);

    snapshot.status = match run.status.as_str() {
        "complete" => "Run complete.".to_string(),
        "interrupted" => "Run interrupted.".to_string(),
        "error" => "Run failed.".to_string(),
        other => other.to_string(),
    };
    snapshot.current_run = Some(run.clone());
    snapshot.runs.push(run.clone());
    // Keep the persisted run history bounded so the snapshot does not grow forever.
    let runs_len = snapshot.runs.len();
    if runs_len > 25 {
        snapshot.runs.drain(0..runs_len - 25);
    }
    observer(run);

    Ok(snapshot)
}

fn finalize_status(run: &mut AgentRun, answered: bool) {
    match run.status.as_str() {
        "error" | "interrupted" => {}
        _ => {
            run.status = "complete".to_string();
            if !answered && run.final_answer.trim().is_empty() {
                run.final_answer =
                    "Reached the step limit before producing a final answer.".to_string();
                run.events.push(event(
                    &run.id,
                    None,
                    AgentEventKind::FinalAnswer,
                    "Stopped at step limit",
                    run.final_answer.clone(),
                ));
            }
        }
    }
}

fn pick_agent(snapshot: &AppSnapshot) -> Agent {
    snapshot
        .agents
        .iter()
        .find(|agent| agent.enabled)
        .or_else(|| snapshot.agents.first())
        .cloned()
        .unwrap_or_else(|| {
            Agent::new(
                "Assistant",
                "Answer the user's request, using compiled tools when they help.",
                default_tool_names(),
            )
        })
}

fn initial_scratchpad(snapshot: &AppSnapshot, goal: &str, lane: RunLane) -> RunScratchpad {
    RunScratchpad {
        goal: goal.to_string(),
        lane,
        current_plan: lane_plan(lane),
        budgets: RunBudgets {
            max_steps: snapshot.orchestrator.max_steps.max(1),
            ..RunBudgets::default()
        },
        ..RunScratchpad::default()
    }
}

fn push_observation(run: &mut AgentRun, source: &str, content: String) {
    run.scratchpad
        .recent_observations
        .push(ScratchpadObservation {
            id: Uuid::new_v4().to_string(),
            source: source.to_string(),
            content,
            created_at: now_iso(),
        });
}

fn mark_interrupted(run: &mut AgentRun, reason: &str) {
    run.status = "interrupted".to_string();
    run.events.push(event(
        &run.id,
        None,
        AgentEventKind::Interrupted,
        "Run interrupted",
        reason,
    ));
}

fn truncate(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut output = value.chars().take(max_chars).collect::<String>();
    output.push('…');
    output
}

/// Classify a goal into a coarse [`RunLane`] used only as a timeline label and to
/// seed the scratchpad plan. Every lane runs through the same ReAct loop.
pub fn classify_goal(goal: &str) -> RunLane {
    let normalized = goal.to_lowercase();
    let line_items = goal
        .lines()
        .filter(|line| {
            let trimmed = line.trim_start();
            trimmed.starts_with("- ")
                || trimmed.starts_with("* ")
                || trimmed.chars().next().is_some_and(|ch| ch.is_ascii_digit())
                    && trimmed.contains('.')
        })
        .count();

    if line_items >= 2
        || normalized.contains("for each")
        || normalized.contains("these ")
        || normalized.contains("batch")
    {
        return RunLane::Batch;
    }
    if normalized.contains("monitor")
        || normalized.contains("watch")
        || normalized.contains("background")
        || normalized.contains("over time")
        || normalized.contains("periodically")
    {
        return RunLane::BackgroundJob;
    }
    RunLane::BoundedTask
}

fn lane_plan(lane: RunLane) -> Vec<String> {
    match lane {
        RunLane::DirectAnswer => vec!["Answer the goal directly.".to_string()],
        RunLane::SingleAction => vec!["Take one tool action, then answer.".to_string()],
        RunLane::BoundedTask => vec![
            "Search for current evidence when needed.".to_string(),
            "Synthesize a grounded final answer.".to_string(),
        ],
        RunLane::BackgroundJob => vec!["Work the goal as a long-running task.".to_string()],
        RunLane::Batch => vec!["Work through each item in the batch.".to_string()],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_news_goal_as_bounded_task() {
        assert_eq!(
            classify_goal("What is the latest news on Rust?"),
            RunLane::BoundedTask
        );
    }

    #[test]
    fn classifies_bullet_list_goal_as_batch() {
        assert_eq!(
            classify_goal("Summarize:\n- item one\n- item two"),
            RunLane::Batch
        );
    }

    #[test]
    fn classifies_monitoring_goal_as_background() {
        assert_eq!(
            classify_goal("Monitor the repo for changes"),
            RunLane::BackgroundJob
        );
    }

    #[test]
    fn interrupt_flag_round_trips() {
        clear_interrupt();
        assert!(!interrupt_requested());
        request_interrupt();
        assert!(interrupt_requested());
        clear_interrupt();
        assert!(!interrupt_requested());
    }

    #[test]
    fn truncate_appends_ellipsis_when_over_limit() {
        assert_eq!(truncate("abcdef", 3), "abc…");
        assert_eq!(truncate("ab", 3), "ab");
    }
}
