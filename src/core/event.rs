//! The fine-grained [`Signal`] bus wire format — the runtime's *delta* stream.
//!
//! The legacy timeline ([`crate::state::AgentEvent`]) is a coarse,
//! human-titled record appended to the run and re-broadcast by cloning the whole
//! `AgentRun` on every tick — O(N) work per emission. A [`Signal`] is the
//! opposite: a single, self-addressed delta carrying *only* what changed, so a
//! subscriber can fold it into its own view in O(1). Each signal names its
//! `seq` (monotonic per run), its `run_id`, the `instance` that emitted it (a
//! component's stable bus address — for engines, [`crate::core::BaseEngine`]'s
//! `name`), one [`SignalKind`], and a `ts_ms` stamp.
//!
//! Time is the emitter's responsibility, never core's: the shell reads the clock
//! and supplies `ts_ms` so this module — like the rest of `core` — stays pure and
//! compiles on every target with no `Date::now`.
//!
//! [`SignalKind`] is deliberately small (sixteen variants). Legibility is the
//! whole point of the bus, so the kinds consolidate the ~twenty
//! [`AgentEventKind`](crate::state::AgentEventKind) variants into the few
//! transitions a reader actually reasons about: an LLM round-trip, a tool call,
//! a phase, memory, verification, the final result, errors, interruption — plus
//! one [`SignalKind::Lifecycle`] that carries any component's state-machine edge
//! verbatim. The [`From`] adapter below is the bridge: it re-expresses the old
//! stream on the new wire so both can run side by side during the migration.
//!
//! # Rebuilding the rendered subset of [`AgentRun`](crate::state::AgentRun)
//!
//! The bus exists so a page-side reducer can fold deltas into the *rendered
//! subset* of an `AgentRun` without ever re-cloning the whole run per tick. A
//! prior field-map of every emit point, mutation, and rendered field shows that
//! at each tick exactly one logical thing changes, and the rendered subset is
//! small. The kinds therefore split into three shapes:
//!
//! - **Append-deltas** carry only the *new item* for an append-only field:
//!   [`SignalKind::ToolRequested`] (full [`ToolCall`](crate::state::ToolCall)
//!   row → `tool_calls`), [`SignalKind::ToolCompleted`] (full
//!   [`ToolResult`](crate::state::ToolResult) content → `tool_results`),
//!   [`SignalKind::ObservationAppended`] (`scratchpad.recent_observations`), and
//!   [`SignalKind::ArtifactAppended`] (`scratchpad.artifacts`). The dominant
//!   `events` stream is *not* a single append variant — the typed kinds here
//!   **are** the event stream re-expressed, so a reducer reconstitutes the
//!   rendered log from them rather than re-shipping the coarse
//!   [`AgentEvent`](crate::state::AgentEvent) payload the bus is retiring.
//! - **Set-signals** replace a scalar: [`SignalKind::StatusSet`] (`status`),
//!   [`SignalKind::Result`] (`final_answer`), [`SignalKind::StepsUsedSet`]
//!   (`scratchpad.budgets.steps_used`), plus the identity seed
//!   [`SignalKind::RunStarted`] (`id`/`goal`/`lane`/`created_at`, once).
//! - **Coarse lifecycle/phase signals** stand in for the complex scratchpad:
//!   [`SignalKind::Lifecycle`] (worker/agent/tool/phase edges),
//!   [`SignalKind::Phase`] (the live phase line), and
//!   [`SignalKind::Verification`] (the only verification field rendered live —
//!   the verdict). Per the field map, the complex scratchpad sub-fields
//!   (`meta_tool_calls`, `workers`, full `workflow`, `current_plan`) are dead or
//!   unrendered during a live run; sending a generic patch for them would be
//!   pure churn. The complete scratchpad is reconciled once, at terminus, from
//!   the worker's `Result` snapshot — not a per-tick signal.
//!
//! Deliberately carried by **no** live signal (reconciled from the terminal
//! snapshot): `messages`, `tool_results` beyond the rendered content,
//! `current_plan`, `meta_tool_calls`, `workers`, and the full `workflow`/
//! `verification` structures. `messages` in particular is rewritten wholesale by
//! compaction and the rolling-summary update; it is not in the rendered subset,
//! so it needs no live signal (see the reducer caveat in the crate docs).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::core::lifecycle::ComponentKind;
use crate::state::{
    AgentEvent, AgentEventKind, RunArtifact, RunLane, RunStatus, ScratchpadObservation,
    WorkspaceView,
};

/// Monotonic, per-run sequence number — orders signals on the bus and lets a
/// subscriber detect a gap (a dropped delta) without a wall clock.
pub type Seq = u64;

/// The stable bus address of a component instance. For an engine this is its
/// [`crate::core::BaseEngine`] `name`; for a tool/worker/phase it is whatever
/// stable handle the emitter assigns. Hashable so a router can fan signals out
/// per instance.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct InstanceName(pub String);

impl InstanceName {
    /// Borrow the address as a string slice.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<&str> for InstanceName {
    fn from(value: &str) -> Self {
        InstanceName(value.to_string())
    }
}

impl From<String> for InstanceName {
    fn from(value: String) -> Self {
        InstanceName(value)
    }
}

/// One delta on the bus: a sequenced, self-addressed, timestamped [`SignalKind`].
///
/// `ts_ms` is a millisecond epoch stamp supplied by the emitter (the shell), so
/// core reads no clock. `instance` is the emitter's bus address; `seq` orders
/// the stream within `run_id`.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Signal {
    pub seq: Seq,
    pub run_id: String,
    pub instance: InstanceName,
    pub kind: SignalKind,
    pub ts_ms: f64,
}

impl Signal {
    /// Assemble a signal from its parts. A thin constructor so emitters read
    /// declaratively rather than filling a struct literal at every call site.
    pub fn new(
        seq: Seq,
        run_id: impl Into<String>,
        instance: impl Into<InstanceName>,
        kind: SignalKind,
        ts_ms: f64,
    ) -> Self {
        Self {
            seq,
            run_id: run_id.into(),
            instance: instance.into(),
            kind,
            ts_ms,
        }
    }
}

/// What a [`Signal`] reports. Sixteen variants, by design: the bus is meant to
/// be *read* and *folded into the rendered subset of an `AgentRun`*, so the kinds
/// name the transitions a subscriber reasons about rather than mirroring every
/// legacy event one-for-one. The richer, human-titled detail still lives on
/// [`AgentEvent`]; a `SignalKind` carries only the load-bearing fields a reader
/// folds into state. See the module docs for the field-by-field rebuild map.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum SignalKind {
    /// Seeds the run's immutable identity exactly once, at start: the reducer
    /// creates the run shell from `id`/`goal`/`lane`/`created_at` and sets
    /// `status = Running`. Replaces re-deriving identity from a whole-run clone.
    RunStarted {
        id: String,
        goal: String,
        lane: RunLane,
        created_at: String,
    },
    /// A component crossed a state-machine edge. The one variant that carries
    /// any [`crate::core::lifecycle`] transition verbatim (`from`/`to` are the
    /// snake_case enum labels), so worker/agent/tool/phase progress rides the
    /// bus without a kind per state.
    Lifecycle {
        component: ComponentKind,
        from: String,
        to: String,
    },
    /// An inference request was sent to the model.
    LlmRequest,
    /// A streamed chunk of the model's response arrived.
    LlmDelta { text: String },
    /// The model's response completed — `text` carries the assistant turn's text
    /// so a reader can render it without the legacy event body.
    LlmResponse { text: String },
    /// The model asked to call a tool (or a peer agent, which is a tool). Carries
    /// the full appendable [`ToolCall`](crate::state::ToolCall) row: `call_id` is
    /// its id, `name` its `tool_name`, `arguments` its arguments (rendered by the
    /// inspector); the call's `agent_id` is the signal's `instance` address.
    ToolRequested {
        call_id: String,
        name: String,
        #[serde(default)]
        arguments: Value,
    },
    /// A tool call settled. `ok` distinguishes success from failure; `content`
    /// is the result text — together the appendable
    /// [`ToolResult`](crate::state::ToolResult) (`call_id`/`ok`/`content`).
    ToolCompleted {
        call_id: String,
        ok: bool,
        #[serde(default)]
        content: String,
    },
    /// One [`ScratchpadObservation`](crate::state::ScratchpadObservation) was
    /// appended to `scratchpad.recent_observations` (rendered in the chat
    /// scratchpad block).
    ObservationAppended { observation: ScratchpadObservation },
    /// One [`RunArtifact`](crate::state::RunArtifact) was appended to
    /// `scratchpad.artifacts` (rendered by the artifact gallery).
    ArtifactAppended { artifact: RunArtifact },
    /// The agent's workspace open-set changed — it opened or closed a file via the
    /// `workspace_open`/`workspace_close` tools. Carries the whole
    /// [`WorkspaceView`](crate::state::WorkspaceView) (a small set of path refs, not
    /// file content), folded last-writer-wins into `scratchpad.workspace`. Drives
    /// both the `## WORKSPACE` prompt block and the user's IDE tabs (Option A: one
    /// shared source of truth).
    WorkspaceChanged { view: WorkspaceView },
    /// The run's [`RunStatus`](crate::state::RunStatus) was replaced. Also the
    /// route by which a reader sees terminal status; [`SignalKind::Interrupted`]
    /// remains the explicit cancel edge for back-compat with the legacy stream.
    StatusSet { status: RunStatus },
    /// `scratchpad.budgets.steps_used` advanced (the "steps N/M" counter).
    StepsUsedSet { steps_used: u32 },
    /// A strategy phase changed state — `done` is false on entry, true on exit.
    Phase { name: String, done: bool },
    /// Working memory was touched (compaction, rolling-summary update).
    Memory,
    /// A verification gate ran — `passed` is its verdict (the only verification
    /// field rendered live; the full structure reconciles from the snapshot).
    Verification { passed: bool },
    /// The run produced its final answer (sets `final_answer`).
    Result { final_text: String },
    /// The run errored.
    Error { message: String },
    /// The run was cancelled before answering.
    Interrupted,
}

impl SignalKind {
    /// Map a legacy [`AgentEventKind`](crate::state::AgentEventKind) (plus the event's `title`/`body`, which
    /// carry its payload) onto a [`SignalKind`]. This is the migration bridge —
    /// the old coarse stream re-expressed on the new fine-grained wire.
    ///
    /// The mapping is lossy by intent: several legacy kinds collapse onto one
    /// signal (the four memory/summary and worker kinds, the two phase kinds,
    /// the two MCP kinds). The kinds that have no own field on `AgentEventKind`
    /// borrow the event's `body` for their payload (`Result`, `Error`,
    /// `ToolRequested`, `Verification`), since that is where the emitter put it.
    pub fn from_legacy(kind: &AgentEventKind, title: &str, body: &str) -> Self {
        match kind {
            // Coarse run-start carries no structured identity on the legacy
            // event (no id/goal/lane/created_at in title/body), so it cannot
            // reconstruct a `RunStarted` seed — that is a fresh-emitter concern.
            // Surface it as the engine entering its turn so the bus still shows
            // a start edge; a live emitter sends `RunStarted` directly.
            AgentEventKind::Started => SignalKind::Lifecycle {
                component: ComponentKind::Agent,
                from: "idle".to_string(),
                to: "rendering".to_string(),
            },
            // Routing / meta-tool / workflow are control chatter the bus folds
            // into the generic phase channel (entry edge), keyed by the title.
            AgentEventKind::Routing | AgentEventKind::MetaTool | AgentEventKind::Workflow => {
                SignalKind::Phase {
                    name: title.to_string(),
                    done: false,
                }
            }
            AgentEventKind::LlmRequest => SignalKind::LlmRequest,
            // Legacy response carries the assistant text in the body.
            AgentEventKind::LlmResponse => SignalKind::LlmResponse {
                text: body.to_string(),
            },
            // The legacy tool events carry name/result in title/body, not typed
            // fields; the call id and arguments are not on the legacy event, so
            // they default to empty.
            AgentEventKind::ToolRequested => SignalKind::ToolRequested {
                call_id: String::new(),
                name: title.to_string(),
                arguments: Value::Null,
            },
            AgentEventKind::ToolCompleted => SignalKind::ToolCompleted {
                call_id: String::new(),
                // Legacy completion is logged for both outcomes; the body holds
                // the result text. Treat an explicit error marker as failure.
                ok: !body_marks_error(body),
                content: body.to_string(),
            },
            // Worker start/stop become worker lifecycle edges.
            AgentEventKind::WorkerStarted => SignalKind::Lifecycle {
                component: ComponentKind::Worker,
                from: "spawned".to_string(),
                to: "ready".to_string(),
            },
            AgentEventKind::WorkerCompleted => SignalKind::Lifecycle {
                component: ComponentKind::Worker,
                from: "busy".to_string(),
                to: "terminated".to_string(),
            },
            // The two phase kinds collapse onto one `Phase` with a `done` flag.
            AgentEventKind::PhaseStarted => SignalKind::Phase {
                name: title.to_string(),
                done: false,
            },
            AgentEventKind::PhaseCompleted => SignalKind::Phase {
                name: title.to_string(),
                done: true,
            },
            // Both memory kinds fold onto the single `Memory` channel.
            AgentEventKind::MemoryCompacted | AgentEventKind::RollingSummaryUpdated => {
                SignalKind::Memory
            }
            AgentEventKind::Verification => SignalKind::Verification {
                passed: !body_marks_error(body),
            },
            // The two MCP kinds are connection chatter; surface them on the
            // generic phase channel rather than spending a dedicated variant.
            AgentEventKind::McpConnected | AgentEventKind::McpToolsListed => SignalKind::Phase {
                name: title.to_string(),
                done: matches!(kind, AgentEventKind::McpToolsListed),
            },
            AgentEventKind::Interrupted => SignalKind::Interrupted,
            AgentEventKind::FinalAnswer => SignalKind::Result {
                final_text: body.to_string(),
            },
            AgentEventKind::Error => SignalKind::Error {
                message: body.to_string(),
            },
        }
    }
}

/// Heuristic for legacy events that log both success and failure on one kind
/// (tool completion, verification): the emitter writes the outcome into the body.
/// Treat a leading error marker as failure; anything else is success.
fn body_marks_error(body: &str) -> bool {
    let trimmed = body.trim_start();
    trimmed.starts_with("Error")
        || trimmed.starts_with("error")
        || trimmed.starts_with("ERR")
        || trimmed.starts_with("failed")
        || trimmed.starts_with("Failed")
        || trimmed.starts_with("FAILED")
}

impl From<&AgentEventKind> for SignalKind {
    /// Field-free convenience: map a kind alone (no title/body context). Useful
    /// when only the discriminant is known; the title/body-bearing variants get
    /// empty payloads. Prefer [`SignalKind::from_legacy`] when the event is in
    /// hand.
    fn from(kind: &AgentEventKind) -> Self {
        SignalKind::from_legacy(kind, "", "")
    }
}

/// Adapter from a full legacy [`AgentEvent`] to a [`Signal`].
///
/// Fills the new addressing fields from the source where it can: `run_id` is
/// carried over, the legacy `agent_id` (if any) becomes the `instance` address
/// (defaulting to the run id when absent), and the kind is mapped with its
/// title/body for payload. `seq` and `ts_ms` are *not* on the legacy event —
/// the legacy `created_at` is an ISO/`unix-ms:` string, not a clock the pure
/// core can parse — so both default to `0`; the emitter rewrites them when it
/// re-stamps the signal onto a live bus.
impl From<&AgentEvent> for Signal {
    fn from(event: &AgentEvent) -> Self {
        let instance = event
            .agent_id
            .clone()
            .unwrap_or_else(|| event.run_id.clone());
        Signal {
            seq: 0,
            run_id: event.run_id.clone(),
            instance: InstanceName(instance),
            kind: SignalKind::from_legacy(&event.kind, &event.title, &event.body),
            ts_ms: 0.0,
        }
    }
}

impl From<AgentEvent> for Signal {
    fn from(event: AgentEvent) -> Self {
        Signal::from(&event)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::event;

    #[test]
    fn signal_json_round_trips() {
        let original = Signal::new(
            7,
            "run-123",
            "planner",
            SignalKind::Lifecycle {
                component: ComponentKind::Worker,
                from: "spawned".to_string(),
                to: "ready".to_string(),
            },
            1_700_000_000_000.0,
        );

        let json = serde_json::to_string(&original).expect("serialize");
        let parsed: Signal = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed, original);

        // The tagged-enum wire format names the kind by snake_case `type`.
        assert!(json.contains("\"type\":\"lifecycle\""));
        assert!(json.contains("\"component\":\"worker\""));
    }

    #[test]
    fn round_trips_a_payload_bearing_kind() {
        let original = Signal::new(
            1,
            "run-xyz",
            "agent-0",
            SignalKind::ToolRequested {
                call_id: "call_42".to_string(),
                name: "web_search".to_string(),
                arguments: serde_json::json!({ "query": "rust signals" }),
            },
            42.5,
        );
        let parsed: Signal =
            serde_json::from_str(&serde_json::to_string(&original).unwrap()).unwrap();
        assert_eq!(parsed, original);
    }

    #[test]
    fn run_started_round_trips_and_carries_identity() {
        let original = Signal::new(
            0,
            "run-seed",
            "agent-0",
            SignalKind::RunStarted {
                id: "run-seed".to_string(),
                goal: "ship the bus".to_string(),
                lane: RunLane::BoundedTask,
                created_at: "unix-ms:1700000000000".to_string(),
            },
            1.0,
        );
        let json = serde_json::to_string(&original).expect("serialize");
        let parsed: Signal = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed, original);
        assert!(json.contains("\"type\":\"run_started\""));
        // Lane rides the wire in its snake_case run-domain form.
        assert!(json.contains("\"lane\":\"bounded_task\""));
    }

    #[test]
    fn changed_and_appended_kinds_round_trip() {
        // The variants that gained content fields, plus the new append/set
        // deltas, all survive a JSON round-trip with their payload intact.
        let kinds = vec![
            SignalKind::LlmResponse {
                text: "assistant says hi".to_string(),
            },
            SignalKind::ToolCompleted {
                call_id: "call_9".to_string(),
                ok: true,
                content: "result body".to_string(),
            },
            SignalKind::ObservationAppended {
                observation: ScratchpadObservation {
                    id: "obs-1".to_string(),
                    source: "web_search".to_string(),
                    content: "found it".to_string(),
                    created_at: "unix-ms:1".to_string(),
                },
            },
            SignalKind::ArtifactAppended {
                artifact: RunArtifact {
                    id: "art-1".to_string(),
                    name: "shot.png".to_string(),
                    artifact_type: crate::state::ArtifactKind::Image,
                    content: "data:...".to_string(),
                },
            },
            SignalKind::StatusSet {
                status: RunStatus::Complete,
            },
            SignalKind::StepsUsedSet { steps_used: 7 },
        ];
        for kind in kinds {
            let signal = Signal::new(3, "run-1", "agent-0", kind.clone(), 9.0);
            let parsed: Signal =
                serde_json::from_str(&serde_json::to_string(&signal).unwrap()).unwrap();
            assert_eq!(parsed.kind, kind);
        }
    }

    #[test]
    fn maps_final_answer_to_result_with_body() {
        let kind = SignalKind::from_legacy(&AgentEventKind::FinalAnswer, "Answer", "the answer");
        assert_eq!(
            kind,
            SignalKind::Result {
                final_text: "the answer".to_string()
            }
        );
    }

    #[test]
    fn maps_phase_completed_to_done_phase() {
        let kind = SignalKind::from_legacy(&AgentEventKind::PhaseCompleted, "plan", "");
        assert_eq!(
            kind,
            SignalKind::Phase {
                name: "plan".to_string(),
                done: true,
            }
        );
    }

    #[test]
    fn maps_tool_completed_error_body_to_not_ok() {
        let ok =
            SignalKind::from_legacy(&AgentEventKind::ToolCompleted, "web_search", "results...");
        assert_eq!(
            ok,
            SignalKind::ToolCompleted {
                call_id: String::new(),
                ok: true,
                // The legacy body becomes the rendered result content.
                content: "results...".to_string(),
            }
        );
        let failed =
            SignalKind::from_legacy(&AgentEventKind::ToolCompleted, "web_search", "Error: boom");
        assert_eq!(
            failed,
            SignalKind::ToolCompleted {
                call_id: String::new(),
                ok: false,
                content: "Error: boom".to_string(),
            }
        );
    }

    #[test]
    fn maps_llm_response_body_to_text() {
        let kind =
            SignalKind::from_legacy(&AgentEventKind::LlmResponse, "LLM", "the assistant reply");
        assert_eq!(
            kind,
            SignalKind::LlmResponse {
                text: "the assistant reply".to_string(),
            }
        );
    }

    // A miniature reducer: prove a small, ordered signal stream rebuilds the
    // rendered subset of an `AgentRun` (identity seed + append-only tool_calls +
    // scalar status/final_answer/steps) without ever cloning a whole run. This
    // mirrors what the page-side reducer step will do.
    #[test]
    fn signal_stream_rebuilds_rendered_subset() {
        use crate::state::{AgentRun, RunScratchpad, ToolCall};

        fn apply(run: &mut AgentRun, kind: SignalKind) {
            match kind {
                SignalKind::RunStarted {
                    id,
                    goal,
                    lane,
                    created_at,
                } => {
                    run.id = id;
                    run.goal = goal;
                    run.lane = lane;
                    run.created_at = created_at;
                    run.status = RunStatus::Running;
                }
                SignalKind::ToolRequested {
                    call_id,
                    name,
                    arguments,
                } => run.tool_calls.push(ToolCall {
                    id: call_id,
                    agent_id: "agent-0".to_string(),
                    tool_name: name,
                    arguments,
                }),
                SignalKind::StepsUsedSet { steps_used } => {
                    run.scratchpad.budgets.steps_used = steps_used
                }
                SignalKind::StatusSet { status } => run.status = status,
                SignalKind::Result { final_text } => run.final_answer = final_text,
                _ => {}
            }
        }

        let mut run = AgentRun {
            id: String::new(),
            goal: String::new(),
            status: RunStatus::Running,
            lane: RunLane::default(),
            scratchpad: RunScratchpad::default(),
            messages: Vec::new(),
            events: Vec::new(),
            tool_calls: Vec::new(),
            tool_results: Vec::new(),
            final_answer: String::new(),
            created_at: String::new(),
        };

        let stream = vec![
            SignalKind::RunStarted {
                id: "run-42".to_string(),
                goal: "answer it".to_string(),
                lane: RunLane::SingleAction,
                created_at: "unix-ms:5".to_string(),
            },
            SignalKind::StepsUsedSet { steps_used: 1 },
            SignalKind::ToolRequested {
                call_id: "c1".to_string(),
                name: "web_search".to_string(),
                arguments: serde_json::json!({"q": "x"}),
            },
            SignalKind::Result {
                final_text: "done".to_string(),
            },
            SignalKind::StatusSet {
                status: RunStatus::Complete,
            },
        ];
        for kind in stream {
            apply(&mut run, kind);
        }

        assert_eq!(run.id, "run-42");
        assert_eq!(run.goal, "answer it");
        assert_eq!(run.lane, RunLane::SingleAction);
        assert_eq!(run.created_at, "unix-ms:5");
        assert_eq!(run.status, RunStatus::Complete);
        assert_eq!(run.final_answer, "done");
        assert_eq!(run.scratchpad.budgets.steps_used, 1);
        assert_eq!(run.tool_calls.len(), 1);
        assert_eq!(run.tool_calls[0].tool_name, "web_search");
        assert_eq!(run.tool_calls[0].id, "c1");
    }

    #[test]
    fn full_event_adapts_to_signal_with_addressing() {
        let evt = event(
            "run-7",
            Some("worker-3".to_string()),
            AgentEventKind::Error,
            "Error",
            "kaboom",
        );
        let signal = Signal::from(&evt);
        assert_eq!(signal.run_id, "run-7");
        assert_eq!(signal.instance, InstanceName("worker-3".to_string()));
        assert_eq!(
            signal.kind,
            SignalKind::Error {
                message: "kaboom".to_string()
            }
        );
        // seq/ts are not on the legacy event; the emitter rewrites them later.
        assert_eq!(signal.seq, 0);
        assert_eq!(signal.ts_ms, 0.0);
    }

    #[test]
    fn instance_defaults_to_run_id_when_agent_id_absent() {
        let evt = event("run-9", None, AgentEventKind::LlmRequest, "LLM", "");
        let signal = Signal::from(evt);
        assert_eq!(signal.instance, InstanceName("run-9".to_string()));
        assert_eq!(signal.kind, SignalKind::LlmRequest);
    }
}
