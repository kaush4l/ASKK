//! The per-phase, per-turn loop (docs/ARCHITECTURE.md §Execution lifecycle):
//! check budgets → assemble → infer (retries) → parse (bounded repairs) →
//! absorb → dispatch tools through the action gate → route answers through
//! phase gate semantics (ADR-008). Every step emits a stamped signal.

use askk_core::phase::route;
use askk_core::{
    contracts, Action, Contract, Element, InferenceConfig, InferenceReply, InferenceRequest,
    Message, OutputMode, ParsedFormat, ParsedResponse, PhaseFrame, ProviderError, Role,
    RouteOutcome, Routing, RunStatus, Sheet, Signal, SignalKind, Skill, ToolSet,
};
use serde_json::{Map, Value};

use crate::assemble::assemble;
use crate::config::AgentConfig;
use crate::run::dispatch::{dispatch_queued, Dispatch};
use crate::run::session::{RunState, Shared};
use crate::state::StoreError;

/// Bounded repairs per turn; the next failure falls back to raw text.
pub(crate) const MAX_REPAIRS_PER_TURN: u32 = 2;
/// Provider attempts per LLM call (1 + 2 retries with backoff).
pub(crate) const MAX_PROVIDER_ATTEMPTS: u32 = 3;
/// Injected on the last budgeted turn (ADR-008 final-turn nudge).
pub(crate) const FINAL_TURN_NUDGE: &str =
    "This is your final turn. Answer now with your best result; do not call tools.";

pub(crate) enum Turn {
    Continue,
    Paused,
    Terminal,
}

/// Stamp one signal: append to the log (single writer), mirror into the
/// run's own stream, hand it to the host's live sink.
pub(crate) async fn emit(
    shared: &Shared,
    run: &mut RunState,
    kind: SignalKind,
) -> Result<(), StoreError> {
    // Take the log out of its cell for the await: no RefCell borrow lives
    // across the suspend point, and a reentrant append (which would break
    // the single-writer contract) fails loudly here instead of racing.
    let mut log = shared
        .log
        .borrow_mut()
        .take()
        .expect("single writer: reentrant signal append");
    let appended = log.append(kind, run.id.clone()).await;
    *shared.log.borrow_mut() = Some(log);
    let signal: Signal = appended?;
    if let Some(host) = shared.host.borrow().as_ref() {
        host.on_signal(&signal);
    }
    run.signals.push(signal);
    Ok(())
}

/// Append an observation: history (Role::Tool) + signal. Tool failures,
/// denials, rejections, and repair prompts all land here — the model reads
/// them and adapts; nothing throws into the loop.
pub(crate) async fn observe(
    shared: &Shared,
    run: &mut RunState,
    text: String,
) -> Result<(), StoreError> {
    run.history.push(Message::new(Role::Tool, text.clone()));
    emit(shared, run, SignalKind::ObservationAppended { text }).await
}

/// A store failure is a run terminal, not a panic. Best-effort Error signal.
pub(crate) async fn fail_run(shared: &Shared, run: &mut RunState, error: &StoreError) {
    run.status = RunStatus::Failed;
    let _ = emit(
        shared,
        run,
        SignalKind::Error {
            message: error.to_string(),
        },
    )
    .await;
}

/// Drive one run until a terminal status or a confirmation pause.
pub(crate) async fn drive_run(shared: &Shared, run: &mut RunState) -> Result<(), StoreError> {
    if run.awaiting.is_some() {
        return Ok(()); // parked on a confirmation; resolve_action resumes
    }
    let host = shared.host();
    if run.started_ms == 0 {
        run.started_ms = host.now_ms();
    }
    loop {
        if run.status.is_terminal() {
            return Ok(());
        }
        // (a) every wait has an owner and a terminal (ADR-011).
        if run.cancel_requested || host.interrupted() {
            emit(shared, run, SignalKind::Interrupted).await?;
            run.status = RunStatus::Interrupted;
            return Ok(());
        }
        let over_deadline =
            host.now_ms().saturating_sub(run.started_ms) >= shared.budgets.deadline_ms;
        if run.turns >= shared.budgets.max_turns || over_deadline {
            emit(
                shared,
                run,
                SignalKind::StatusSet {
                    status: RunStatus::BudgetExhausted,
                },
            )
            .await?;
            run.status = RunStatus::BudgetExhausted;
            return Ok(());
        }
        if shared.budgets.is_final_turn(run.turns) && !run.nudged {
            run.nudged = true;
            run.history.push(Message::new(Role::User, FINAL_TURN_NUDGE));
            emit(
                shared,
                run,
                SignalKind::HistoryAppended {
                    role: Role::User,
                    text: FINAL_TURN_NUDGE.to_string(),
                },
            )
            .await?;
        }
        if !run.phase_entered {
            let name = run.phases[run.phase_idx].name.clone();
            emit(shared, run, SignalKind::PhaseEntered { name }).await?;
            run.phase_entered = true;
        }
        match one_turn(shared, run).await? {
            Turn::Continue => {}
            Turn::Paused | Turn::Terminal => return Ok(()),
        }
    }
}

/// One turn: assemble → infer → parse (bounded repairs) → absorb → act.
async fn one_turn(shared: &Shared, run: &mut RunState) -> Result<Turn, StoreError> {
    let agent = shared
        .agents
        .get(&run.agent_id)
        .expect("run built from a validated agent")
        .clone();
    let phase = run.phases[run.phase_idx].clone();
    let contract = contracts::lookup(&phase.contract).expect("validated contract");
    let toolset = effective_toolset(shared, run)?;

    let mut repairs = 0u32;
    let (mut sheet, parsed) = loop {
        let sheet = build_sheet(shared, run, &agent, &phase, &contract, &toolset);
        let Some(reply) = infer_with_retry(shared, run, &agent, &sheet.render()).await? else {
            return Ok(Turn::Terminal); // provider failed after retries
        };
        match contract.parse(&reply) {
            Ok(parsed) => {
                run.negotiator.record_success(parsed.format);
                emit(
                    shared,
                    run,
                    SignalKind::ParseOutcome {
                        ok: true,
                        format: format_str(parsed.format).into(),
                        honored: run.negotiator.honored(),
                    },
                )
                .await?;
                break (sheet, parsed);
            }
            Err(failure) => {
                run.negotiator.record_failure();
                // Mode read AFTER the failure: escalation to JSON is visible
                // right here in the signal stream.
                emit(
                    shared,
                    run,
                    SignalKind::ParseOutcome {
                        ok: false,
                        format: mode_str(run.negotiator.mode()).into(),
                        honored: false,
                    },
                )
                .await?;
                repairs += 1;
                if repairs > MAX_REPAIRS_PER_TURN {
                    // Out of repairs: the raw text is the answer candidate.
                    let parsed = ParsedResponse {
                        fields: Map::new(),
                        action: Action::Answer(reply.text.trim().to_string()),
                        format: ParsedFormat::Repaired,
                    };
                    break (sheet, parsed);
                }
                observe(shared, run, failure.repair_prompt).await?;
            }
        }
    };

    for signal in sheet.absorb(&parsed) {
        emit(shared, run, signal.kind).await?;
    }
    sync_back(run, &sheet);

    match parsed.action.clone() {
        Action::Answer(text) => handle_answer(shared, run, &phase, &parsed, text).await,
        Action::ToolCalls(calls) => {
            run.queued_calls = calls;
            match dispatch_queued(shared, run).await? {
                Dispatch::Paused => Ok(Turn::Paused),
                Dispatch::Done => Ok(Turn::Continue),
            }
        }
    }
}

/// Sheet assembly for this turn; the phase's contract and any negotiated
/// format escalation override the agent-level defaults.
fn build_sheet(
    shared: &Shared,
    run: &RunState,
    agent: &AgentConfig,
    phase: &askk_core::Phase,
    contract: &Contract,
    toolset: &ToolSet,
) -> Sheet {
    let skills: Vec<Skill> = agent
        .skills
        .iter()
        .filter_map(|id| shared.skills.iter().find(|s| &s.id == id))
        .map(|s| s.to_skill())
        .collect();
    let frame = run.declared.then(|| PhaseFrame {
        name: phase.name.clone(),
        header: phase.header.clone(),
        artifacts: run.artifacts.clone(),
    });
    let mut sheet = assemble(
        agent,
        &shared.soul,
        skills,
        &run.goal,
        run.snapshot.clone(),
        run.memory.clone(),
        run.history.clone(),
        toolset.specs(),
        Vec::new(),
        shared.policy.clone(),
        InferenceConfig {
            provider: agent.provider.clone(),
            ..Default::default()
        },
        frame,
    );
    if phase.contract != agent.contract {
        for element in &mut sheet.elements {
            if let Element::Contract(c) = element {
                *c = contract.clone();
            }
        }
    }
    if run.negotiator.mode() == OutputMode::Json && agent.format != OutputMode::Json {
        sheet.elements.push(Element::OutputMode(OutputMode::Json)); // escalated
    }
    sheet
}

/// Pull the absorb effects back out of the sheet into run state.
fn sync_back(run: &mut RunState, sheet: &Sheet) {
    for element in &sheet.elements {
        match element {
            Element::History(h) => run.history = h.clone(),
            Element::StateSnapshot(s) => run.snapshot = s.clone(),
            _ => {}
        }
    }
}

/// Phase toolset: phase filter ∩ the run's effective allowlist (ADR-004).
pub(crate) fn effective_allow(run: &RunState) -> Vec<String> {
    match &run.phases[run.phase_idx].tool_filter {
        Some(filter) => filter
            .iter()
            .filter(|t| run.allowed_tools.contains(t))
            .cloned()
            .collect(),
        None => run.allowed_tools.clone(),
    }
}

pub(crate) fn effective_toolset(shared: &Shared, run: &RunState) -> Result<ToolSet, StoreError> {
    shared
        .registry
        .build_tool_set(&effective_allow(run))
        .map_err(|e| StoreError::new(e.to_string()))
}

/// One LLM call: ≤3 attempts with host-owned backoff. `None` = the run
/// failed terminally (Error signal already emitted).
async fn infer_with_retry(
    shared: &Shared,
    run: &mut RunState,
    agent: &AgentConfig,
    request: &InferenceRequest,
) -> Result<Option<InferenceReply>, StoreError> {
    emit(shared, run, SignalKind::LlmRequest).await?;
    run.turns += 1;
    let provider = match (shared.resolver)(&agent.provider) {
        Ok(provider) => provider,
        Err(e) => {
            emit(
                shared,
                run,
                SignalKind::Error {
                    message: e.to_string(),
                },
            )
            .await?;
            run.status = RunStatus::Failed;
            return Ok(None);
        }
    };
    let host = shared.host();
    let mut last_error = None;
    for attempt in 0..MAX_PROVIDER_ATTEMPTS {
        let mut deltas: Vec<String> = Vec::new();
        let mut sink = |delta: &str| deltas.push(delta.to_string());
        match provider.infer(request, &mut sink).await {
            Ok(reply) => {
                for text in deltas {
                    emit(shared, run, SignalKind::LlmDelta { text }).await?;
                }
                emit(
                    shared,
                    run,
                    SignalKind::LlmResponse {
                        text: reply.text.clone(),
                    },
                )
                .await?;
                return Ok(Some(reply));
            }
            Err(e) => {
                let backoff = match &e {
                    ProviderError::RateLimited {
                        retry_after_ms: Some(ms),
                    } => *ms,
                    _ => 250 * (u64::from(attempt) + 1),
                };
                last_error = Some(e);
                if attempt + 1 < MAX_PROVIDER_ATTEMPTS {
                    host.sleep(backoff).await;
                }
            }
        }
    }
    let message = last_error.expect("loop ran at least once").to_string();
    emit(shared, run, SignalKind::Error { message }).await?;
    run.status = RunStatus::Failed;
    Ok(None)
}

/// Answer → phase routing with gate semantics (ADR-008). A gate phase whose
/// contract says `verdict: revise` routes back along its on_fail edge.
async fn handle_answer(
    shared: &Shared,
    run: &mut RunState,
    phase: &askk_core::Phase,
    parsed: &ParsedResponse,
    text: String,
) -> Result<Turn, StoreError> {
    let revise =
        phase.gate && parsed.fields.get("verdict").and_then(Value::as_str) == Some("revise");
    let proposed = if revise {
        let distance = phase
            .on_fail
            .as_ref()
            .and_then(|target| {
                run.phases[..run.phase_idx]
                    .iter()
                    .position(|p| &p.name == target)
                    .map(|i| run.phase_idx - i)
            })
            .unwrap_or(1);
        Routing::Back(distance)
    } else if phase.gate {
        Routing::Done
    } else {
        Routing::Next
    };
    match route(phase, proposed, run.back_edges) {
        RouteOutcome::Success => {
            run.artifacts.push((phase.name.clone(), text.clone()));
            emit(
                shared,
                run,
                SignalKind::Result {
                    final_text: text.clone(),
                },
            )
            .await?;
            run.status = RunStatus::Answered;
            run.final_text = Some(text);
            Ok(Turn::Terminal)
        }
        RouteOutcome::Advance => {
            run.artifacts.push((phase.name.clone(), text.clone()));
            run.phase_idx += 1;
            if run.phase_idx >= run.phases.len() {
                // Ran off the end without a gate pass: no false success.
                finish_unverified(shared, run, text).await?;
                return Ok(Turn::Terminal);
            }
            run.phase_entered = false;
            Ok(Turn::Continue)
        }
        RouteOutcome::Rewind(distance) => {
            run.back_edges += 1;
            run.phase_idx = run.phase_idx.saturating_sub(distance);
            run.phase_entered = false;
            let feedback = parsed
                .fields
                .get("feedback")
                .and_then(Value::as_str)
                .unwrap_or("");
            observe(
                shared,
                run,
                format!("Gate '{}' failed — revise. {feedback}", phase.name),
            )
            .await?;
            Ok(Turn::Continue)
        }
        RouteOutcome::Unverified => {
            finish_unverified(shared, run, text).await?;
            Ok(Turn::Terminal)
        }
    }
}

async fn finish_unverified(
    shared: &Shared,
    run: &mut RunState,
    text: String,
) -> Result<(), StoreError> {
    emit(
        shared,
        run,
        SignalKind::StatusSet {
            status: RunStatus::Unverified,
        },
    )
    .await?;
    emit(
        shared,
        run,
        SignalKind::Result {
            final_text: text.clone(),
        },
    )
    .await?;
    run.status = RunStatus::Unverified;
    run.final_text = Some(text);
    Ok(())
}

fn format_str(format: ParsedFormat) -> &'static str {
    match format {
        ParsedFormat::Native => "native",
        ParsedFormat::Json => "json",
        ParsedFormat::Toon => "toon",
        ParsedFormat::Repaired => "repaired",
    }
}

fn mode_str(mode: OutputMode) -> &'static str {
    match mode {
        OutputMode::Json => "json",
        OutputMode::Toon => "toon",
        OutputMode::Text => "text",
    }
}
