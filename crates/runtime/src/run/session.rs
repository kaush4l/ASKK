//! RunSession: owns the validated config set, tool registry, provider seam,
//! signal log, stores, budgets, policy, and every run's state. Public API:
//! `submit` / `drive` / `resolve_action` / `cancel` (MAP hop 1).

use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::rc::Rc;

use askk_core::contracts;
use askk_core::{
    fold, ActionId, ActionPolicy, Budgets, FormatNegotiator, LoopMode, MemoryBlock, Message, Phase,
    Provider, ProviderError, RunId, RunProjection, RunStatus, Signal, SignalKind, StateSnapshot,
    ToolCall,
};

use crate::actions::PendingActions;
use crate::config::{validate, AgentConfig, ConfigError, SkillConfig};
use crate::delegate::DelegateTool;
use crate::run::host::RunHost;
use crate::run::{dispatch, turn};
use crate::state::{MemoryStore, SessionStore, SignalLog};
use crate::tools::ToolRegistry;

/// Provider lookup seam: profile id → provider instance. Tests inject
/// MockProvider; the web host wraps `askk_inference::ProviderRegistry`.
pub type ProviderResolver = Box<dyn Fn(&str) -> Result<Rc<dyn Provider>, ProviderError>>;

/// Everything a session is built from. Config must be parseable; `new` runs
/// `config::validate` and fails loud on any unknown reference (ADR-007).
pub struct SessionInit {
    pub agents: Vec<AgentConfig>,
    pub soul: String,
    pub skills: Vec<SkillConfig>,
    pub registry: ToolRegistry,
    pub resolver: ProviderResolver,
    pub log: SignalLog,
    pub memory: MemoryStore,
    pub session: SessionStore,
    pub budgets: Budgets,
    pub policy: ActionPolicy,
    pub known_providers: Vec<String>,
}

/// Session internals shared with the turn loop and the delegation seam.
pub(crate) struct Shared {
    pub(crate) agents: BTreeMap<String, AgentConfig>,
    pub(crate) soul: String,
    pub(crate) skills: Vec<SkillConfig>,
    pub(crate) registry: ToolRegistry,
    pub(crate) resolver: ProviderResolver,
    /// `Some` between appends; taken out for the duration of each write so
    /// no RefCell borrow crosses an await (single writer, enforced loudly).
    pub(crate) log: RefCell<Option<SignalLog>>,
    pub(crate) memory: MemoryStore,
    pub(crate) session: SessionStore,
    pub(crate) budgets: Budgets,
    pub(crate) policy: ActionPolicy,
    pub(crate) pending: RefCell<PendingActions>,
    pub(crate) runs: RefCell<BTreeMap<RunId, RunState>>,
    /// Per-run live host, installed by `drive`/`resolve_action` (and by the
    /// delegation seam for nested runs). Keyed by run id so concurrent
    /// in-flight drives never stomp each other's host mid-turn.
    pub(crate) hosts: RefCell<BTreeMap<RunId, Rc<dyn RunHost>>>,
    /// Per-run cancel token. Survives the run's removal from `runs` while
    /// driving, so `cancel` can reach an actively-driving run.
    /// ponytail: entries live as long as the session, like `runs` itself.
    pub(crate) cancels: RefCell<BTreeMap<RunId, Rc<Cell<bool>>>>,
    next_run: Cell<u64>,
}

impl Shared {
    pub(crate) fn next_run_id(&self) -> RunId {
        let n = self.next_run.get() + 1;
        self.next_run.set(n);
        RunId::new(format!("run-{n}"))
    }

    pub(crate) fn host(&self, run_id: &RunId) -> Rc<dyn RunHost> {
        self.hosts
            .borrow()
            .get(run_id)
            .cloned()
            .expect("drive/resolve_action install the run's host before any turn runs")
    }
}

/// Per-run mutable state. Removed from the session map while driving so
/// nested (delegated) runs never fight over the borrow.
pub(crate) struct RunState {
    pub(crate) id: RunId,
    pub(crate) agent_id: String,
    pub(crate) goal: String,
    pub(crate) phases: Vec<Phase>,
    /// Declared strategy (agent.md phases) vs the single implicit phase.
    pub(crate) declared: bool,
    pub(crate) phase_idx: usize,
    pub(crate) phase_entered: bool,
    pub(crate) back_edges: u32,
    /// Provider calls made (repairs included; transport retries excluded).
    pub(crate) turns: u32,
    /// Provider calls made inside the current phase (reset on phase entry);
    /// clamped by the phase's `LoopMode::Loop { max_turns }` (GAPS #8).
    pub(crate) phase_turns: u32,
    /// Per-run counter behind unique, run-qualified tool-call ids.
    pub(crate) call_seq: u64,
    pub(crate) started_ms: u64,
    pub(crate) nudged: bool,
    pub(crate) negotiator: FormatNegotiator,
    pub(crate) history: Vec<Message>,
    pub(crate) snapshot: StateSnapshot,
    pub(crate) memory: MemoryBlock,
    /// (phase name, distilled answer) carried into later PhaseFrames.
    pub(crate) artifacts: Vec<(String, String)>,
    /// Effective allowlist: agent tools ∩ every ancestor's allowlist.
    pub(crate) allowed_tools: Vec<String>,
    pub(crate) depth: u8,
    pub(crate) status: RunStatus,
    pub(crate) final_text: Option<String>,
    /// Tool calls not yet dispatched when the run parked on a confirmation.
    pub(crate) queued_calls: Vec<ToolCall>,
    /// The parked confirmation this run is paused on.
    pub(crate) awaiting: Option<ActionId>,
    /// Cancel token shared with `Shared::cancels`, so `cancel` reaches this
    /// run even while it is out of the map mid-drive.
    pub(crate) cancel_requested: Rc<Cell<bool>>,
    /// Every stamped signal of this run, in order — the run's own stream.
    pub(crate) signals: Vec<Signal>,
}

impl RunState {
    pub(crate) fn new(
        agent: &AgentConfig,
        goal: &str,
        allowed_tools: Vec<String>,
        depth: u8,
        memory: MemoryBlock,
        id: RunId,
    ) -> Self {
        let declared = !agent.phases.is_empty();
        let phases = if declared {
            agent.phases.clone()
        } else {
            // The implicit react loop phase IS the gate: its answer ends the
            // run as Answered (a single-phase agent has no separate verifier).
            vec![Phase {
                name: "main".into(),
                contract: agent.contract.clone(),
                tool_filter: None,
                loop_mode: LoopMode::Loop {
                    max_turns: crate::config::agent::DEFAULT_LOOP_MAX_TURNS,
                },
                gate: true,
                on_fail: None,
                header: String::new(),
            }]
        };
        Self {
            id,
            agent_id: agent.id.clone(),
            goal: goal.to_string(),
            phases,
            declared,
            phase_idx: 0,
            phase_entered: false,
            back_edges: 0,
            turns: 0,
            phase_turns: 0,
            call_seq: 0,
            started_ms: 0,
            nudged: false,
            negotiator: FormatNegotiator::with_mode(agent.format),
            history: Vec::new(),
            snapshot: StateSnapshot::default(),
            memory,
            artifacts: Vec::new(),
            allowed_tools,
            depth,
            status: RunStatus::Running,
            final_text: None,
            queued_calls: Vec::new(),
            awaiting: None,
            cancel_requested: Rc::new(Cell::new(false)),
            signals: Vec::new(),
        }
    }

    pub(crate) fn outcome(&self) -> RunOutcome {
        RunOutcome {
            status: self.status,
            final_text: self.final_text.clone(),
            turns_used: self.turns,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RunOutcome {
    pub status: RunStatus,
    pub final_text: Option<String>,
    pub turns_used: u32,
}

fn unknown_run(run_id: &RunId) -> RunOutcome {
    RunOutcome {
        status: RunStatus::Failed,
        final_text: Some(format!("unknown run '{}'", run_id.0)),
        turns_used: 0,
    }
}

pub struct RunSession {
    shared: Rc<Shared>,
}

impl RunSession {
    /// Build a session: register every enabled agent as a delegate tool
    /// (agent-as-tool, ADR-004), then validate the whole config set against
    /// the registry/skills/contracts/providers. One error, all problems.
    pub fn new(init: SessionInit) -> Result<Self, ConfigError> {
        let problems: RefCell<Vec<String>> = RefCell::new(Vec::new());
        let shared = Rc::new_cyclic(|weak| {
            let SessionInit {
                agents,
                soul,
                skills,
                mut registry,
                resolver,
                log,
                memory,
                session,
                budgets,
                policy,
                known_providers,
            } = init;
            for agent in agents.iter().filter(|a| a.enabled) {
                if let Err(e) = registry.register(Rc::new(DelegateTool::new(weak.clone(), agent))) {
                    problems.borrow_mut().push(format!(
                        "{}: cannot register agent as delegate tool: {e}",
                        agent.source_path
                    ));
                }
            }
            // Validation universe = everything the registry holds; any agent
            // ref outside it is flagged by validate.
            let known_tools = registry.names();
            let known_skills: Vec<String> = skills.iter().map(|s| s.id.clone()).collect();
            let known_contracts: Vec<String> =
                contracts::NAMES.iter().map(|n| n.to_string()).collect();
            if let Err(e) = validate(
                &agents,
                &known_tools,
                &known_skills,
                &known_contracts,
                &known_providers,
            ) {
                problems.borrow_mut().extend(e.problems);
            }
            Shared {
                agents: agents.into_iter().map(|a| (a.id.clone(), a)).collect(),
                soul,
                skills,
                registry,
                resolver,
                log: RefCell::new(Some(log)),
                memory,
                session,
                budgets,
                policy,
                pending: RefCell::new(PendingActions::new()),
                runs: RefCell::new(BTreeMap::new()),
                hosts: RefCell::new(BTreeMap::new()),
                cancels: RefCell::new(BTreeMap::new()),
                next_run: Cell::new(0),
            }
        });
        let problems = problems.into_inner();
        if problems.is_empty() {
            Ok(Self { shared })
        } else {
            Err(ConfigError::new(problems))
        }
    }

    /// Start a run: emits `RunStarted` and parks the run ready to drive.
    pub async fn submit(&self, agent_id: &str, input: &str) -> Result<RunId, ConfigError> {
        let shared = &self.shared;
        let agent = shared
            .agents
            .get(agent_id)
            .filter(|a| a.enabled)
            .ok_or_else(|| ConfigError::one(format!("unknown or disabled agent '{agent_id}'")))?
            .clone();
        let memory = shared
            .memory
            .load(agent_id)
            .await
            .map_err(|e| ConfigError::one(e.to_string()))?;
        shared
            .session
            .set_active_agent_id(agent_id)
            .await
            .map_err(|e| ConfigError::one(e.to_string()))?;
        let run_id = shared.next_run_id();
        let mut run = RunState::new(
            &agent,
            input,
            agent.tools.clone(),
            0,
            memory,
            run_id.clone(),
        );
        turn::emit(
            shared,
            &mut run,
            SignalKind::RunStarted {
                agent_id: agent_id.to_string(),
                goal: input.to_string(),
            },
        )
        .await
        .map_err(|e| ConfigError::one(e.to_string()))?;
        shared
            .cancels
            .borrow_mut()
            .insert(run_id.clone(), run.cancel_requested.clone());
        shared.runs.borrow_mut().insert(run_id.clone(), run);
        Ok(run_id)
    }

    /// Run to a terminal status or to a NeedsConfirmation pause (outcome
    /// status stays `Running` while parked).
    pub async fn drive(&self, run_id: &RunId, host: Rc<dyn RunHost>) -> RunOutcome {
        self.shared.hosts.borrow_mut().insert(run_id.clone(), host);
        let Some(mut run) = self.shared.runs.borrow_mut().remove(run_id) else {
            return unknown_run(run_id);
        };
        if !run.status.is_terminal() {
            if let Err(e) = turn::drive_run(&self.shared, &mut run).await {
                turn::fail_run(&self.shared, &mut run, &e).await;
            }
        }
        self.finish(run_id, run)
    }

    /// Resolve a parked confirmation and resume the paused run: approve
    /// executes the action then continues; deny appends a first-class denial
    /// observation and continues.
    pub async fn resolve_action(
        &self,
        run_id: &RunId,
        action_id: &ActionId,
        approve: bool,
        host: Rc<dyn RunHost>,
    ) -> RunOutcome {
        self.shared.hosts.borrow_mut().insert(run_id.clone(), host);
        let Some(mut run) = self.shared.runs.borrow_mut().remove(run_id) else {
            return unknown_run(run_id);
        };
        let resolved = self.shared.pending.borrow_mut().resolve(action_id, approve);
        if let Some((proposal, record)) = resolved {
            let result = async {
                dispatch::apply_resolution(&self.shared, &mut run, proposal, record, approve)
                    .await?;
                if dispatch::dispatch_queued(&self.shared, &mut run).await?
                    == dispatch::Dispatch::Done
                {
                    turn::drive_run(&self.shared, &mut run).await?;
                }
                Ok(())
            }
            .await;
            if let Err(e) = result {
                turn::fail_run(&self.shared, &mut run, &e).await;
            }
        }
        self.finish(run_id, run)
    }

    /// Interrupt a run from outside: Interrupted terminal (ADR-011). A run
    /// that is actively driving (out of the map) gets its cancel token set;
    /// the drive's per-iteration check lands the Interrupted terminal.
    pub async fn cancel(&self, run_id: &RunId) -> RunOutcome {
        let Some(mut run) = self.shared.runs.borrow_mut().remove(run_id) else {
            if let Some(token) = self.shared.cancels.borrow().get(run_id) {
                token.set(true);
                return RunOutcome {
                    status: RunStatus::Running,
                    final_text: Some("cancellation requested".into()),
                    turns_used: 0,
                };
            }
            return unknown_run(run_id);
        };
        if !run.status.is_terminal() {
            run.cancel_requested.set(true);
            // Best-effort: the terminal must land even if the store is sick.
            let _ = turn::emit(&self.shared, &mut run, SignalKind::Interrupted).await;
            run.status = RunStatus::Interrupted;
        }
        self.finish(run_id, run)
    }

    /// Fold of the run's own signal stream — the observable behavior.
    pub fn projection(&self, run_id: &RunId) -> Option<RunProjection> {
        self.shared
            .runs
            .borrow()
            .get(run_id)
            .map(|run| fold(&run.signals))
    }

    fn finish(&self, run_id: &RunId, run: RunState) -> RunOutcome {
        let outcome = run.outcome();
        self.shared.runs.borrow_mut().insert(run_id.clone(), run);
        outcome
    }
}

#[cfg(test)]
impl RunSession {
    /// Test seam: unit tests drive `handle_answer` against the real Shared.
    pub(crate) fn shared(&self) -> &Rc<Shared> {
        &self.shared
    }
}
