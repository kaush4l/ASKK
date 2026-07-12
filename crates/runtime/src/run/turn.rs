//! The per-phase, per-turn loop (docs/ARCHITECTURE.md §Execution lifecycle):
//! check budgets → assemble → infer (retries) → parse (bounded repairs) →
//! absorb → dispatch tools through the action gate → route answers through
//! phase gate semantics (ADR-008). Every step emits a stamped signal.

use askk_core::{
    window_history, Action, Contract, Element, InferenceConfig, InferenceReply, InferenceRequest,
    LoopMode, Message, OutputMode, ParsedFormat, ParsedResponse, PhaseFrame, ProviderError, Role,
    RunStatus, Sheet, Signal, SignalKind, Skill, ToolSet,
};
use futures::future::{select, Either};
use serde_json::Map;

use crate::assemble::{assemble, AssembleOverrides};
use crate::config::{resolve_contract, AgentConfig};
use crate::run::answer::handle_answer;
use crate::run::dispatch::{dispatch_queued, Dispatch};
use crate::run::flow::{enqueue_fan_out, reroute_exhausted};
use crate::run::live::live_artifacts;
use crate::run::session::{RunState, Shared};
use crate::state::StoreError;

/// Bounded repairs per turn; the next failure falls back to raw text.
pub(crate) const MAX_REPAIRS_PER_TURN: u32 = 2;
/// Provider attempts per LLM call (1 + 2 retries with backoff).
pub(crate) const MAX_PROVIDER_ATTEMPTS: u32 = 3;
/// Injected on the last budgeted turn (ADR-008 final-turn nudge).
pub(crate) const FINAL_TURN_NUDGE: &str =
    "This is your final turn. Answer now with your best result; do not call tools.";
/// A OneShot phase exists to produce ONE answer; tool calls get a small
/// allowance (reorient-then-answer), never the whole run budget — a model
/// that keeps calling tools must exhaust the phase, not the session
/// (live wave-19 finding: gemma held `plan` open re-calling a filtered tool).
pub(crate) const ONESHOT_MAX_TURNS: u32 = 4;

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
    // The async mutex serializes appends: concurrent runs (parallel drives,
    // parallel tool dispatch) queue here, preserving the single-writer
    // contract without a panic path (ADR-015).
    let mut log = shared.log.lock().await;
    let appended = log.append(kind, run.id.clone()).await;
    drop(log);
    let signal: Signal = appended?;
    if let Some(host) = shared.hosts.borrow().get(&run.id) {
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

/// Global budget/deadline guard: checked between turns AND before each
/// repair call (every repair is a provider call). True = terminal landed.
async fn out_of_budget(shared: &Shared, run: &mut RunState) -> Result<bool, StoreError> {
    let host = shared.host(&run.id);
    let over_deadline = host.now_ms().saturating_sub(run.started_ms) >= run.budgets.deadline_ms;
    if run.turns >= run.budgets.max_turns || over_deadline {
        emit(
            shared,
            run,
            SignalKind::StatusSet {
                status: RunStatus::BudgetExhausted,
            },
        )
        .await?;
        run.status = RunStatus::BudgetExhausted;
        return Ok(true);
    }
    Ok(false)
}

/// Drive one run until a terminal status or a confirmation pause.
pub(crate) async fn drive_run(shared: &Shared, run: &mut RunState) -> Result<(), StoreError> {
    if run.awaiting.is_some() {
        return Ok(()); // parked on a confirmation; resolve_action resumes
    }
    let host = shared.host(&run.id);
    if run.started_ms == 0 {
        run.started_ms = host.now_ms();
    }
    loop {
        if run.status.is_terminal() {
            return Ok(());
        }
        // (a) every wait has an owner and a terminal (ADR-011).
        if run.cancel_requested.get() || host.interrupted() {
            emit(shared, run, SignalKind::Interrupted).await?;
            run.status = RunStatus::Interrupted;
            return Ok(());
        }
        if out_of_budget(shared, run).await? {
            return Ok(());
        }
        if run.budgets.is_final_turn(run.turns) && !run.nudged {
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
            run.phase_turns = 0; // every (re-)entry gets a fresh clamp
            if run.phases[run.phase_idx].fan_out.is_some() {
                enqueue_fan_out(shared, run).await?;
                if dispatch_queued(shared, run).await? == Dispatch::Paused {
                    return Ok(());
                }
            }
        }
        // Per-phase clamp (ADR-011): a Loop phase spends at most its own
        // max_turns, a OneShot phase its small fixed allowance; min() with
        // the global budget falls out of check order (the global check
        // above fires first when it is the tighter bound). Exhaustion
        // without an answer is never success (ADR-008): with a declared
        // on_fail it routes back like a failed gate (bounded); otherwise
        // the run ends Unverified via the fall-off rules.
        let phase_clamp = match run.phases[run.phase_idx].loop_mode {
            LoopMode::Loop { max_turns } => max_turns,
            LoopMode::OneShot => ONESHOT_MAX_TURNS,
        };
        if run.phase_turns >= phase_clamp {
            if reroute_exhausted(shared, run).await? {
                continue;
            }
            emit(
                shared,
                run,
                SignalKind::StatusSet {
                    status: RunStatus::Unverified,
                },
            )
            .await?;
            run.status = RunStatus::Unverified;
            return Ok(());
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
        .agent_config(&run.agent_id)
        .expect("run built from a validated or spawned agent");
    let phase = run.phases[run.phase_idx].clone();
    let contract = resolve_contract(&agent, &phase.contract).expect("validated contract");
    let toolset = effective_toolset(shared, run)?;

    // Latest-state refresh (ADR-033): sources are re-read HERE, once per
    // turn, so every call sees current state — repairs within the turn reuse
    // it (no tool ran in between).
    let live = live_artifacts(shared, run, &agent).await;
    let mut repairs = 0u32;
    let (mut sheet, mut parsed) = loop {
        let sheet = build_sheet(shared, run, &agent, &phase, &contract, &toolset, &live);
        let Some(reply) = infer_with_retry(shared, run, &agent, &sheet.render()).await? else {
            return Ok(Turn::Terminal); // provider failed after retries, or cancelled mid-call
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
                    // Out of repairs: the raw text stands in as the answer,
                    // scaffold-stripped so history stays lean.
                    let parsed = ParsedResponse {
                        fields: Map::new(),
                        action: Action::Answer(contract.strip_scaffold(&reply.text)),
                        format: ParsedFormat::Repaired,
                    };
                    break (sheet, parsed);
                }
                observe(shared, run, failure.repair_prompt).await?;
                // The repair is another provider call: the budget/deadline
                // guard holds here too, not just between turns.
                if out_of_budget(shared, run).await? {
                    return Ok(Turn::Terminal);
                }
            }
        }
    };

    // Unique, run-qualified tool-call ids BEFORE absorb/dispatch: text-path
    // parses synthesize the same placeholder for every call, and parked
    // confirmations live in a session-wide map keyed by ActionId — ids must
    // never collide across runs. ponytail: provider-native ids are replaced
    // too (nothing round-trips them today); keep them alongside if a future
    // adapter needs tool_use id fidelity.
    if let Action::ToolCalls(calls) = &mut parsed.action {
        for call in calls {
            call.id = format!("{}-call-{}", run.id.0, run.call_seq);
            run.call_seq += 1;
        }
    }

    for signal in sheet.absorb(&parsed) {
        emit(shared, run, signal.kind).await?;
    }
    sync_back(run, &sheet);

    match parsed.action.clone() {
        Action::Answer(text) => {
            // An answer breaks any mutating-call stall streak (dispatch.rs).
            run.repeat_guard = None;
            handle_answer(shared, run, &phase, &parsed, text).await
        }
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
    live: &[(String, String)],
) -> Sheet {
    // Phase skill filter (mirrors tool_filter): None = the agent's full
    // skill set; Some = only those skills render this phase.
    let mut skills: Vec<Skill> = agent
        .skills
        .iter()
        .filter(|id| phase.skill_filter.as_ref().is_none_or(|f| f.contains(id)))
        .filter_map(|id| shared.skills.iter().find(|s| &s.id == id))
        .map(|s| s.to_skill())
        .collect();
    // The team-principles skill below is the team boundary contract — it
    // renders in EVERY phase, never subject to skill_filter.
    // A run inside a team carries the team.md body — the folder's shared
    // principles — into every member's prompt, same spirit as soul/skills
    // (ADR-032). ponytail: rides the Skills element, no new Element variant.
    if let Some(team) = run
        .team_id
        .as_ref()
        .and_then(|id| shared.teams.iter().find(|t| &t.id == id))
    {
        if !team.body.is_empty() {
            skills.push(Skill {
                name: format!("{} principles", team.name),
                body: team.body.clone(),
            });
        }
    }
    let frame = run.declared.then(|| PhaseFrame {
        name: phase.name.clone(),
        header: phase.header.clone(),
        artifacts: run.artifacts.clone(),
    });
    let overrides = AssembleOverrides {
        contract: (phase.contract != agent.contract).then(|| contract.clone()),
        directive: None,
        output_mode: (run.negotiator.mode() != agent.format).then(|| run.negotiator.mode()),
    };
    let mut sheet = assemble(
        agent,
        &shared.soul,
        skills,
        &run.goal,
        run.snapshot.clone(),
        run.memory.clone(),
        // The sheet carries a budgeted VIEW of the history; run.history
        // stays the full log (sync_back appends, never replaces).
        window_history(&run.history, run.budgets.max_context_chars),
        toolset.specs(),
        Vec::new(),
        shared.policy.clone(),
        InferenceConfig {
            provider: agent.provider.clone(),
            ..Default::default()
        },
        frame,
        overrides,
    );
    // Live artifacts render AFTER assemble's fixed order: latest task state,
    // re-read from its source this turn (ADR-033) — never part of history.
    if !live.is_empty() {
        sheet.elements.push(Element::Artifacts(live.to_vec()));
    }
    sheet
}

/// Pull the absorb effects back out of the sheet into run state. The sheet's
/// history is the WINDOWED view build_sheet assembled; only the messages
/// absorb appended beyond that view flow back — run.history stays the full
/// log, and elision markers never become durable history.
fn sync_back(run: &mut RunState, sheet: &Sheet) {
    // Deterministic recompute: run.history has not changed since the final
    // build_sheet, so this length equals the assembled view's length.
    let shown = window_history(&run.history, run.budgets.max_context_chars).len();
    for element in &sheet.elements {
        match element {
            Element::History(h) => run.history.extend(h.iter().skip(shown).cloned()),
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
    run.phase_turns += 1;
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
    let host = shared.host(&run.id);
    let run_id = run.id.clone();
    // Cloned Rc so no borrow of `run` is held across the select await.
    let cancel = run.cancel_requested.clone();
    let mut last_error = None;
    for attempt in 0..MAX_PROVIDER_ATTEMPTS {
        // Deltas reach the host sink AS THEY ARRIVE (`on_delta` is sync; the
        // log writer is async). They are transient UI signals — seq 0, never
        // logged: `LlmResponse` is the durable record and fold ignores
        // LlmDelta either way (ADR-003).
        let mut sink = |delta: &str| {
            host.on_signal(&Signal {
                seq: 0,
                run_id: run_id.clone(),
                ts_ms: host.now_ms(),
                kind: SignalKind::LlmDelta {
                    text: delta.to_string(),
                },
            });
        };
        // Race the in-flight call against the run's cancel token (GAPS 17):
        // on cancel the provider future is DROPPED mid-stream — FetchTransport
        // aborts the browser fetch on drop — and the run lands the same
        // Interrupted terminal as a between-turn cancel.
        let infer = provider.infer(request, &mut sink);
        let result = match select(infer, cancel.cancelled()).await {
            Either::Left((result, _)) => result,
            Either::Right(((), infer)) => {
                drop(infer); // stop consuming; the transport aborts the fetch
                emit(shared, run, SignalKind::Interrupted).await?;
                run.status = RunStatus::Interrupted;
                return Ok(None);
            }
        };
        match result {
            Ok(reply) => {
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
