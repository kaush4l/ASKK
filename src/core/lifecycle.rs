//! Explicit, self-documenting per-component lifecycles.
//!
//! Every long-lived thing the runtime tracks — a tool call, an agent turn, a
//! spawned worker, a strategy phase — moves through a small, closed set of
//! states. This module names those states *per component* (rather than one
//! blurry shared enum) and, more importantly, encodes the **legal transitions**
//! between them as a pure predicate, [`can_transition`], on each enum. The
//! single rule that shapes every graph: **terminal states have no outgoing
//! edges** — once a thing is `Done`/`Failed`/`Answered`/`Terminated`/
//! `Completed`/`Skipped`, it stays there.
//!
//! These map onto the run domain the shell already persists
//! ([`crate::state::run`]): a tool's [`ToolLifecycle`] is the call's progress
//! through dispatch, an agent's [`AgentLifecycle`] is the ReAct turn shape
//! (render → model → act → observe), a worker's [`WorkerLifecycle`] mirrors the
//! orchestrator's view of a child, and a phase's [`PhaseLifecycle`] is a
//! strategy gate. They are pure value types: `Copy`, serde-round-trippable, and
//! free of any clock or I/O so they compile and test in `core` on every target
//! (no `Date::now`, no web APIs).

use serde::{Deserialize, Serialize};

/// Which kind of component a lifecycle describes. A pure tag so events, logs,
/// and UI can label a state machine without knowing its concrete enum — mirrors
/// the introspection-only role [`crate::core::ToolParadigm`] plays for tools.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComponentKind {
    /// A single tool call moving through dispatch.
    Tool,
    /// One agent's ReAct turn lifecycle.
    Agent,
    /// A spawned worker / sub-agent process.
    Worker,
    /// A strategy phase / workflow gate.
    Phase,
}

/// The lifecycle of one tool call: queued, executing, then a terminal outcome.
/// `Done` and `Failed` are terminal.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolLifecycle {
    /// Dispatched but not yet started (allowlisted, queued).
    Pending,
    /// The call's future is in flight.
    Running,
    /// Completed successfully — terminal.
    Done,
    /// Completed with an error — terminal.
    Failed,
}

impl ToolLifecycle {
    /// Whether `self -> to` is a legal edge.
    pub fn can_transition(self, to: Self) -> bool {
        match (self, to) {
            // A queued call begins running.
            (Self::Pending, Self::Running) => true,
            // A queued call can fail before it ever runs (e.g. rejected/cancelled).
            (Self::Pending, Self::Failed) => true,
            // A running call settles into either terminal outcome.
            (Self::Running, Self::Done) => true,
            (Self::Running, Self::Failed) => true,
            // Terminal states (Done, Failed) have no outgoing edges; everything
            // else (including any self-loop) is illegal.
            _ => false,
        }
    }
}

/// The lifecycle of one agent's ReAct turn: render the sheet, await the model,
/// act on tool calls, observe results, then loop or settle. `Answered`,
/// `Failed`, and `Interrupted` are terminal.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentLifecycle {
    /// Constructed, not yet started.
    Idle,
    /// Rendering message-state into an inference request.
    Rendering,
    /// Request sent; waiting on the model.
    AwaitingModel,
    /// Executing the tool calls the model returned.
    Acting,
    /// Folding tool results back into the message-state.
    Observing,
    /// Produced a final answer — terminal.
    Answered,
    /// Errored out — terminal.
    Failed,
    /// Cancelled before answering — terminal.
    Interrupted,
}

impl AgentLifecycle {
    /// Whether `self -> to` is a legal edge.
    pub fn can_transition(self, to: Self) -> bool {
        // Interruption can arrive at any non-terminal state — a run may be
        // cancelled while idle, rendering, waiting on the model, acting, or
        // observing.
        if to == Self::Interrupted && !self.is_terminal() {
            return true;
        }
        match (self, to) {
            // Idle kicks off the first render.
            (Self::Idle, Self::Rendering) => true,
            // A rendered sheet is sent to the model.
            (Self::Rendering, Self::AwaitingModel) => true,
            // The model either asked for tools, or it answered directly.
            (Self::AwaitingModel, Self::Acting) => true,
            (Self::AwaitingModel, Self::Answered) => true,
            // Tool execution feeds into observing its results.
            (Self::Acting, Self::Observing) => true,
            // After observing, the loop renders the next turn or settles on an
            // answer.
            (Self::Observing, Self::Rendering) => true,
            (Self::Observing, Self::Answered) => true,
            // Any active stage can hit an error.
            (Self::Rendering, Self::Failed) => true,
            (Self::AwaitingModel, Self::Failed) => true,
            (Self::Acting, Self::Failed) => true,
            (Self::Observing, Self::Failed) => true,
            // Terminal states (Answered, Failed, Interrupted) have no outgoing
            // edges; everything else is illegal.
            _ => false,
        }
    }

    /// True for states that end an agent turn — it answered, failed, or was
    /// interrupted. Exhaustive (no wildcard) so a new variant forces a decision
    /// here, mirroring [`crate::state::run::RunStatus::is_terminal`].
    pub fn is_terminal(self) -> bool {
        match self {
            Self::Answered | Self::Failed | Self::Interrupted => true,
            Self::Idle | Self::Rendering | Self::AwaitingModel | Self::Acting | Self::Observing => {
                false
            }
        }
    }
}

/// The lifecycle of a spawned worker: come up, idle/work in a cycle, then shut
/// down. `Terminated` is terminal.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerLifecycle {
    /// Created, not yet initialized.
    Spawned,
    /// Initialized and available for work.
    Ready,
    /// Actively running a task.
    Busy,
    /// Initialized but idle between tasks.
    Idle,
    /// Shut down — terminal.
    Terminated,
}

impl WorkerLifecycle {
    /// Whether `self -> to` is a legal edge.
    pub fn can_transition(self, to: Self) -> bool {
        // A worker can be terminated from any live state.
        if to == Self::Terminated && self != Self::Terminated {
            return true;
        }
        match (self, to) {
            // A spawned worker finishes coming up.
            (Self::Spawned, Self::Ready) => true,
            // A ready/idle worker picks up a task.
            (Self::Ready, Self::Busy) => true,
            (Self::Idle, Self::Busy) => true,
            // A finished task returns the worker to the idle pool.
            (Self::Busy, Self::Idle) => true,
            // Terminal state (Terminated) has no outgoing edges; everything else
            // is illegal.
            _ => false,
        }
    }
}

/// The lifecycle of a strategy phase / workflow gate: pending until entered,
/// then either run to completion or skipped. `Completed` and `Skipped` are
/// terminal.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PhaseLifecycle {
    /// Declared but not yet entered.
    Pending,
    /// Currently executing.
    Active,
    /// Finished its work — terminal.
    Completed,
    /// Bypassed without executing — terminal.
    Skipped,
}

impl PhaseLifecycle {
    /// Whether `self -> to` is a legal edge.
    pub fn can_transition(self, to: Self) -> bool {
        match (self, to) {
            // A pending phase is entered.
            (Self::Pending, Self::Active) => true,
            // A pending phase can be skipped without ever running.
            (Self::Pending, Self::Skipped) => true,
            // An active phase runs to completion.
            (Self::Active, Self::Completed) => true,
            // Terminal states (Completed, Skipped) have no outgoing edges;
            // everything else is illegal.
            _ => false,
        }
    }
}

/// The lifecycle of a whole run — the top-level user goal, owned by main. The run
/// is the durable parent of an agent tree; this rides the *state* plane (it is
/// persisted), unlike the agent/worker activity badges on the telemetry plane.
/// `Completed`, `Cancelled`, and `Failed` are terminal.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunLifecycle {
    /// The goal was accepted but no agent has started.
    Created,
    /// At least one agent is live.
    Running,
    /// Produced a final answer — terminal.
    Completed,
    /// Cancelled by the user before completing — terminal.
    Cancelled,
    /// Errored out — terminal.
    Failed,
}

impl RunLifecycle {
    /// Whether `self -> to` is a legal edge.
    pub fn can_transition(self, to: Self) -> bool {
        match (self, to) {
            (Self::Created, Self::Running) => true,
            // A run can be cancelled before it ever starts an agent.
            (Self::Created, Self::Cancelled) => true,
            (Self::Running, Self::Completed) => true,
            (Self::Running, Self::Cancelled) => true,
            (Self::Running, Self::Failed) => true,
            // Terminal states have no outgoing edges.
            _ => false,
        }
    }

    /// True for the terminal outcomes.
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Cancelled | Self::Failed)
    }
}

/// The lifecycle of one external MCP server connection in the watcher's host
/// table. A fault evicts only that connection (and its tools); `Evicted` is
/// terminal. `Faulted`/`Evicted` are reachable from any live state.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum McpLifecycle {
    /// Declared in config, not yet brought up.
    Configured,
    /// Opening the transport (http/sse/worker) or spawning the process.
    Connecting,
    /// Transport open; performing the MCP initialize handshake.
    Handshaking,
    /// Initialized; tools listed and callable.
    Ready,
    /// Servicing a call.
    Busy,
    /// Initialized but not in a call.
    Idle,
    /// Errored; queued for eviction (a reader shows a faulted badge).
    Faulted,
    /// Removed from the host table — terminal.
    Evicted,
}

impl McpLifecycle {
    /// Whether `self -> to` is a legal edge.
    pub fn can_transition(self, to: Self) -> bool {
        // A live connection can fault, and any non-evicted connection can be
        // evicted (the fault-recovery path the host table runs).
        if !matches!(self, Self::Evicted) && matches!(to, Self::Faulted | Self::Evicted) {
            return true;
        }
        match (self, to) {
            (Self::Configured, Self::Connecting) => true,
            (Self::Connecting, Self::Handshaking) => true,
            (Self::Handshaking, Self::Ready) => true,
            (Self::Ready, Self::Busy) => true,
            (Self::Ready, Self::Idle) => true,
            (Self::Idle, Self::Busy) => true,
            (Self::Busy, Self::Idle) => true,
            // Terminal state (Evicted) has no outgoing edges.
            _ => false,
        }
    }

    /// True for the terminal state.
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Evicted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_lifecycle_legal_and_illegal_transitions() {
        // Legal: the happy path and the early-fail edge.
        assert!(ToolLifecycle::Pending.can_transition(ToolLifecycle::Running));
        assert!(ToolLifecycle::Pending.can_transition(ToolLifecycle::Failed));
        assert!(ToolLifecycle::Running.can_transition(ToolLifecycle::Done));
        assert!(ToolLifecycle::Running.can_transition(ToolLifecycle::Failed));

        // Illegal: skipping Running, and any self-loop.
        assert!(!ToolLifecycle::Pending.can_transition(ToolLifecycle::Done));
        assert!(!ToolLifecycle::Running.can_transition(ToolLifecycle::Pending));
        assert!(!ToolLifecycle::Running.can_transition(ToolLifecycle::Running));

        // Illegal: terminal states have no outgoing edges.
        assert!(!ToolLifecycle::Done.can_transition(ToolLifecycle::Running));
        assert!(!ToolLifecycle::Done.can_transition(ToolLifecycle::Failed));
        assert!(!ToolLifecycle::Failed.can_transition(ToolLifecycle::Running));
        assert!(!ToolLifecycle::Failed.can_transition(ToolLifecycle::Done));
    }

    #[test]
    fn agent_lifecycle_legal_and_illegal_transitions() {
        // Legal: the ReAct cycle render → model → act → observe → render/answer.
        assert!(AgentLifecycle::Idle.can_transition(AgentLifecycle::Rendering));
        assert!(AgentLifecycle::Rendering.can_transition(AgentLifecycle::AwaitingModel));
        assert!(AgentLifecycle::AwaitingModel.can_transition(AgentLifecycle::Acting));
        assert!(AgentLifecycle::AwaitingModel.can_transition(AgentLifecycle::Answered));
        assert!(AgentLifecycle::Acting.can_transition(AgentLifecycle::Observing));
        assert!(AgentLifecycle::Observing.can_transition(AgentLifecycle::Rendering));
        assert!(AgentLifecycle::Observing.can_transition(AgentLifecycle::Answered));

        // Legal: interruption from any live stage, and failure from active stages.
        assert!(AgentLifecycle::Idle.can_transition(AgentLifecycle::Interrupted));
        assert!(AgentLifecycle::AwaitingModel.can_transition(AgentLifecycle::Interrupted));
        assert!(AgentLifecycle::AwaitingModel.can_transition(AgentLifecycle::Failed));
        assert!(AgentLifecycle::Acting.can_transition(AgentLifecycle::Failed));

        // Illegal: skipping stages.
        assert!(!AgentLifecycle::Idle.can_transition(AgentLifecycle::AwaitingModel));
        assert!(!AgentLifecycle::Rendering.can_transition(AgentLifecycle::Acting));
        assert!(!AgentLifecycle::AwaitingModel.can_transition(AgentLifecycle::Observing));

        // Illegal: terminal states have no outgoing edges (not even to Interrupted).
        assert!(!AgentLifecycle::Answered.can_transition(AgentLifecycle::Rendering));
        assert!(!AgentLifecycle::Answered.can_transition(AgentLifecycle::Interrupted));
        assert!(!AgentLifecycle::Failed.can_transition(AgentLifecycle::Rendering));
        assert!(!AgentLifecycle::Interrupted.can_transition(AgentLifecycle::Rendering));
    }

    #[test]
    fn worker_lifecycle_legal_and_illegal_transitions() {
        // Legal: come up, take work, return to idle, take work again.
        assert!(WorkerLifecycle::Spawned.can_transition(WorkerLifecycle::Ready));
        assert!(WorkerLifecycle::Ready.can_transition(WorkerLifecycle::Busy));
        assert!(WorkerLifecycle::Busy.can_transition(WorkerLifecycle::Idle));
        assert!(WorkerLifecycle::Idle.can_transition(WorkerLifecycle::Busy));

        // Legal: termination from any live state.
        assert!(WorkerLifecycle::Spawned.can_transition(WorkerLifecycle::Terminated));
        assert!(WorkerLifecycle::Ready.can_transition(WorkerLifecycle::Terminated));
        assert!(WorkerLifecycle::Busy.can_transition(WorkerLifecycle::Terminated));
        assert!(WorkerLifecycle::Idle.can_transition(WorkerLifecycle::Terminated));

        // Illegal: skipping Ready, and a spawned worker jumping straight to busy.
        assert!(!WorkerLifecycle::Spawned.can_transition(WorkerLifecycle::Busy));
        assert!(!WorkerLifecycle::Spawned.can_transition(WorkerLifecycle::Idle));
        assert!(!WorkerLifecycle::Ready.can_transition(WorkerLifecycle::Idle));

        // Illegal: terminal state has no outgoing edges.
        assert!(!WorkerLifecycle::Terminated.can_transition(WorkerLifecycle::Ready));
        assert!(!WorkerLifecycle::Terminated.can_transition(WorkerLifecycle::Terminated));
    }

    #[test]
    fn phase_lifecycle_legal_and_illegal_transitions() {
        // Legal: enter then complete, or skip outright.
        assert!(PhaseLifecycle::Pending.can_transition(PhaseLifecycle::Active));
        assert!(PhaseLifecycle::Pending.can_transition(PhaseLifecycle::Skipped));
        assert!(PhaseLifecycle::Active.can_transition(PhaseLifecycle::Completed));

        // Illegal: completing without entering, skipping a running phase.
        assert!(!PhaseLifecycle::Pending.can_transition(PhaseLifecycle::Completed));
        assert!(!PhaseLifecycle::Active.can_transition(PhaseLifecycle::Skipped));
        assert!(!PhaseLifecycle::Active.can_transition(PhaseLifecycle::Pending));

        // Illegal: terminal states have no outgoing edges.
        assert!(!PhaseLifecycle::Completed.can_transition(PhaseLifecycle::Active));
        assert!(!PhaseLifecycle::Skipped.can_transition(PhaseLifecycle::Active));
        assert!(!PhaseLifecycle::Completed.can_transition(PhaseLifecycle::Skipped));
    }

    // The lifecycle enums are introspection/persistence types; guard the serde
    // wire format (snake_case) so a rename can't silently break a stored state.
    #[test]
    fn lifecycles_serialize_to_snake_case() {
        assert_eq!(
            serde_json::to_string(&ComponentKind::Worker).unwrap(),
            "\"worker\""
        );
        assert_eq!(
            serde_json::to_string(&ToolLifecycle::Done).unwrap(),
            "\"done\""
        );
        assert_eq!(
            serde_json::to_string(&AgentLifecycle::AwaitingModel).unwrap(),
            "\"awaiting_model\""
        );
        assert_eq!(
            serde_json::to_string(&WorkerLifecycle::Terminated).unwrap(),
            "\"terminated\""
        );
        assert_eq!(
            serde_json::to_string(&PhaseLifecycle::Completed).unwrap(),
            "\"completed\""
        );
        // Round-trip a multi-word variant to confirm Deserialize matches.
        let parsed: AgentLifecycle = serde_json::from_str("\"awaiting_model\"").unwrap();
        assert_eq!(parsed, AgentLifecycle::AwaitingModel);
    }
}
