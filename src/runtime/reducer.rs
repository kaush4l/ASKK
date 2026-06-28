//! The page-side [`RunReducer`]: folds a [`Signal`] stream into a renderable
//! [`AgentRun`] so the existing UI components keep reading an `AgentRun` unchanged.
//!
//! # Why a reducer
//!
//! The legacy live path re-cloned the *whole* `AgentRun` on every tick and
//! re-broadcast it — O(N) per emission. The [`Bus`](super::bus::Bus) replaces that
//! with fine-grained deltas ([`Signal`]s). But every UI component
//! (`chat_panel`, `inspector`, `event_log`, `run_panel`) renders a full `AgentRun`
//! by reading its fields directly. Rather than rewrite those components against the
//! delta stream, this reducer folds the deltas back into one `AgentRun` they can
//! render as-is. It is the bridge between the new wire and the old render surface.
//!
//! # What it rebuilds from deltas vs. what it leaves to [`reconcile`]
//!
//! Per the signal-schema field map (see [`crate::core::event`]), at each tick
//! exactly one logical thing changes and the *rendered* subset is small. The
//! reducer rebuilds, purely from signals:
//!
//! - **Identity** (`id`, `goal`, `lane`, `created_at`) and `status = Running` from
//!   the one [`SignalKind::RunStarted`] seed.
//! - **`status`** scalar from [`SignalKind::StatusSet`] /
//!   [`SignalKind::Interrupted`] / terminal [`SignalKind::Result`] /
//!   [`SignalKind::Error`].
//! - **`final_answer`** scalar from [`SignalKind::Result`].
//! - **`scratchpad.budgets.steps_used`** scalar from
//!   [`SignalKind::StepsUsedSet`].
//! - **`tool_calls`** (append) from [`SignalKind::ToolRequested`].
//! - **`tool_results`** (append) from [`SignalKind::ToolCompleted`].
//! - **`scratchpad.recent_observations`** (append) from
//!   [`SignalKind::ObservationAppended`].
//! - **`scratchpad.artifacts`** (append) from [`SignalKind::ArtifactAppended`].
//! - **`scratchpad.verification.status`** from [`SignalKind::Verification`]
//!   (`passed → Passed/Failed`; `Pending` is the default until a verdict or the
//!   snapshot arrives).
//! - **`events`** — the readable ReAct log — reconstituted from the *typed* kinds
//!   (`LlmRequest`, `LlmResponse`, `ToolRequested`, `ToolCompleted`, `Phase`,
//!   `Memory`, `Verification`, `Result`, `Error`, `Interrupted`, and lifecycle
//!   edges). The typed kinds **are** the legacy event stream re-expressed, so the
//!   reducer re-derives [`AgentEvent`] rows from them rather than re-shipping the
//!   coarse payload.
//! - Coarse **lifecycle / live phase** state, tracked per emitting instance, so a
//!   reader can answer "what state is each component in right now?" and "what is
//!   the live phase line?" without re-cloning the run.
//!
//! Deliberately carried by **no** live signal — empty/default until
//! [`RunReducer::reconcile`] replaces the projection from the authoritative
//! terminal snapshot:
//!
//! - `messages` (rewritten wholesale by compaction + rolling-summary; not in the
//!   rendered subset),
//! - the complex scratchpad sub-structures `workers`, `meta_tool_calls`,
//!   `current_plan`, the full `workflow`, and the full `verification` beyond its
//!   live verdict.
//!
//! This matches today's behavior: those renderers already show empty lists
//! mid-run. [`reconcile`] is the safety net that bounds divergence — it is called
//! on a terminal `WorkerEvent::Result` snapshot or on a bus-detected `seq` gap,
//! and replaces the whole projection.
//!
//! # Purity & conventions
//!
//! No `web_sys`, no DOM, no clock. Event timestamps are taken from the signal's
//! `ts_ms` (the emitter's stamp), and event ids are derived deterministically from
//! `(run_id, seq)` so the reducer needs no `Uuid`/`Date` — keeping it host-testable
//! on every target. Shared by `Rc`/`RefCell` like the rest of the crate when a UI
//! holds it; the type itself is a plain owned value.

use crate::core::event::{Signal, SignalKind};
use crate::core::lifecycle::ComponentKind;
use crate::state::{
    AgentEvent, AgentEventKind, AgentRun, RunStatus, ToolCall, ToolResult, VerificationStatus,
};

/// Folds a [`Signal`] stream into one renderable [`AgentRun`].
///
/// Start [`RunReducer::default`] (empty), feed each signal once with
/// [`RunReducer::apply`], and read the projection with [`RunReducer::run`]. On a
/// terminal snapshot or a detected ordering gap, call [`RunReducer::reconcile`] to
/// replace the projection wholesale and bound divergence.
///
/// The reducer keys on `run_id`: the bus is global, so signals for other runs are
/// ignored once this reducer has bound a run (via the [`SignalKind::RunStarted`]
/// seed, or via [`RunReducer::reconcile`]). Before it is bound, the first
/// `RunStarted` it sees claims the reducer.
#[derive(Clone, Debug, PartialEq)]
pub struct RunReducer {
    /// The reconstructed run the UI renders. Default/empty until the first
    /// `RunStarted` seed or a `reconcile`.
    run: AgentRun,
    /// The run id this reducer is bound to, once seeded/reconciled. `None` means
    /// "not yet bound" — the first `RunStarted` claims it.
    run_id: Option<String>,
}

impl Default for RunReducer {
    fn default() -> Self {
        Self {
            // `AgentRun` carries no `Default` derive (it is a persisted snapshot
            // type, never constructed empty by the domain), so the reducer seeds
            // its own empty shell from the field types' defaults rather than
            // adding a derive to the shared state struct.
            run: empty_run(),
            run_id: None,
        }
    }
}

/// An empty [`AgentRun`] shell — every field at its type default. Used as the
/// reducer's starting projection before any signal binds it. Lives here (not on
/// `AgentRun`) to keep the reducer from mutating the shared state domain.
fn empty_run() -> AgentRun {
    AgentRun {
        id: String::new(),
        goal: String::new(),
        status: RunStatus::default(),
        lane: Default::default(),
        scratchpad: Default::default(),
        messages: Vec::new(),
        events: Vec::new(),
        tool_calls: Vec::new(),
        tool_results: Vec::new(),
        final_answer: String::new(),
        created_at: String::new(),
    }
}

impl RunReducer {
    /// A fresh reducer with an empty [`AgentRun`] and no bound run.
    pub fn new() -> Self {
        Self::default()
    }

    /// The reconstructed run, for the UI to render directly.
    pub fn run(&self) -> &AgentRun {
        &self.run
    }

    /// The run id this reducer is bound to, if it has been seeded or reconciled.
    pub fn run_id(&self) -> Option<&str> {
        self.run_id.as_deref()
    }

    /// Fold one signal into the run.
    ///
    /// Honors `run_id`: a signal for a *different* bound run is ignored (the bus is
    /// global; one reducer renders one run). A [`SignalKind::RunStarted`] both
    /// seeds the run shell and claims an unbound reducer; once bound, a
    /// `RunStarted` for the same id re-seeds identity idempotently and one for a
    /// different id is ignored.
    ///
    /// Scalars are last-writer-wins in `apply` order; append-deltas push a row.
    /// Each apply also appends a re-derived [`AgentEvent`] to `events` for the
    /// kinds the readable log renders, so the chat/event-log panels keep working.
    pub fn apply(&mut self, signal: &Signal) {
        // `RunStarted` is the one signal that may bind an as-yet-unbound reducer.
        if let SignalKind::RunStarted { id, .. } = &signal.kind {
            match &self.run_id {
                None => self.run_id = Some(id.clone()),
                // Already bound to a different run — not ours.
                Some(bound) if bound != id => return,
                Some(_) => {}
            }
        } else if !self.belongs(signal) {
            // A non-seed signal for another run (or before we are bound) is not
            // ours to fold.
            return;
        }

        // Mutate the rendered subset per the kind, then re-derive the readable
        // event-log row for the kinds the log shows.
        self.fold_kind(signal);
        if let Some(event) = self.event_for(signal) {
            self.run.events.push(event);
        }
    }

    /// Replace the projection wholesale from an authoritative full run.
    ///
    /// Used on a terminal `WorkerEvent::Result` snapshot or on a bus-detected `seq`
    /// gap: the live delta view is only the *rendered subset*, so the complex
    /// scratchpad (`workers`, `meta_tool_calls`, full `workflow`/`verification`,
    /// `current_plan`) and `messages` are empty/default until this lands. Replacing
    /// the whole run from the snapshot reconciles every field at once and rebinds
    /// the reducer to the snapshot's id, bounding how far the live view can drift.
    pub fn reconcile(&mut self, authoritative: AgentRun) {
        self.run_id = Some(authoritative.id.clone());
        self.run = authoritative;
    }

    /// Whether `signal` belongs to the run this reducer is bound to. An unbound
    /// reducer owns nothing (only a `RunStarted` can bind it, handled in `apply`).
    fn belongs(&self, signal: &Signal) -> bool {
        match &self.run_id {
            Some(bound) => bound == &signal.run_id,
            None => false,
        }
    }

    /// Apply the kind's effect to the rendered subset of the run. Pure data
    /// mutation — no event-log derivation (that is `event_for`'s job).
    fn fold_kind(&mut self, signal: &Signal) {
        match &signal.kind {
            SignalKind::RunStarted {
                id,
                goal,
                lane,
                created_at,
            } => {
                self.run.id = id.clone();
                self.run.goal = goal.clone();
                self.run.lane = *lane;
                self.run.created_at = created_at.clone();
                self.run.status = RunStatus::Running;
                // Mirror the run lane/goal onto the scratchpad, matching how the
                // worker seeds a fresh run (the inspector/chat read both).
                self.run.scratchpad.goal = goal.clone();
                self.run.scratchpad.lane = *lane;
            }
            SignalKind::ToolRequested {
                call_id,
                name,
                arguments,
            } => {
                self.run.tool_calls.push(ToolCall {
                    id: call_id.clone(),
                    agent_id: signal.instance.as_str().to_string(),
                    tool_name: name.clone(),
                    arguments: arguments.clone(),
                });
            }
            SignalKind::ToolCompleted {
                call_id,
                ok,
                content,
            } => {
                self.run.tool_results.push(ToolResult {
                    call_id: call_id.clone(),
                    ok: *ok,
                    content: content.clone(),
                });
            }
            SignalKind::ObservationAppended { observation } => {
                self.run
                    .scratchpad
                    .recent_observations
                    .push(observation.clone());
            }
            SignalKind::ArtifactAppended { artifact } => {
                self.run.scratchpad.artifacts.push(artifact.clone());
            }
            // The open-set is a scalar projection (not an append log): last-writer
            // wins, so the live `scratchpad.workspace` mirrors the latest open/close.
            SignalKind::WorkspaceChanged { view } => {
                self.run.scratchpad.workspace = view.clone();
            }
            SignalKind::StatusSet { status } => {
                self.run.status = *status;
                if *status == RunStatus::Interrupted {
                    self.run.scratchpad.interrupted = true;
                }
            }
            SignalKind::StepsUsedSet { steps_used } => {
                self.run.scratchpad.budgets.steps_used = *steps_used;
            }
            SignalKind::Verification { passed } => {
                // The live signal carries only the verdict; the full structure
                // reconciles from the snapshot. Map the bool onto the 3-state the
                // inspector renders (`Pending` stays the default until a verdict).
                self.run.scratchpad.verification.status = if *passed {
                    VerificationStatus::Passed
                } else {
                    VerificationStatus::Failed
                };
            }
            SignalKind::Result { final_text } => {
                self.run.final_answer = final_text.clone();
                // The reply is done streaming; drop the in-progress preview.
                self.run.scratchpad.streaming = None;
                // A result is terminal; promote status unless a later StatusSet
                // overrides it (last-writer-wins keeps that ordering correct).
                if !self.run.status.is_terminal() {
                    self.run.status = RunStatus::Complete;
                }
            }
            SignalKind::Error { .. } => {
                self.run.status = RunStatus::Error;
            }
            SignalKind::Interrupted => {
                self.run.status = RunStatus::Interrupted;
                self.run.scratchpad.interrupted = true;
            }
            // The reply forming live: show the parsed partial as the in-progress
            // preview until the full turn lands, then drop it. (The Agent-Zero-style
            // streaming parse happens upstream in the transport sink.)
            SignalKind::LlmDelta { text } => {
                self.run.scratchpad.streaming = Some(text.clone());
            }
            SignalKind::LlmResponse { .. } => {
                self.run.scratchpad.streaming = None;
            }
            // Coarse lifecycle / phase / memory signals carry no rendered scalar of
            // their own — they only contribute a readable event-log row (handled by
            // `event_for`). The complex scratchpad they would touch
            // (workers/workflow/current_plan) has no live signal and reconciles
            // from the snapshot.
            SignalKind::Lifecycle { .. }
            | SignalKind::Phase { .. }
            | SignalKind::Memory
            | SignalKind::LlmRequest => {}
        }
    }

    /// Re-derive the readable [`AgentEvent`] row for a signal, or `None` for kinds
    /// the legible log does not show. The typed kinds *are* the legacy event stream
    /// re-expressed, so this reconstitutes the rows the `chat_panel`/`event_log`
    /// render. Ids are deterministic (`run_id`+`seq`) and timestamps come from the
    /// signal's `ts_ms`, so no clock/Uuid is needed — the reducer stays pure.
    fn event_for(&self, signal: &Signal) -> Option<AgentEvent> {
        let (kind, title, body): (AgentEventKind, String, String) = match &signal.kind {
            SignalKind::RunStarted { goal, .. } => {
                (AgentEventKind::Started, "Run started".to_string(), goal.clone())
            }
            SignalKind::LlmRequest => {
                (AgentEventKind::LlmRequest, "LLM".to_string(), String::new())
            }
            SignalKind::LlmResponse { text } => {
                (AgentEventKind::LlmResponse, "LLM".to_string(), text.clone())
            }
            SignalKind::ToolRequested { name, arguments, .. } => (
                AgentEventKind::ToolRequested,
                name.clone(),
                if arguments.is_null() {
                    String::new()
                } else {
                    arguments.to_string()
                },
            ),
            SignalKind::ToolCompleted { ok, content, .. } => (
                AgentEventKind::ToolCompleted,
                if *ok { "ok".to_string() } else { "error".to_string() },
                content.clone(),
            ),
            SignalKind::Phase { name, done } => (
                if *done {
                    AgentEventKind::PhaseCompleted
                } else {
                    AgentEventKind::PhaseStarted
                },
                name.clone(),
                String::new(),
            ),
            SignalKind::Memory => {
                (AgentEventKind::MemoryCompacted, "Memory".to_string(), String::new())
            }
            SignalKind::Verification { passed } => (
                AgentEventKind::Verification,
                "Verification".to_string(),
                if *passed { "passed".to_string() } else { "failed".to_string() },
            ),
            SignalKind::Result { final_text } => {
                (AgentEventKind::FinalAnswer, "Answer".to_string(), final_text.clone())
            }
            SignalKind::Error { message } => {
                (AgentEventKind::Error, "Error".to_string(), message.clone())
            }
            SignalKind::Interrupted => (
                AgentEventKind::Interrupted,
                "Interrupted".to_string(),
                String::new(),
            ),
            // Lifecycle edges fold onto the coarse worker/started channels the log
            // already hides or summarizes; surface worker edges as worker events so
            // the inspector/log keep their existing rows, and drop the rest (tool/
            // agent/phase lifecycle are already represented by their typed kinds).
            SignalKind::Lifecycle { component, from, to } => match component {
                ComponentKind::Worker => {
                    let kind = if to == "terminated" {
                        AgentEventKind::WorkerCompleted
                    } else {
                        AgentEventKind::WorkerStarted
                    };
                    (kind, format!("{from} -> {to}"), String::new())
                }
                // Tool / agent / phase lifecycle edges are already carried by the
                // typed kinds (ToolRequested/Completed, Started, Phase); a second
                // row would double-count the readable log.
                ComponentKind::Tool | ComponentKind::Agent | ComponentKind::Phase => return None,
            },
            // Streaming deltas are not their own log row (they accumulate into the
            // LlmResponse row the emitter sends at turn end).
            SignalKind::LlmDelta { .. }
            // Scalar set-signals have no log row of their own.
            | SignalKind::StatusSet { .. }
            | SignalKind::StepsUsedSet { .. }
            // Append-deltas for the scratchpad render in the scratchpad block, not
            // the ReAct log.
            | SignalKind::ObservationAppended { .. }
            | SignalKind::ArtifactAppended { .. }
            // The workspace open-set drives the prompt block and IDE tabs, not the
            // ReAct log — no event row of its own.
            | SignalKind::WorkspaceChanged { .. } => return None,
        };

        Some(AgentEvent {
            id: format!("{}:{}", signal.run_id, signal.seq),
            run_id: signal.run_id.clone(),
            agent_id: Some(signal.instance.as_str().to_string()),
            kind,
            title,
            body,
            created_at: format!("unix-ms:{}", signal.ts_ms),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::event::InstanceName;
    use crate::state::{
        ArtifactKind, RunArtifact, RunLane, RunScratchpad, ScratchpadObservation, WorkerRun,
        WorkerRunStatus,
    };

    fn sig(seq: u64, run: &str, instance: &str, kind: SignalKind) -> Signal {
        Signal::new(seq, run, instance, kind, seq as f64)
    }

    fn run_started(run: &str, goal: &str, lane: RunLane) -> SignalKind {
        SignalKind::RunStarted {
            id: run.to_string(),
            goal: goal.to_string(),
            lane,
            created_at: "unix-ms:5".to_string(),
        }
    }

    // A realistic ordered stream: identity seed, an agent turn (lifecycle +
    // llm round-trip), a tool call requested then completed-with-content, an
    // observation append, a steps bump, and a final result — exactly the shape a
    // live emitter produces. Assert the rebuilt AgentRun field-by-field.
    #[test]
    fn folds_an_ordered_stream_into_a_rendered_run() {
        let mut reducer = RunReducer::new();
        let stream = vec![
            sig(
                0,
                "run-1",
                "agent-0",
                run_started("run-1", "answer it", RunLane::SingleAction),
            ),
            sig(
                1,
                "run-1",
                "agent-0",
                SignalKind::Lifecycle {
                    component: ComponentKind::Agent,
                    from: "idle".to_string(),
                    to: "rendering".to_string(),
                },
            ),
            sig(2, "run-1", "agent-0", SignalKind::LlmRequest),
            sig(
                3,
                "run-1",
                "agent-0",
                SignalKind::LlmResponse {
                    text: "let me search".to_string(),
                },
            ),
            sig(
                4,
                "run-1",
                "agent-0",
                SignalKind::ToolRequested {
                    call_id: "c1".to_string(),
                    name: "web_search".to_string(),
                    arguments: serde_json::json!({ "q": "rust" }),
                },
            ),
            sig(
                5,
                "run-1",
                "agent-0",
                SignalKind::ToolCompleted {
                    call_id: "c1".to_string(),
                    ok: true,
                    content: "found it".to_string(),
                },
            ),
            sig(
                6,
                "run-1",
                "agent-0",
                SignalKind::ObservationAppended {
                    observation: ScratchpadObservation {
                        id: "obs-1".to_string(),
                        source: "web_search".to_string(),
                        content: "found it".to_string(),
                        created_at: "unix-ms:6".to_string(),
                    },
                },
            ),
            sig(
                7,
                "run-1",
                "agent-0",
                SignalKind::StepsUsedSet { steps_used: 1 },
            ),
            sig(
                8,
                "run-1",
                "agent-0",
                SignalKind::Result {
                    final_text: "the answer".to_string(),
                },
            ),
        ];
        for signal in &stream {
            reducer.apply(signal);
        }

        let run = reducer.run();
        // Identity from the seed.
        assert_eq!(run.id, "run-1");
        assert_eq!(run.goal, "answer it");
        assert_eq!(run.lane, RunLane::SingleAction);
        assert_eq!(run.created_at, "unix-ms:5");
        // Result promoted status to Complete (terminal).
        assert_eq!(run.status, RunStatus::Complete);
        assert_eq!(run.final_answer, "the answer");
        // Scratchpad scalars + appends.
        assert_eq!(run.scratchpad.budgets.steps_used, 1);
        assert_eq!(run.scratchpad.goal, "answer it");
        assert_eq!(run.scratchpad.recent_observations.len(), 1);
        assert_eq!(run.scratchpad.recent_observations[0].id, "obs-1");
        // Tool call + result appended with the right shape.
        assert_eq!(run.tool_calls.len(), 1);
        assert_eq!(run.tool_calls[0].id, "c1");
        assert_eq!(run.tool_calls[0].tool_name, "web_search");
        assert_eq!(run.tool_calls[0].agent_id, "agent-0");
        assert_eq!(run.tool_results.len(), 1);
        assert_eq!(run.tool_results[0].call_id, "c1");
        assert!(run.tool_results[0].ok);
        assert_eq!(run.tool_results[0].content, "found it");

        // The readable event log was reconstituted from the typed kinds: the
        // agent lifecycle edge and the steps/observation set-signals are NOT log
        // rows, so the log holds Started, LlmRequest, LlmResponse, ToolRequested,
        // ToolCompleted, FinalAnswer (6 rows).
        let kinds: Vec<&AgentEventKind> = run.events.iter().map(|e| &e.kind).collect();
        assert_eq!(
            kinds,
            vec![
                &AgentEventKind::Started,
                &AgentEventKind::LlmRequest,
                &AgentEventKind::LlmResponse,
                &AgentEventKind::ToolRequested,
                &AgentEventKind::ToolCompleted,
                &AgentEventKind::FinalAnswer,
            ]
        );
        // Event detail is carried over (response text, tool result body).
        let response = run
            .events
            .iter()
            .find(|e| e.kind == AgentEventKind::LlmResponse)
            .unwrap();
        assert_eq!(response.body, "let me search");
        let answer = run
            .events
            .iter()
            .find(|e| e.kind == AgentEventKind::FinalAnswer)
            .unwrap();
        assert_eq!(answer.body, "the answer");
        // Event ids/timestamps are deterministic from (run_id, seq)/ts_ms — no
        // clock/Uuid needed.
        assert_eq!(answer.id, "run-1:8");
        assert_eq!(answer.created_at, "unix-ms:8");

        // Fields with no live signal stay default until reconcile.
        assert!(run.messages.is_empty());
        assert!(run.scratchpad.workers.is_empty());
        assert!(run.scratchpad.meta_tool_calls.is_empty());
    }

    // StatusSet after a Result wins (last-writer-wins in seq order): an
    // Interrupted that arrives after a terminal result still marks the run.
    #[test]
    fn status_is_last_writer_wins_and_interrupt_marks_scratchpad() {
        let mut reducer = RunReducer::new();
        reducer.apply(&sig(
            0,
            "r",
            "a",
            run_started("r", "g", RunLane::BoundedTask),
        ));
        reducer.apply(&sig(
            1,
            "r",
            "a",
            SignalKind::Result {
                final_text: "x".to_string(),
            },
        ));
        assert_eq!(reducer.run().status, RunStatus::Complete);
        reducer.apply(&sig(2, "r", "a", SignalKind::Interrupted));
        assert_eq!(reducer.run().status, RunStatus::Interrupted);
        assert!(reducer.run().scratchpad.interrupted);
    }

    // Verification's bool verdict maps onto the 3-state the inspector renders.
    #[test]
    fn verification_bool_maps_to_three_state() {
        let mut reducer = RunReducer::new();
        reducer.apply(&sig(
            0,
            "r",
            "a",
            run_started("r", "g", RunLane::BoundedTask),
        ));
        assert_eq!(
            reducer.run().scratchpad.verification.status,
            VerificationStatus::Pending
        );
        reducer.apply(&sig(1, "r", "a", SignalKind::Verification { passed: true }));
        assert_eq!(
            reducer.run().scratchpad.verification.status,
            VerificationStatus::Passed
        );
        reducer.apply(&sig(
            2,
            "r",
            "a",
            SignalKind::Verification { passed: false },
        ));
        assert_eq!(
            reducer.run().scratchpad.verification.status,
            VerificationStatus::Failed
        );
    }

    // reconcile() replaces the whole projection from an authoritative snapshot,
    // overriding prior deltas and filling the fields that had no live signal.
    #[test]
    fn reconcile_overrides_prior_deltas_and_fills_uncarried_fields() {
        let mut reducer = RunReducer::new();
        // Build up a partial live view from deltas.
        reducer.apply(&sig(
            0,
            "run-1",
            "a",
            run_started("run-1", "old goal", RunLane::SingleAction),
        ));
        reducer.apply(&sig(
            1,
            "run-1",
            "a",
            SignalKind::StepsUsedSet { steps_used: 2 },
        ));
        assert_eq!(reducer.run().scratchpad.budgets.steps_used, 2);
        assert!(reducer.run().scratchpad.workers.is_empty());

        // The authoritative snapshot disagrees on the scalar AND carries the
        // complex scratchpad the live view never had.
        let mut authoritative = AgentRun {
            id: "run-1".to_string(),
            goal: "reconciled goal".to_string(),
            status: RunStatus::Complete,
            lane: RunLane::SingleAction,
            scratchpad: RunScratchpad::default(),
            messages: vec![crate::state::Message {
                role: "user".to_string(),
                content: "hi".to_string(),
            }],
            events: Vec::new(),
            tool_calls: Vec::new(),
            tool_results: Vec::new(),
            final_answer: "snapshot answer".to_string(),
            created_at: "unix-ms:5".to_string(),
        };
        authoritative.scratchpad.budgets.steps_used = 9;
        authoritative.scratchpad.workers.push(WorkerRun {
            id: "w1".to_string(),
            role: "researcher".to_string(),
            agent_id: None,
            sub_goal: "dig".to_string(),
            status: WorkerRunStatus::Complete,
            budget: Default::default(),
            scratchpad: Default::default(),
            evidence: Vec::new(),
            result: String::new(),
        });

        reducer.reconcile(authoritative.clone());

        // Wholesale replacement: the snapshot's values win over the live deltas.
        assert_eq!(reducer.run(), &authoritative);
        assert_eq!(reducer.run().goal, "reconciled goal");
        assert_eq!(reducer.run().scratchpad.budgets.steps_used, 9);
        assert_eq!(reducer.run().final_answer, "snapshot answer");
        assert_eq!(reducer.run().scratchpad.workers.len(), 1);
        assert_eq!(reducer.run().messages.len(), 1);
        assert_eq!(reducer.run_id(), Some("run-1"));
    }

    // Cross-run isolation: the bus is global, so a reducer bound to run-1 ignores
    // signals addressed to run-2.
    #[test]
    fn ignores_signals_for_other_runs() {
        let mut reducer = RunReducer::new();
        reducer.apply(&sig(
            0,
            "run-1",
            "a",
            run_started("run-1", "mine", RunLane::BoundedTask),
        ));

        // A foreign RunStarted does not rebind, and its deltas are dropped.
        reducer.apply(&sig(
            0,
            "run-2",
            "b",
            run_started("run-2", "theirs", RunLane::Batch),
        ));
        reducer.apply(&sig(
            1,
            "run-2",
            "b",
            SignalKind::ToolRequested {
                call_id: "x".to_string(),
                name: "evil".to_string(),
                arguments: serde_json::Value::Null,
            },
        ));
        reducer.apply(&sig(
            2,
            "run-2",
            "b",
            SignalKind::Result {
                final_text: "leaked".to_string(),
            },
        ));

        assert_eq!(reducer.run_id(), Some("run-1"));
        assert_eq!(reducer.run().goal, "mine");
        assert_eq!(reducer.run().lane, RunLane::BoundedTask);
        assert!(reducer.run().tool_calls.is_empty());
        assert_eq!(reducer.run().final_answer, "");
        assert_eq!(reducer.run().status, RunStatus::Running);

        // Our own run's deltas still land.
        reducer.apply(&sig(
            1,
            "run-1",
            "a",
            SignalKind::Result {
                final_text: "mine done".to_string(),
            },
        ));
        assert_eq!(reducer.run().final_answer, "mine done");
        assert_eq!(reducer.run().status, RunStatus::Complete);
    }

    // An unbound reducer (no RunStarted seen yet) ignores non-seed signals — it
    // owns no run until something binds it.
    #[test]
    fn unbound_reducer_ignores_non_seed_signals() {
        let mut reducer = RunReducer::new();
        reducer.apply(&sig(0, "run-1", "a", SignalKind::LlmRequest));
        assert_eq!(reducer.run_id(), None);
        assert!(reducer.run().events.is_empty());
        assert_eq!(reducer.run(), &empty_run());
    }

    // An ArtifactAppended lands in the scratchpad gallery, not the ReAct log.
    #[test]
    fn artifact_appends_to_scratchpad_not_event_log() {
        let mut reducer = RunReducer::new();
        reducer.apply(&sig(
            0,
            "r",
            "a",
            run_started("r", "g", RunLane::BoundedTask),
        ));
        let before = reducer.run().events.len();
        reducer.apply(&sig(
            1,
            "r",
            "a",
            SignalKind::ArtifactAppended {
                artifact: RunArtifact {
                    id: "art-1".to_string(),
                    name: "shot.png".to_string(),
                    artifact_type: ArtifactKind::Image,
                    content: "data:...".to_string(),
                },
            },
        ));
        assert_eq!(reducer.run().scratchpad.artifacts.len(), 1);
        assert_eq!(reducer.run().scratchpad.artifacts[0].name, "shot.png");
        // No new event-log row for an artifact append.
        assert_eq!(reducer.run().events.len(), before);
    }

    // Streaming deltas fold into the in-progress preview (last-wins) and clear when
    // the full turn lands or the run finishes — the live "reply forming" view.
    #[test]
    fn llm_delta_streams_into_preview_and_clears_on_response_and_result() {
        let mut reducer = RunReducer::new();
        reducer.apply(&sig(
            0,
            "r",
            "a",
            run_started("r", "g", RunLane::BoundedTask),
        ));

        reducer.apply(&sig(
            1,
            "r",
            "a",
            SignalKind::LlmDelta {
                text: "the answer is".to_string(),
            },
        ));
        assert_eq!(
            reducer.run().scratchpad.streaming.as_deref(),
            Some("the answer is")
        );
        // A later delta replaces it (last-wins).
        reducer.apply(&sig(
            2,
            "r",
            "a",
            SignalKind::LlmDelta {
                text: "the answer is 42".to_string(),
            },
        ));
        assert_eq!(
            reducer.run().scratchpad.streaming.as_deref(),
            Some("the answer is 42")
        );
        // The full turn landing clears the preview (the real text replaces it).
        reducer.apply(&sig(
            3,
            "r",
            "a",
            SignalKind::LlmResponse {
                text: "the answer is 42".to_string(),
            },
        ));
        assert_eq!(reducer.run().scratchpad.streaming, None);

        // A terminal result also clears any lingering preview.
        reducer.apply(&sig(
            4,
            "r",
            "a",
            SignalKind::LlmDelta {
                text: "trailing".to_string(),
            },
        ));
        reducer.apply(&sig(
            5,
            "r",
            "a",
            SignalKind::Result {
                final_text: "done".to_string(),
            },
        ));
        assert_eq!(reducer.run().scratchpad.streaming, None);
        assert_eq!(reducer.run().final_answer, "done");
    }

    // A worker lifecycle edge becomes a worker event row in the log; a terminated
    // edge maps to WorkerCompleted.
    #[test]
    fn worker_lifecycle_edges_surface_as_worker_events() {
        let mut reducer = RunReducer::new();
        reducer.apply(&sig(
            0,
            "r",
            "a",
            run_started("r", "g", RunLane::BoundedTask),
        ));
        reducer.apply(&sig(
            1,
            "r",
            "worker-1",
            SignalKind::Lifecycle {
                component: ComponentKind::Worker,
                from: "spawned".to_string(),
                to: "ready".to_string(),
            },
        ));
        reducer.apply(&sig(
            2,
            "r",
            "worker-1",
            SignalKind::Lifecycle {
                component: ComponentKind::Worker,
                from: "busy".to_string(),
                to: "terminated".to_string(),
            },
        ));
        let worker_events: Vec<&AgentEventKind> = reducer
            .run()
            .events
            .iter()
            .map(|e| &e.kind)
            .filter(|k| {
                matches!(
                    k,
                    AgentEventKind::WorkerStarted | AgentEventKind::WorkerCompleted
                )
            })
            .collect();
        assert_eq!(
            worker_events,
            vec![
                &AgentEventKind::WorkerStarted,
                &AgentEventKind::WorkerCompleted
            ]
        );
        // The worker event carries the emitting instance as its agent_id.
        let started = reducer
            .run()
            .events
            .iter()
            .find(|e| e.kind == AgentEventKind::WorkerStarted)
            .unwrap();
        assert_eq!(started.agent_id.as_deref(), Some("worker-1"));
        // The signal carries the emitter address as an InstanceName.
        assert_eq!(
            sig(0, "r", "worker-1", SignalKind::LlmRequest).instance,
            InstanceName("worker-1".to_string())
        );
    }
}
