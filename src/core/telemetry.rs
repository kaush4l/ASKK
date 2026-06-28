//! The **telemetry plane** — the ephemeral, lossy-OK, render-only event stream
//! that drives the live fleet UI. It is the deliberate counterpart to the durable,
//! ordered *state plane* ([`crate::core::event::Signal`]): status flapping and
//! token counters churn fast and must never touch the persisted snapshot or hit
//! IndexedDB, so they ride here instead and are coalesced (last-wins per thread,
//! flushed ~8 ms) into a `FleetView` the main thread repaints rAF-gated.
//!
//! Pure value types (serde, no clock, no web APIs) so `core` keeps compiling and
//! testing on the host. The coalescer and the `FleetView` model live in
//! `crate::runtime::fleet`; this module is just the wire vocabulary.

use serde::{Deserialize, Serialize};

/// What a live thread is doing right now — the activity badge in the fleet UI.
/// Lossy by design: a reader only ever shows the latest, so dropping an
/// intermediate `WaitingLlm` is harmless.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "activity")]
pub enum AgentActivity {
    /// Reasoning between model round-trips.
    Thinking,
    /// Blocked on the model.
    WaitingLlm,
    /// Running a tool (named for the badge).
    CallingTool { name: String },
    /// Blocked on a delegated sub-agent.
    AwaitingChild { child_id: String },
    /// Alive but doing nothing.
    Idle,
}

/// What kind of fleet node a telemetry `id` refers to — picks the icon/lane in the
/// fleet view.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThreadKind {
    /// An engine worker running one agent.
    Engine,
    /// The watcher/supervisor itself.
    Watcher,
    /// The shared tool-host worker.
    ToolHost,
    /// An external MCP server reachable from the browser.
    McpServer,
    /// An external MCP server backed by a process via the bridge.
    McpProcess,
}

/// One delta on the telemetry plane. Coalesced per `id` (last-wins for status and
/// counters) before it ever reaches the main thread, so the frame rate is bounded
/// regardless of agent count or token speed.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum TelemetrySignal {
    /// A thread came up. `parent` threads it into the fleet tree.
    Spawned {
        id: String,
        kind: ThreadKind,
        parent: Option<String>,
        label: String,
    },
    /// A thread's activity badge changed.
    StatusChanged { id: String, activity: AgentActivity },
    /// Throttled progress counters (emitted ≤ every 50 ms / K tokens at source).
    Progress {
        id: String,
        tokens: u32,
        elapsed_ms: u64,
    },
    /// A thread ended; `reason` is a short human label.
    Terminated { id: String, reason: String },
}

impl TelemetrySignal {
    /// The thread id this signal addresses — the coalescer's grouping key.
    pub fn id(&self) -> &str {
        match self {
            TelemetrySignal::Spawned { id, .. }
            | TelemetrySignal::StatusChanged { id, .. }
            | TelemetrySignal::Progress { id, .. }
            | TelemetrySignal::Terminated { id, .. } => id,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn telemetry_round_trips_tagged() {
        let sig = TelemetrySignal::StatusChanged {
            id: "engine-1".into(),
            activity: AgentActivity::CallingTool {
                name: "web_search".into(),
            },
        };
        let json = serde_json::to_string(&sig).unwrap();
        assert!(json.contains("\"type\":\"status_changed\""));
        assert!(json.contains("\"activity\":\"calling_tool\""));
        let parsed: TelemetrySignal = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, sig);
        assert_eq!(parsed.id(), "engine-1");
    }

    #[test]
    fn spawned_threads_into_tree_via_parent() {
        let sig = TelemetrySignal::Spawned {
            id: "engine-2".into(),
            kind: ThreadKind::Engine,
            parent: Some("engine-1".into()),
            label: "researcher".into(),
        };
        let parsed: TelemetrySignal =
            serde_json::from_str(&serde_json::to_string(&sig).unwrap()).unwrap();
        assert_eq!(parsed, sig);
    }
}
