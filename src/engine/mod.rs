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

pub mod browser_exec;
pub mod exec_capability;
mod execution;
mod tool_dispatch;
mod validators;

use crate::inference::{
    InferenceOutput, InferenceProvider, InferenceRequest, OpenAiCompatibleInference, SubAgentInfo,
    get_implementation,
};
use crate::responses::{
    FormatNegotiator, ParseOutcome, ParsedResponse, ParsedToolCall, ReActAction, ReActResponse,
    ResponseFormat, StructuredResponse, parse_tool_calls,
};
use crate::state::{
    Agent, AgentEventKind, AgentRun, AppResult, AppSnapshot, Message, ProviderConfig, RunBudgets,
    RunLane, RunScratchpad, RunStatus, ScratchpadObservation, ToolCall, ToolSpec,
    default_tool_names, event, now_iso,
};
use crate::strategy::{
    LoopMode, MAX_BACK_EDGES, Phase, PhaseOutcome, Routing, Strategy, StrategyContext,
    StrategyRegistry, ToolPolicy, fallback_strategy, resolve_strategy_id,
};
use execution::{BrowserExecutionProvider, ExecutionProvider};
use std::cell::Cell;
use std::future::Future;
use std::pin::Pin;
use tool_dispatch::{PreparedCall, dispatch_tool_calls};
use uuid::Uuid;
use validators::ValidatorRegistry;

/// Boxed future returned by the engine entry points.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = AppResult<T>> + 'a>>;

/// Construction parameters for one loop invocation. Whoever builds a loop — the
/// chat entry, the worker runtime, or `call_agent` building a sub-loop — passes
/// the same struct; strategy travels with the work.
#[derive(Clone, Debug, Default)]
pub struct LoopParams {
    /// Agent to run (matched by id then name, case-insensitive). None = the
    /// first enabled agent, exactly as before.
    pub agent_id: Option<String>,
    /// Strategy override: explicit param → agent's `strategy_id` → "react".
    pub strategy: Option<String>,
    /// Per-invocation step-budget override. None = `snapshot.orchestrator.max_steps`.
    pub max_turns: Option<u32>,
}

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

    /// Run a goal with explicit loop parameters (agent, strategy, budget).
    pub fn run_with_params_and_observer<F>(
        &self,
        snapshot: AppSnapshot,
        goal: String,
        params: LoopParams,
        observer: F,
    ) -> BoxFuture<'_, AppSnapshot>
    where
        F: FnMut(AgentRun) + 'static,
    {
        if let Some(requested) = params.strategy.as_deref() {
            let registry = StrategyRegistry::new();
            if registry.get(requested).is_none() {
                let known = registry
                    .catalog()
                    .iter()
                    .map(|(id, _)| *id)
                    .collect::<Vec<_>>()
                    .join(", ");
                let message = format!("Unknown strategy `{requested}`. Known strategies: {known}.");
                return Box::pin(async move { Err(message) });
            }
        }
        let executor = self.executor.clone();
        Box::pin(async move { run_react_session(executor, snapshot, goal, params, observer).await })
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
                Some(goal) => {
                    run_react_session(executor, snapshot, goal, LoopParams::default(), observer)
                        .await
                }
                None => Err(format!("No job found with id {job_id}")),
            }
        })
    }
}

/// The smallest unit of the runtime: a **loop-object** that drives one agent goal to
/// a final answer.
///
/// `AgentLoop` separates the run's lifecycle into the two phases the Python reference
/// (`ReActAgent`) keeps apart: init-time work that is computed **once** in
/// [`AgentLoop::new`] (select the agent, resolve the provider/inference
/// implementation, build the tool allowlist seed, the sub-agent roster, the prior
/// conversation, and the per-run budgets), and the per-turn lifecycle —
/// construct-prompt → call-model → parse → decide-action — driven by [`AgentLoop::run`]
/// (with [`AgentLoop::step`] doing one turn).
///
/// The object is deliberately **dependency-light**: it is pure types plus calls into
/// the existing seams (the [`ExecutionProvider`] executor and the [`InferenceProvider`]
/// inference impl). It pulls in no `web-sys`/`gloo`/`wasm-bindgen` directly — all
/// platform divergence stays behind those seams, honoring the minimal-core principle.
///
/// Tool results and fetched content are always treated as untrusted DATA, never as
/// instructions to follow.
struct AgentLoop {
    /// The capability seam used to fetch tool specs and execute tool calls.
    executor: BrowserExecutionProvider,
    /// The agent selected for this run (its name/role/response-format drive prompting).
    agent: Agent,
    /// Cached `agent.id` — used as the actor on most events.
    agent_id: String,
    /// The inference implementation resolved from the run's provider config.
    inference: OpenAiCompatibleInference,
    /// The provider config for this run, with the active model profile applied.
    provider: ProviderConfig,
    /// The tool allowlist seed (per-agent enabled tools, or the defaults). Run-start
    /// MCP discovery extends a copy of this inside [`AgentLoop::run`]; the model only
    /// ever sees and calls tools on the resulting allowlist.
    enabled_tools: Vec<String>,
    /// The peer agents this run can see and delegate to.
    sub_agents: Vec<SubAgentInfo>,
    /// The shared soul/persona prompt, captured once at init (stable across the run).
    soul: String,
    /// The workspace skill library, captured once at init. Filtered per phase by a
    /// `SkillSelection` outcome before being shown to the model.
    skills: Vec<crate::state::Skill>,
    /// Prior conversation turns, so the agent carries its session forward.
    conversation: Vec<Message>,
    /// Output validators applied to tool results and the final answer.
    validators: ValidatorRegistry,
    /// The hard turn budget for the loop (always at least 1).
    max_steps: u32,
    /// The lane this goal was routed to (a timeline label / plan seed only).
    lane: RunLane,
    /// The strategy driving this run's phase sequence.
    strategy: &'static dyn Strategy,
}

/// What one [`AgentLoop::step`] decided the loop should do next.
enum StepOutcome {
    /// Keep looping: take another turn.
    Continue,
    /// Stop the loop. `answered` records whether a validated final answer was produced
    /// (vs. an interrupt, pause, validation error, or empty-tool stop).
    Stop { answered: bool },
}

impl AgentLoop {
    /// Init-time construction: do the **once-per-run** work and cache it. This mirrors
    /// `ReActAgent.__init__` in the reference — agent selection, provider/inference
    /// resolution, the tool allowlist seed, the sub-agent roster, the prior
    /// conversation, and the run budgets are all computed here, not per turn.
    ///
    /// Pure and synchronous: it touches no platform APIs and performs no I/O. The
    /// async, observer-driven run-start work (browser MCP bring-up) is deferred to
    /// [`AgentLoop::run`] because it needs the live `run` and `observer`.
    fn new(
        executor: BrowserExecutionProvider,
        snapshot: &AppSnapshot,
        goal: &str,
        params: &LoopParams,
    ) -> Self {
        let lane = classify_goal(goal);
        let agent = pick_agent(snapshot, params.agent_id.as_deref());
        let agent_id = agent.id.clone();
        let enabled_tools = if agent.enabled_tools.is_empty() {
            default_tool_names()
        } else {
            agent.enabled_tools.clone()
        };

        // Resolve the model profile (per-agent first, then the workspace active
        // profile) and apply its tuning onto the provider config used for this run.
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

        // The roster of peer agents this run can see and delegate to (everyone enabled
        // except the agent currently running). Rendered into the prompt's sub-agent
        // section by `agent_prompt`.
        let sub_agents = sub_agent_roster(snapshot, &agent_id);
        // Prior conversation turns so the agent carries its session forward instead of
        // treating every query as a fresh start.
        let conversation = conversation_seed(&snapshot.runs);
        let max_steps = params
            .max_turns
            .unwrap_or(snapshot.orchestrator.max_steps)
            .max(1);

        // Strategy resolution: explicit param → agent config → default.
        let registry = StrategyRegistry::new();
        let strategy_id =
            resolve_strategy_id(params.strategy.as_deref(), agent.strategy_id.as_deref());
        // TODO(task-9/10): surface a run event when a configured strategy_id fails to resolve instead of silently running react.
        let strategy = registry.get(&strategy_id).unwrap_or_else(fallback_strategy);

        Self {
            executor,
            agent,
            agent_id,
            inference,
            provider,
            enabled_tools,
            sub_agents,
            soul: snapshot.soul.clone(),
            skills: snapshot.skills.clone(),
            conversation,
            validators: ValidatorRegistry,
            max_steps,
            lane,
            strategy,
        }
    }

    /// Build the fresh [`AgentRun`] this loop drives, seeded from init-time state and
    /// the just-determined allowlist (including any MCP tools discovered at run start).
    fn build_run(&self, goal: &str, snapshot: &AppSnapshot, enabled_tools: &[String]) -> AgentRun {
        let run_id = Uuid::new_v4().to_string();
        let mut run = AgentRun {
            id: run_id.clone(),
            goal: goal.to_string(),
            status: RunStatus::Running,
            lane: self.lane,
            scratchpad: initial_scratchpad(snapshot, goal, self.lane),
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
            Some(self.agent_id.clone()),
            AgentEventKind::Routing,
            format!("Routing: {}", self.lane.as_label()),
            format!(
                "Classified into the {} ({}) lane. Compiled tools: {}.",
                self.lane.as_label(),
                self.lane.as_str(),
                enabled_tools.join(", ")
            ),
        ));
        run
    }

    /// Per-turn lifecycle: construct the prompt, call the model (with retry), parse the
    /// response, then decide the action — accept a validated final answer, or execute
    /// the parsed tool calls and feed their UNTRUSTED results back. Returns whether the
    /// outer loop should continue or stop. `turn` is 1-based.
    ///
    /// `snapshot` is passed in mutably because tool execution operates on it; the loop
    /// object stays immutable across turns (only the `run`, `snapshot`, and `observer`
    /// change).
    // The per-turn driver legitimately needs the run context, the tool specs/allowlist,
    // the cross-turn format negotiator, and the observer; bundling them into a struct
    // would obscure more than it clarifies for one private method.
    #[allow(clippy::too_many_arguments)]
    async fn step<F>(
        &self,
        turn: u32,
        phase: &Phase,
        context: &StrategyContext,
        snapshot: &mut AppSnapshot,
        run: &mut AgentRun,
        specs: &[ToolSpec],
        enabled_tools: &[String],
        format_negotiator: &mut FormatNegotiator,
        last_answer: &mut Option<String>,
        final_response: &mut Option<ReActResponse>,
        observer: &mut F,
    ) -> StepOutcome
    where
        F: FnMut(AgentRun),
    {
        run.scratchpad.budgets.steps_used = turn;
        run.events.push(event(
            &run.id,
            Some(self.agent_id.clone()),
            AgentEventKind::LlmRequest,
            format!("Model call (turn {turn})"),
            format!(
                "Sending {} prior conversation message(s), the query, and {} in-run message(s).",
                self.conversation.len(),
                run.messages.len()
            ),
        ));
        observer(run.clone());

        // Full ordered transcript: prior conversation, the per-phase goal text, then
        // this run's accumulated ReAct turns. For the react strategy's bare phase
        // `phase_goal` returns the goal untouched, preserving byte parity.
        let goal_text = phase_goal(phase, context, &run.goal);
        let mut history = self.conversation.clone();
        history.push(Message {
            role: "user".to_string(),
            content: goal_text.clone(),
        });
        history.extend(run.messages.iter().cloned());

        // Ask for the format the negotiator currently favors (escalated to JSON after
        // repeated TOON parse failures). Captured so we can score this turn's reply
        // against the format we actually requested.
        let requested_format = format_negotiator.format();
        let request =
            self.build_request(phase, context, goal_text, history, requested_format, specs);

        let Some(output) = call_model_with_retry(
            &self.inference,
            &self.provider,
            request,
            run,
            &self.agent_id,
            observer,
        )
        .await
        else {
            // Every attempt failed: the run was paused (resumable) inside the helper.
            return StepOutcome::Stop { answered: false };
        };

        // Score this reply against the format we requested and feed the negotiator: a
        // clean parse in the requested format resets the streak; anything else (a
        // different structured format or the lenient fallback) is a failure that moves
        // us toward requesting JSON. `output.parsed` stays the lenient best-effort value
        // the rest of the loop uses.
        let parse_outcome: ParseOutcome = phase.response_kind.parsed_format(&output.raw_text);
        format_negotiator.record(parse_outcome.honors(requested_format));
        let next_format = format_negotiator.format();
        if next_format != requested_format {
            run.events.push(event(
                &run.id,
                Some(self.agent_id.clone()),
                AgentEventKind::Routing,
                "Response format escalated",
                format!(
                    "Requesting {} after {} consecutive parse failure(s) on {}.",
                    next_format.as_form_value(),
                    format_negotiator.consecutive_failures(),
                    requested_format.as_form_value()
                ),
            ));
        }

        let parsed = output.parsed;
        *final_response = Some(parsed.clone());
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
            Some(self.agent_id.clone()),
            AgentEventKind::LlmResponse,
            format!("Model responded (turn {turn})"),
            truncate(&thinking, 600),
        ));
        if !thinking.trim().is_empty() {
            push_observation(run, &self.agent.name, thinking);
        }

        match parsed.action {
            ReActAction::Answer => {
                let final_text = parsed.final_text();
                if try_finalize_answer(
                    &self.validators,
                    run,
                    &self.agent_id,
                    &final_text,
                    "Final answer",
                ) {
                    *last_answer = Some(final_text.clone());
                    observer(run.clone());
                    return StepOutcome::Stop { answered: true };
                }
                observer(run.clone());
                if run.status == RunStatus::Error {
                    return StepOutcome::Stop { answered: false };
                }
            }
            ReActAction::Tool => {
                let calls = parse_tool_calls(&parsed.response);
                if calls.is_empty() {
                    // The model chose a tool but produced no parseable call. Validate
                    // its text like any other final answer instead of returning raw,
                    // unvalidated output.
                    let final_text = parsed.final_text();
                    if try_finalize_answer(
                        &self.validators,
                        run,
                        &self.agent_id,
                        &final_text,
                        "Final answer (no tool call parsed)",
                    ) {
                        *last_answer = Some(final_text.clone());
                        observer(run.clone());
                        return StepOutcome::Stop { answered: true };
                    }
                    observer(run.clone());
                    if run.status == RunStatus::Error {
                        return StepOutcome::Stop { answered: false };
                    }
                    return StepOutcome::Continue;
                }

                self.execute_tool_calls(calls, snapshot, run, enabled_tools, observer)
                    .await;
            }
        }

        if run.status == RunStatus::Error {
            return StepOutcome::Stop { answered: false };
        }
        observer(run.clone());
        StepOutcome::Continue
    }

    /// Build one phase-aware model request. [`ToolPolicy`] filters the tool manifest;
    /// a `SkillSelection` outcome (carried in `context.selected_skills`) filters the
    /// skill set. The negotiated `requested_format` is rendered into
    /// `format_instructions` via the phase's [`ResponseKind`] — for the react phase
    /// (`ResponseKind::ReAct`) this is byte-identical to the previous inline literal.
    fn build_request(
        &self,
        phase: &Phase,
        context: &StrategyContext,
        goal: String,
        history: Vec<Message>,
        requested_format: ResponseFormat,
        specs: &[ToolSpec],
    ) -> InferenceRequest {
        let tools = match phase.tool_policy {
            ToolPolicy::NoTools => Vec::new(),
            ToolPolicy::Inherit => specs.to_vec(),
            ToolPolicy::Subset(names) => specs
                .iter()
                .filter(|spec| names.contains(&spec.name.as_str()))
                .cloned()
                .collect(),
        };
        let base_skills = self.skills.clone();
        let skills = match &context.selected_skills {
            Some(selected) => base_skills
                .iter()
                .filter(|skill| {
                    selected
                        .iter()
                        .any(|name| name.eq_ignore_ascii_case(&skill.name))
                })
                .cloned()
                .collect(),
            None => base_skills,
        };
        InferenceRequest {
            agent_name: self.agent.name.clone(),
            agent_role: self.agent.role.clone(),
            soul: self.soul.clone(),
            skills,
            goal,
            history,
            tools,
            sub_agents: self.sub_agents.clone(),
            now: crate::state::now_iso(),
            format_instructions: phase.response_kind.instructions(requested_format),
        }
    }

    /// Run a Loop-mode phase: the original per-turn ReAct loop, bounded by the phase
    /// budget (`max_turns`, 0 = the loop's global step budget) and the remaining global
    /// budget. Returns the phase outcome, or `None` when the run stopped (interrupt,
    /// pause, error) — in which case run status/events already say why. A validated
    /// final answer is recorded into `last_answer` and produces a ReAct outcome.
    #[allow(clippy::too_many_arguments)]
    async fn run_loop_phase<F>(
        &self,
        phase: &Phase,
        max_turns: u32,
        context: &StrategyContext,
        snapshot: &mut AppSnapshot,
        run: &mut AgentRun,
        specs: &[ToolSpec],
        enabled_tools: &[String],
        steps_used: &mut u32,
        format_negotiator: &mut FormatNegotiator,
        last_answer: &mut Option<String>,
        observer: &mut F,
    ) -> Option<PhaseOutcome>
    where
        F: FnMut(AgentRun),
    {
        let phase_budget = if max_turns == 0 {
            self.max_steps
        } else {
            max_turns
        };
        let mut turns_this_phase: u32 = 0;
        let mut final_response: Option<ReActResponse> = None;

        while turns_this_phase < phase_budget && *steps_used < self.max_steps {
            if interrupt_requested() {
                mark_interrupted(run, "Run interrupted before the next model call.");
                observer(run.clone());
                return None;
            }
            *steps_used += 1;
            turns_this_phase += 1;

            match self
                .step(
                    *steps_used,
                    phase,
                    context,
                    snapshot,
                    run,
                    specs,
                    enabled_tools,
                    format_negotiator,
                    last_answer,
                    &mut final_response,
                    observer,
                )
                .await
            {
                StepOutcome::Continue => {}
                StepOutcome::Stop { answered } => {
                    if !answered {
                        return None;
                    }
                    break;
                }
            }
        }

        Some(PhaseOutcome {
            phase: phase.name,
            response: ParsedResponse::ReAct(final_response.unwrap_or_else(|| {
                ReActResponse::from_raw("phase budget exhausted without an answer")
            })),
            turns_used: turns_this_phase,
        })
    }

    /// Run a OneShot phase: one model call, no tool dispatch, parsed by the phase's
    /// response kind. The raw reply is recorded to `run.messages` so later phases carry
    /// it forward. Returns `None` on an unrecoverable model error (the run is already
    /// paused by [`call_model_with_retry`]) or an interrupt. The `react` strategy never
    /// uses OneShot — this is built and tested now for the multi-phase strategies that
    /// arrive in later tasks.
    #[allow(clippy::too_many_arguments)]
    async fn run_one_shot_phase<F>(
        &self,
        phase: &Phase,
        context: &StrategyContext,
        snapshot: &mut AppSnapshot,
        run: &mut AgentRun,
        specs: &[ToolSpec],
        steps_used: &mut u32,
        format_negotiator: &mut FormatNegotiator,
        observer: &mut F,
    ) -> Option<PhaseOutcome>
    where
        F: FnMut(AgentRun),
    {
        let _ = snapshot;
        if interrupt_requested() {
            mark_interrupted(run, "Run interrupted before the next model call.");
            observer(run.clone());
            return None;
        }
        *steps_used += 1;

        let goal_text = phase_goal(phase, context, &run.goal);
        let mut history = self.conversation.clone();
        history.push(Message {
            role: "user".to_string(),
            content: goal_text.clone(),
        });
        history.extend(run.messages.iter().cloned());

        let requested_format = format_negotiator.format();
        let request =
            self.build_request(phase, context, goal_text, history, requested_format, specs);
        let output = call_model_with_retry(
            &self.inference,
            &self.provider,
            request,
            run,
            &self.agent_id,
            observer,
        )
        .await?;

        let parse_outcome = phase.response_kind.parsed_format(&output.raw_text);
        format_negotiator.record(parse_outcome.honors(requested_format));
        run.messages.push(Message {
            role: "assistant".to_string(),
            content: output.raw_text.clone(),
        });
        observer(run.clone());

        Some(PhaseOutcome {
            phase: phase.name,
            response: phase.response_kind.parse(&output.raw_text),
            turns_used: 1,
        })
    }

    /// Execute the parsed tool calls for one turn and feed their results back.
    ///
    /// Each tool's output is UNTRUSTED DATA: a validated successful result enters the
    /// conversation as evidence, while a validation failure re-enters as structured
    /// feedback instead — never as an instruction the model must obey. A tool not on
    /// the allowlist short-circuits to a rejection result without executing.
    async fn execute_tool_calls<F>(
        &self,
        calls: Vec<ParsedToolCall>,
        snapshot: &mut AppSnapshot,
        run: &mut AgentRun,
        enabled_tools: &[String],
        observer: &mut F,
    ) where
        F: FnMut(AgentRun),
    {
        // === Parallel dual tool-call dispatch (unit #4) ===
        // A model turn may emit >= 2 tool calls. Prepare them all (assign ids, record the
        // requests, and apply the allowlist gate — the single visible gate per invariant
        // 7), then run them CONCURRENTLY via `dispatch_tool_calls` and feed the ordered
        // observations back exactly as the old sequential loop did. The single-call path
        // is unchanged in effect. Tool output is untrusted DATA throughout.
        let prepared = calls
            .iter()
            .map(|call| {
                let call_id = Uuid::new_v4().to_string();
                run.tool_calls.push(ToolCall {
                    id: call_id.clone(),
                    agent_id: self.agent_id.clone(),
                    tool_name: call.name.clone(),
                    arguments: call.args.clone(),
                });
                run.events.push(event(
                    &run.id,
                    Some(self.agent_id.clone()),
                    AgentEventKind::ToolRequested,
                    format!("Tool requested: {}", call.name),
                    truncate(&call.args.to_string(), 400),
                ));
                PreparedCall {
                    call_id,
                    name: call.name.clone(),
                    args: call.args.clone(),
                    allowed: tool_allowed(&call.name, enabled_tools),
                    enabled_tools: enabled_tools.to_vec(),
                }
            })
            .collect::<Vec<_>>();
        observer(run.clone());

        let results = dispatch_tool_calls(&self.executor, snapshot, &prepared).await;

        // Process observations IN CALL ORDER (the order `dispatch_tool_calls` returns),
        // so feedback into the conversation is deterministic regardless of which call
        // finished first.
        for (prepared_call, result) in prepared.iter().zip(results) {
            let tool_name = &prepared_call.name;
            let kind = if result.ok {
                AgentEventKind::ToolCompleted
            } else {
                AgentEventKind::Error
            };
            run.events.push(event(
                &run.id,
                Some(self.agent_id.clone()),
                kind,
                format!(
                    "Tool {}: {}",
                    if result.ok { "completed" } else { "failed" },
                    tool_name
                ),
                truncate(&result.content, 600),
            ));
            let tool_result_valid = validate_tool_result_or_feedback(
                &self.validators,
                run,
                Some(self.agent_id.clone()),
                tool_name,
                &result,
            );
            // Tool output is untrusted DATA. A validated successful result enters
            // the conversation as evidence; validation failures re-enter as
            // structured feedback instead.
            if tool_result_valid {
                run.messages.push(Message {
                    role: "tool".to_string(),
                    content: format!("{} -> {}", tool_name, result.content),
                });
                push_observation(run, tool_name, truncate(&result.content, 400));
            }
            run.tool_results.push(result);
            observer(run.clone());
            if run.status == RunStatus::Error {
                break;
            }
        }
        // === end parallel dual tool-call dispatch ===
    }

    /// Drive the goal to completion: run-start setup (MCP bring-up), then the per-turn
    /// loop up to `max_steps`, then finalize and persist the run into `snapshot`.
    /// Notifies `observer` after every state change.
    async fn run<F>(self, mut snapshot: AppSnapshot, goal: String, mut observer: F) -> AppSnapshot
    where
        F: FnMut(AgentRun),
    {
        // The allowlist the model actually sees: the init-time seed, plus any MCP
        // tools discovered at run start. Built before the first turn so the routing
        // event reflects the final tool set.
        let enabled_tools = self.enabled_tools.clone();
        let mut run = self.build_run(&goal, &snapshot, &enabled_tools);
        observer(run.clone());

        // Bring up enabled browser MCP servers, discover their tools, and add them to
        // this run's allowlist so the model can see and call them. Browser-only: on the
        // host test runner there is no Web Worker, so this is a no-op and `enabled_tools`
        // is unchanged. MCP tool output is untrusted DATA, handled exactly like any
        // other tool result by the loop below.
        #[cfg(target_arch = "wasm32")]
        let enabled_tools = {
            let mut enabled_tools = enabled_tools;
            let mcp_tools = crate::mcp::registry::bring_up_enabled(
                &snapshot.mcp_servers,
                &mut run,
                &self.agent_id,
                &mut observer,
            )
            .await;
            enabled_tools.extend(mcp_tools);
            enabled_tools
        };

        // Tool manifest the model is shown each turn. Computed once here, after the
        // allowlist is finalized (post-MCP), then reused every turn — exactly as the
        // original loop did.
        let specs = self.executor.domain_specs_for_agent(&enabled_tools);

        // Requested-format negotiation (Unit #2): persists across turns so a streak of
        // TOON parse failures can escalate the requested format to JSON (and one clean
        // parse relaxes it back). `step` feeds it each turn's outcome and reads back the
        // format to request next.
        let mut format_negotiator = FormatNegotiator::new(self.agent.response_format);

        // === Strategy driver ===
        // Drive the strategy's ordered phases. The `react` strategy is the degenerate
        // single-phase case (one `act` phase, `Loop { max_turns: 0 }`), so this loop
        // runs the original per-turn ReAct loop once and behaves identically except for
        // the two new PhaseStarted/PhaseCompleted timeline events.
        let phases = self.strategy.phases();
        let mut context = StrategyContext::default();
        let mut steps_used: u32 = 0;
        let mut last_answer: Option<String> = None;
        let mut phase_idx = 0usize;

        while phase_idx < phases.len() {
            let phase = &phases[phase_idx];
            push_phase_event(
                &mut run,
                &self.agent_id,
                AgentEventKind::PhaseStarted,
                phase.name,
                format!("Strategy `{}`, phase `{}`.", self.strategy.id(), phase.name),
            );
            // Record the phase as the active workflow step (timeline scratchpad only;
            // no gate-check is invoked — workflow gating re-targets in a later task).
            run.scratchpad.workflow.current_step = phase.name.to_string();
            run.scratchpad.workflow.history.push(phase.name.to_string());
            observer(run.clone());

            let outcome = match phase.loop_mode {
                LoopMode::OneShot => {
                    self.run_one_shot_phase(
                        phase,
                        &context,
                        &mut snapshot,
                        &mut run,
                        &specs,
                        &mut steps_used,
                        &mut format_negotiator,
                        &mut observer,
                    )
                    .await
                }
                LoopMode::Loop { max_turns } => {
                    self.run_loop_phase(
                        phase,
                        max_turns,
                        &context,
                        &mut snapshot,
                        &mut run,
                        &specs,
                        &enabled_tools,
                        &mut steps_used,
                        &mut format_negotiator,
                        &mut last_answer,
                        &mut observer,
                    )
                    .await
                }
            };

            let Some(outcome) = outcome else {
                // Interrupted, paused, or errored inside the phase: the phase runner
                // already updated run status/events. Stop the strategy.
                break;
            };

            // A OneShot ReAct phase (e.g. an orchestrate `synthesize` phase) produces
            // the final answer directly.
            if let (LoopMode::OneShot, ParsedResponse::ReAct(react)) =
                (phase.loop_mode, &outcome.response)
            {
                let final_text = react.final_text();
                if try_finalize_answer(
                    &self.validators,
                    &mut run,
                    &self.agent_id,
                    &final_text,
                    "Final answer",
                ) {
                    last_answer = Some(final_text);
                }
                observer(run.clone());
            }

            if let Some(artifact) = self.strategy.artifact(&outcome) {
                context.artifacts.retain(|(name, _)| name != &artifact.0);
                context.artifacts.push(artifact);
            }
            if let ParsedResponse::SkillSelection(selection) = &outcome.response {
                context.selected_skills = Some(selection.selected_skills.clone());
            }

            let routing = apply_back_edge_budget(
                self.strategy.route(phase_idx, &outcome),
                &mut context.back_edges_used,
            );
            push_phase_event(
                &mut run,
                &self.agent_id,
                AgentEventKind::PhaseCompleted,
                phase.name,
                format!(
                    "Routing: {routing:?} (back edges used: {}).",
                    context.back_edges_used
                ),
            );
            observer(run.clone());

            match routing {
                Routing::Next => phase_idx += 1,
                Routing::Back(target) => phase_idx = target.min(phases.len() - 1),
                Routing::Done => break,
            }
        }

        let answered = last_answer.is_some();
        // === end strategy driver ===

        finalize_status(&mut run, answered);

        // finalize_status above guarantees a terminal status here (Running is flipped to
        // Complete), so every arm is a finished-run message.
        snapshot.status = match run.status {
            RunStatus::Complete | RunStatus::Running => "Run complete.".to_string(),
            RunStatus::Interrupted => "Run interrupted.".to_string(),
            RunStatus::Paused => "Run paused — press Resume to continue.".to_string(),
            RunStatus::Error => "Run failed.".to_string(),
        };
        snapshot.current_run = Some(run.clone());
        snapshot.runs.push(run.clone());
        // Keep the persisted run history bounded so the snapshot does not grow forever.
        let runs_len = snapshot.runs.len();
        if runs_len > 25 {
            snapshot.runs.drain(0..runs_len - 25);
        }
        observer(run);

        snapshot
    }
}

/// Drive one agent goal to a final answer, notifying `observer` after every state
/// change. A thin wrapper that constructs an [`AgentLoop`] (init-time work) and runs it
/// (per-turn lifecycle), preserving the engine's public entry-point behavior.
async fn run_react_session<F>(
    executor: BrowserExecutionProvider,
    snapshot: AppSnapshot,
    goal: String,
    params: LoopParams,
    observer: F,
) -> AppResult<AppSnapshot>
where
    F: FnMut(AgentRun),
{
    clear_interrupt();
    let agent_loop = AgentLoop::new(executor, &snapshot, &goal, &params);
    Ok(agent_loop.run(snapshot, goal, observer).await)
}

/// Call the model for one turn, retrying a transient failure a few times with
/// backoff. On success returns the parsed output. If every attempt fails the run is
/// *paused* (resumable, not hard-errored) and `None` is returned so the caller stops —
/// the app and conversation stay intact and the user can Resume.
async fn call_model_with_retry<P, F>(
    inference: &P,
    provider: &ProviderConfig,
    request: InferenceRequest,
    run: &mut AgentRun,
    agent_id: &str,
    observer: &mut F,
) -> Option<InferenceOutput<ReActResponse>>
where
    P: InferenceProvider,
    F: FnMut(AgentRun),
{
    const MAX_MODEL_ATTEMPTS: u32 = 3;
    let mut sink = |_partial: String| {};
    let mut attempt = 0u32;
    loop {
        attempt += 1;
        match inference
            .invoke_react_streaming(provider, request.clone(), &mut sink)
            .await
        {
            Ok(output) => return Some(output),
            Err(err) => {
                run.events.push(event(
                    &run.id,
                    Some(agent_id.to_string()),
                    AgentEventKind::Error,
                    format!("Model call failed (attempt {attempt}/{MAX_MODEL_ATTEMPTS})"),
                    err,
                ));
                observer(run.clone());
                if attempt < MAX_MODEL_ATTEMPTS {
                    backoff(300 * attempt).await;
                    continue;
                }
                run.status = RunStatus::Paused;
                if run.final_answer.trim().is_empty() {
                    run.final_answer = "Paused: the model provider could not be reached after several attempts. Check the Provider settings, then press Resume to continue.".to_string();
                }
                run.events.push(event(
                    &run.id,
                    Some(agent_id.to_string()),
                    AgentEventKind::Interrupted,
                    "Run paused (provider unreachable)",
                    truncate(&run.final_answer, 300),
                ));
                observer(run.clone());
                return None;
            }
        }
    }
}

fn finalize_status(run: &mut AgentRun, answered: bool) {
    match run.status {
        RunStatus::Error | RunStatus::Interrupted | RunStatus::Paused => {}
        _ => {
            run.status = RunStatus::Complete;
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

/// Validate `final_text` as the run's final answer and, on success, record the
/// terminal `FinalAnswer` event (titled per call site — the two call sites differ only
/// in whether the model emitted an explicit answer or a tool action with no parseable
/// call). Returns whether the answer was accepted; on rejection the caller emits
/// progress and decides whether to keep looping. Mutates `run` via the validators.
fn try_finalize_answer(
    validators: &ValidatorRegistry,
    run: &mut AgentRun,
    agent_id: &str,
    final_text: &str,
    event_title: &str,
) -> bool {
    if validate_final_answer_or_feedback(validators, run, Some(agent_id.to_string()), final_text) {
        run.events.push(event(
            &run.id,
            Some(agent_id.to_string()),
            AgentEventKind::FinalAnswer,
            event_title,
            truncate(&run.final_answer, 600),
        ));
        return true;
    }
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
        run.status = RunStatus::Error;
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

pub(crate) fn pick_agent(snapshot: &AppSnapshot, requested: Option<&str>) -> Agent {
    if let Some(needle) = requested.map(str::trim).filter(|needle| !needle.is_empty())
        && let Some(agent) = snapshot
            .agents
            .iter()
            .find(|agent| agent.id.eq_ignore_ascii_case(needle))
            .or_else(|| {
                snapshot
                    .agents
                    .iter()
                    .find(|agent| agent.name.eq_ignore_ascii_case(needle))
            })
    {
        return agent.clone();
    }
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

/// Compose the per-phase goal text: frame, then carried artifacts, then the goal.
/// The react strategy's bare phase (empty frame, no artifacts) returns the goal
/// untouched for byte parity with the original loop.
fn phase_goal(phase: &Phase, context: &StrategyContext, goal: &str) -> String {
    if phase.prompt_frame.trim().is_empty() && context.artifacts.is_empty() {
        return goal.to_string();
    }
    let mut parts: Vec<String> = Vec::new();
    if !phase.prompt_frame.trim().is_empty() {
        parts.push(phase.prompt_frame.trim().to_string());
    }
    for (name, content) in &context.artifacts {
        parts.push(format!(
            "## {} (from an earlier phase)\n{}",
            name.to_uppercase(),
            content
        ));
    }
    parts.push(format!("The goal: {goal}"));
    parts.join("\n\n")
}

/// Push a phase-lifecycle event (`PhaseStarted` / `PhaseCompleted`) onto the run
/// timeline, titled `Phase: <name>` with the supplied body.
fn push_phase_event(
    run: &mut AgentRun,
    agent_id: &str,
    kind: AgentEventKind,
    phase_name: &str,
    body: String,
) {
    run.events.push(event(
        &run.id,
        Some(agent_id.to_string()),
        kind,
        format!("Phase: {phase_name}"),
        body,
    ));
}

/// Enforce the back-edge cap: a `Back` beyond [`MAX_BACK_EDGES`] becomes `Done`, so
/// critique cycles are bounded by construction.
fn apply_back_edge_budget(routing: Routing, back_edges_used: &mut u32) -> Routing {
    match routing {
        Routing::Back(target) if *back_edges_used < MAX_BACK_EDGES => {
            *back_edges_used += 1;
            Routing::Back(target)
        }
        Routing::Back(_) => Routing::Done,
        other => other,
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
    run.status = RunStatus::Interrupted;
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
        // The engine owns the allowlist gate; the disallowed-call *result* is produced
        // by `tool_dispatch` (and covered by its own tests). Here we assert the gate.
        let allowed = vec!["web_search".to_string()];

        assert!(tool_allowed("web_search", &allowed));
        assert!(!tool_allowed("file_write", &allowed));
    }

    fn test_run_with_evidence() -> AgentRun {
        let mut run = AgentRun {
            id: "run-1".to_string(),
            goal: "answer with evidence".to_string(),
            status: RunStatus::Running,
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
        run.status = RunStatus::Paused;
        run.final_answer = "Paused: provider unreachable.".to_string();
        finalize_status(&mut run, false);
        // A paused (recoverable) run must not be flipped to complete on finalize.
        assert_eq!(run.status, RunStatus::Paused);
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

    #[test]
    fn loop_params_strategy_beats_agent_config() {
        use crate::strategy::resolve_strategy_id;
        assert_eq!(
            resolve_strategy_id(Some("plan-act-review"), Some("react")),
            "plan-act-review"
        );
        assert_eq!(
            resolve_strategy_id(None, Some("orchestrate")),
            "orchestrate"
        );
        assert_eq!(resolve_strategy_id(None, None), "react");
    }

    #[test]
    fn react_strategy_emits_phase_events_around_the_loop() {
        // The strategy driver wraps every phase in a PhaseStarted / PhaseCompleted
        // pair. The model call itself is browser-bound (it panics on the host runner),
        // so we drive the driver's phase-event emission directly against the real
        // `react` strategy — its single `act` phase, its `route` (always Done), and the
        // same `push_phase_event` / `apply_back_edge_budget` helpers `run` uses — and
        // assert the two events fire with the right title and routing body. This is the
        // host-testable proof of the parity behavior added by Task 5.
        let mut run = test_run_with_evidence();
        let strategy = fallback_strategy(); // the `react` strategy
        let phases = strategy.phases();
        let mut context = StrategyContext::default();

        for (idx, phase) in phases.iter().enumerate() {
            push_phase_event(
                &mut run,
                "agent-1",
                AgentEventKind::PhaseStarted,
                phase.name,
                format!("Strategy `{}`, phase `{}`.", strategy.id(), phase.name),
            );
            // The react phase is a `Loop`, so its outcome is a ReAct response; only the
            // routing decision matters for the PhaseCompleted body.
            let outcome = PhaseOutcome {
                phase: phase.name,
                response: ParsedResponse::ReAct(ReActResponse::from_raw(
                    "action: answer\nresponse: The evidence says 2 + 2 = 4.",
                )),
                turns_used: 1,
            };
            let routing =
                apply_back_edge_budget(strategy.route(idx, &outcome), &mut context.back_edges_used);
            push_phase_event(
                &mut run,
                "agent-1",
                AgentEventKind::PhaseCompleted,
                phase.name,
                format!(
                    "Routing: {routing:?} (back edges used: {}).",
                    context.back_edges_used
                ),
            );
        }

        assert!(run.events.iter().any(|event| {
            event.kind == AgentEventKind::PhaseStarted && event.title.contains("act")
        }));
        assert!(run.events.iter().any(|event| {
            event.kind == AgentEventKind::PhaseCompleted && event.body.contains("Done")
        }));
    }
}
