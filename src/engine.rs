//! Engine pillar (one of the four core types: **Engine**, Tool, Provider,
//! Capability) — the ReAct harness loop: the runtime spine that drives one agent
//! goal to a final answer.
//!
//! The loop is auto-recoverable: a transient provider error is retried with
//! backoff, and an unrecoverable one pauses the run (resumable) instead of crashing
//! the app. Tool errors are fed back as observations, never terminal.
//!
//! The loop is deliberately small. Each turn it asks the model for a single
//! [`ReActResponse`], then either executes one compiled tool call (feeding the
//! observation back as untrusted data) or accepts the model's final answer. Tool
//! results are always treated as data, never as instructions to follow.

use crate::execution::{BrowserExecutionProvider, ExecutionProvider};
use crate::inference::{InferenceProvider, InferenceRequest, SubAgentInfo, get_implementation};
use crate::responses::{ReActAction, parse_tool_calls};
use crate::state::{
    Agent, AgentEventKind, AgentRun, AppResult, AppSnapshot, Message, RunBudgets, RunLane,
    RunScratchpad, ScratchpadObservation, ToolCall, default_tool_names, event, now_iso,
};
use crate::validators::ValidatorRegistry;
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

/// Cooperative backoff between retry attempts. Real delay in the browser; a no-op
/// on the host test runner (which has no event loop timer).
#[cfg(target_arch = "wasm32")]
async fn backoff(ms: u32) {
    gloo_timers::future::TimeoutFuture::new(ms).await;
}

#[cfg(not(target_arch = "wasm32"))]
async fn backoff(_ms: u32) {}

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

    // Bring up enabled browser MCP servers, discover their tools, and add them to
    // this run's allowlist so the model can see and call them. Browser-only: on the
    // host test runner there is no Web Worker, so this is a no-op and `enabled_tools`
    // is unchanged. MCP tool output is untrusted DATA, handled exactly like any other
    // tool result by the loop below.
    #[cfg(target_arch = "wasm32")]
    let enabled_tools = {
        let mut enabled_tools = enabled_tools;
        let mcp_tools = crate::mcp::registry::bring_up_enabled(
            &snapshot.mcp_servers,
            &mut run,
            &agent_id,
            &mut observer,
        )
        .await;
        enabled_tools.extend(mcp_tools);
        enabled_tools
    };

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
    // The roster of peer agents this run can see and delegate to (everyone enabled
    // except the agent currently running). Rendered into the prompt's sub-agent
    // section by `agent_prompt`.
    let sub_agents = sub_agent_roster(&snapshot, &agent_id);
    let validators = ValidatorRegistry;
    // Prior conversation turns so the agent carries its session forward instead of
    // treating every query as a fresh start.
    let conversation = conversation_seed(&snapshot.runs);
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
                "Sending {} prior conversation message(s), the query, and {} in-run message(s).",
                conversation.len(),
                run.messages.len()
            ),
        ));
        observer(run.clone());

        // Full ordered transcript: prior conversation, the current query, then this
        // run's accumulated ReAct turns.
        let mut history = conversation.clone();
        history.push(Message {
            role: "user".to_string(),
            content: run.goal.clone(),
        });
        history.extend(run.messages.iter().cloned());

        let request = InferenceRequest {
            agent_name: agent.name.clone(),
            agent_role: agent.role.clone(),
            soul: snapshot.soul.clone(),
            skills: snapshot.skills.clone(),
            goal: run.goal.clone(),
            history,
            tools: specs.clone(),
            sub_agents: sub_agents.clone(),
            response_format: agent.response_format,
        };

        let mut sink = |_partial: String| {};
        // Auto-recovery: a transient provider/network failure should not kill the
        // run. Retry a few times with backoff; only if every attempt fails do we
        // stop — and then we *pause* (resumable) rather than hard-error, so the app
        // and the conversation stay intact and the user can Resume.
        const MAX_MODEL_ATTEMPTS: u32 = 3;
        let mut attempt = 0u32;
        let output = loop {
            attempt += 1;
            match inference
                .invoke_react_streaming(&provider, request.clone(), &mut sink)
                .await
            {
                Ok(output) => break Some(output),
                Err(err) => {
                    run.events.push(event(
                        &run.id,
                        Some(agent_id.clone()),
                        AgentEventKind::Error,
                        format!("Model call failed (attempt {attempt}/{MAX_MODEL_ATTEMPTS})"),
                        err,
                    ));
                    observer(run.clone());
                    if attempt >= MAX_MODEL_ATTEMPTS {
                        break None;
                    }
                    backoff(300 * attempt).await;
                }
            }
        };
        let output = match output {
            Some(output) => output,
            None => {
                run.status = "paused".to_string();
                if run.final_answer.trim().is_empty() {
                    run.final_answer = "Paused: the model provider could not be reached after several attempts. Check the Provider settings, then press Resume to continue.".to_string();
                }
                run.events.push(event(
                    &run.id,
                    Some(agent_id.clone()),
                    AgentEventKind::Interrupted,
                    "Run paused (provider unreachable)",
                    truncate(&run.final_answer, 300),
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
                let final_text = parsed.final_text();
                if validate_final_answer_or_feedback(
                    &validators,
                    &mut run,
                    Some(agent_id.clone()),
                    &final_text,
                ) {
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
                observer(run.clone());
                if run.status == "error" {
                    break;
                }
            }
            ReActAction::Tool => {
                let calls = parse_tool_calls(&parsed.response);
                if calls.is_empty() {
                    // The model chose a tool but produced no parseable call. Validate
                    // its text like any other final answer instead of returning raw,
                    // unvalidated output.
                    let final_text = parsed.final_text();
                    if validate_final_answer_or_feedback(
                        &validators,
                        &mut run,
                        Some(agent_id.clone()),
                        &final_text,
                    ) {
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
                    observer(run.clone());
                    if run.status == "error" {
                        break;
                    }
                    continue;
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

                    let result = if tool_allowed(&call.name, &enabled_tools) {
                        executor
                            .execute_domain_tool(
                                &mut snapshot,
                                call_id.clone(),
                                &call.name,
                                call.args.clone(),
                            )
                            .await
                    } else {
                        disallowed_tool_result(call_id.clone(), &call.name, &enabled_tools)
                    };
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
                    let tool_result_valid = validate_tool_result_or_feedback(
                        &validators,
                        &mut run,
                        Some(agent_id.clone()),
                        &call.name,
                        &result,
                    );
                    // Tool output is untrusted DATA. A validated successful result enters
                    // the conversation as evidence; validation failures re-enter as
                    // structured feedback instead.
                    if tool_result_valid {
                        run.messages.push(Message {
                            role: "tool".to_string(),
                            content: format!("{} -> {}", call.name, result.content),
                        });
                        push_observation(&mut run, &call.name, truncate(&result.content, 400));
                    }
                    run.tool_results.push(result);
                    observer(run.clone());
                    if run.status == "error" {
                        break;
                    }
                }
            }
        }

        if run.status == "error" {
            break;
        }
        observer(run.clone());
    }

    finalize_status(&mut run, answered);

    snapshot.status = match run.status.as_str() {
        "complete" => "Run complete.".to_string(),
        "interrupted" => "Run interrupted.".to_string(),
        "paused" => "Run paused — press Resume to continue.".to_string(),
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
        "error" | "interrupted" | "paused" => {}
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

fn tool_allowed(tool_name: &str, enabled_tools: &[String]) -> bool {
    enabled_tools.iter().any(|allowed| allowed == tool_name)
}

fn disallowed_tool_result(
    call_id: String,
    tool_name: &str,
    enabled_tools: &[String],
) -> crate::state::ToolResult {
    let allowlist = if enabled_tools.is_empty() {
        "<empty>".to_string()
    } else {
        enabled_tools.join(", ")
    };
    crate::state::ToolResult {
        call_id,
        ok: false,
        content: format!(
            "Tool `{tool_name}` is not in this agent's tool allowlist. Allowed tools: {allowlist}."
        ),
    }
}

fn validate_tool_result_or_feedback(
    validators: &ValidatorRegistry,
    run: &mut AgentRun,
    agent_id: Option<String>,
    tool_name: &str,
    result: &crate::state::ToolResult,
) -> bool {
    let validation = validators.validate_tool_result(tool_name, result, run);
    if validation.ok {
        run.events.push(event(
            &run.id,
            agent_id,
            AgentEventKind::Verification,
            format!("Tool result validated: {tool_name}"),
            truncate(&result.content, 600),
        ));
        return true;
    }

    let feedback = format!(
        "Validator feedback for tool `{tool_name}`: {}",
        validation.feedback
    );
    run.events.push(event(
        &run.id,
        agent_id,
        AgentEventKind::Verification,
        format!("Tool result rejected: {tool_name}"),
        truncate(&feedback, 600),
    ));
    run.messages.push(Message {
        role: "user".to_string(),
        content: feedback.clone(),
    });
    push_observation(run, "validator", truncate(&feedback, 400));
    mark_validation_error_if_budget_exceeded(run);
    false
}

fn validate_final_answer_or_feedback(
    validators: &ValidatorRegistry,
    run: &mut AgentRun,
    agent_id: Option<String>,
    answer: &str,
) -> bool {
    let validation = validators.validate_final_answer(answer, run);
    if validation.ok {
        run.final_answer = answer.trim().to_string();
        run.events.push(event(
            &run.id,
            agent_id,
            AgentEventKind::Verification,
            "Final answer validated",
            truncate(&run.final_answer, 600),
        ));
        return true;
    }

    let feedback = format!("Validator feedback: {}", validation.feedback);
    run.events.push(event(
        &run.id,
        agent_id,
        AgentEventKind::Verification,
        "Final answer rejected",
        truncate(&feedback, 600),
    ));
    run.messages.push(Message {
        role: "user".to_string(),
        content: feedback.clone(),
    });
    push_observation(run, "validator", truncate(&feedback, 400));
    mark_validation_error_if_budget_exceeded(run);
    false
}

fn mark_validation_error_if_budget_exceeded(run: &mut AgentRun) {
    let failures = run.scratchpad.verification.failures.len() as u32;
    let max_failures = run.scratchpad.budgets.max_verification_retries.max(1);
    if failures > max_failures {
        run.status = "error".to_string();
        run.final_answer = format!(
            "Validation failed after {failures} rejected output(s): {}",
            run.scratchpad.verification.last_result
        );
        run.events.push(event(
            &run.id,
            None,
            AgentEventKind::Error,
            "Validation retry budget exceeded",
            truncate(&run.final_answer, 600),
        ));
    }
}

/// Build the prior-conversation context from completed runs so the agent has a
/// session memory. Each completed turn contributes the user's query and the
/// agent's final answer. Bounded to the most recent turns to keep context in budget.
fn conversation_seed(runs: &[AgentRun]) -> Vec<Message> {
    const MAX_TURNS: usize = 12;
    let start = runs.len().saturating_sub(MAX_TURNS);
    let mut messages = Vec::new();
    for prior in &runs[start..] {
        if !prior.goal.trim().is_empty() {
            messages.push(Message {
                role: "user".to_string(),
                content: prior.goal.clone(),
            });
        }
        if !prior.final_answer.trim().is_empty() {
            messages.push(Message {
                role: "assistant".to_string(),
                content: prior.final_answer.clone(),
            });
        }
    }
    messages
}

/// The sub-agent roster the running agent can see and delegate to: every enabled
/// agent except the one currently running, reduced to its name + one-line summary.
pub(crate) fn sub_agent_roster(
    snapshot: &AppSnapshot,
    current_agent_id: &str,
) -> Vec<SubAgentInfo> {
    snapshot
        .agents
        .iter()
        .filter(|agent| agent.enabled && agent.id != current_agent_id)
        .map(|agent| SubAgentInfo {
            name: agent.name.clone(),
            description: agent.short_description(),
        })
        .collect()
}

pub(crate) fn pick_agent(snapshot: &AppSnapshot) -> Agent {
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
            max_verification_retries: snapshot.orchestrator.verification_retries,
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

    #[test]
    fn rejects_tool_not_in_agent_allowlist_before_execution() {
        let allowed = vec!["web_search".to_string()];

        assert!(tool_allowed("web_search", &allowed));
        assert!(!tool_allowed("file_write", &allowed));

        let result =
            disallowed_tool_result("call-hidden-write".to_string(), "file_write", &allowed);
        assert!(!result.ok);
        assert!(
            result
                .content
                .contains("not in this agent's tool allowlist")
        );
        assert!(result.content.contains("web_search"));
    }

    fn test_run_with_evidence() -> AgentRun {
        let mut run = AgentRun {
            id: "run-1".to_string(),
            goal: "answer with evidence".to_string(),
            status: "running".to_string(),
            lane: RunLane::BoundedTask,
            scratchpad: RunScratchpad::default(),
            messages: Vec::new(),
            events: Vec::new(),
            tool_calls: Vec::new(),
            tool_results: Vec::new(),
            final_answer: String::new(),
            created_at: "now".to_string(),
        };
        run.tool_results.push(crate::state::ToolResult {
            call_id: "call-1".to_string(),
            ok: true,
            content: "2 + 2 = 4".to_string(),
        });
        run
    }

    #[test]
    fn final_answer_validation_reenters_loop_on_failure() {
        let validators = ValidatorRegistry;
        let mut run = test_run_with_evidence();

        let accepted = validate_final_answer_or_feedback(
            &validators,
            &mut run,
            Some("agent-1".to_string()),
            "The answer is seven.",
        );

        assert!(!accepted);
        assert!(run.final_answer.is_empty());
        assert!(
            run.messages
                .last()
                .unwrap()
                .content
                .contains("Validator feedback")
        );
        assert_eq!(
            run.events.last().unwrap().kind,
            AgentEventKind::Verification
        );
    }

    #[test]
    fn finalize_status_preserves_paused_run() {
        let mut run = test_run_with_evidence();
        run.status = "paused".to_string();
        run.final_answer = "Paused: provider unreachable.".to_string();
        finalize_status(&mut run, false);
        // A paused (recoverable) run must not be flipped to complete on finalize.
        assert_eq!(run.status, "paused");
        assert_eq!(run.final_answer, "Paused: provider unreachable.");
    }

    #[test]
    fn final_answer_validation_accepts_grounded_answer() {
        let validators = ValidatorRegistry;
        let mut run = test_run_with_evidence();

        let accepted = validate_final_answer_or_feedback(
            &validators,
            &mut run,
            Some("agent-1".to_string()),
            "The evidence says 2 + 2 = 4.",
        );

        assert!(accepted);
        assert_eq!(run.final_answer, "The evidence says 2 + 2 = 4.");
        assert_eq!(
            run.events.last().unwrap().kind,
            AgentEventKind::Verification
        );
    }
}
