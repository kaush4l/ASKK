//! The platform-free **tool contract** — how a tool is *placed* (which host runs
//! it), what durable *state* it needs projected to it, and how it *returns*
//! (result + a typed patch). This is the heart of the architecture rewrite: a
//! tool no longer holds `&mut AppSnapshot`, because it runs in a different worker
//! than the engine. Instead the engine projects the minimal slice the tool needs,
//! ships a [`ToolRequest`] across the hub, and folds the [`ToolResponse`]'s
//! [`StatePatch`] back through the single StateWriter actor on main.
//!
//! Everything here is pure value types — serde-round-trippable, no clock, no web
//! APIs — so `core` still compiles and unit-tests on the host (invariant 5). The
//! typed dispatch path that *uses* these types lands at the cutover (plan step
//! C3); during the additive phase they exist alongside the legacy
//! `Tool::call(&mut AppSnapshot)` path.
//!
//! Naming note: the design calls the placement record "ToolBinding", but that
//! name is already taken by the legacy callable alias
//! (`crate::core::tooling::ToolBinding`). Until the cutover removes the legacy
//! alias, the placement record is [`HostBinding`].

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::state::{AgentMemory, AppSnapshot, FileMeta, RunArtifact, ScheduleEntry, ToolResult};

/// Where a tool runs — the five host kinds the watcher hub can address. The
/// engine never branches on this; the hub routes a [`ToolRequest`] by it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "host")]
pub enum HostAddr {
    /// In the calling engine worker itself (pure Rust tools).
    Worker,
    /// On the main thread (page-op / window APIs).
    Main,
    /// An external MCP server reachable from the browser (http/sse/worker).
    McpServer { server_id: String },
    /// An external MCP server backed by a process via the native bridge.
    McpProcess { server_id: String },
    /// A peer agent exposed as a callable (delegation).
    Agent { agent_id: String },
}

/// A named durable-state field, for [`StateNeeds::Custom`]. A thin newtype so the
/// projection layer can request fields it does not yet have a typed slice for.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StateField(pub String);

/// What durable state a tool needs *projected* to it before it runs. Declared by
/// the tool's [`HostBinding`]; consumed by [`project`]. The whole snapshot never
/// crosses the hub — only the slice these name does.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "needs")]
pub enum StateNeeds {
    /// Pure tool — needs nothing (R0).
    None,
    /// The local bridge base URL (R4 bridge HTTP tools).
    BridgeUrl,
    /// Web-search backend + provider settings (R1 run-constant bundle).
    WebSearchConfig,
    /// Google OAuth lease, read-only per call (R2).
    GoogleAuth,
    /// Telegram bot config (R1).
    TelegramConfig,
    /// The agent roster, for delegation/handoff tools (R1).
    AgentRoster,
    /// An explicit field list the projector resolves generically.
    Custom(Vec<StateField>),
}

/// How a tool is bound into the runtime: which host runs it, what state it needs,
/// and its per-call deadline. (The design's "ToolBinding"; see the module note on
/// the name.)
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostBinding {
    pub host: HostAddr,
    pub needs: StateNeeds,
    pub timeout_ms: u32,
}

impl HostBinding {
    /// The common case: a pure in-worker tool that needs nothing.
    pub fn in_worker(timeout_ms: u32) -> Self {
        Self {
            host: HostAddr::Worker,
            needs: StateNeeds::None,
            timeout_ms,
        }
    }
}

/// The projected, minimal state a tool receives in its [`ToolRequest`]. Run-
/// constant config (R1) or a per-call read-only lease (R2). During the additive
/// phase the config-bearing variants carry JSON; they tighten to typed slices at
/// the dispatch cutover (C3). File data is *never* here — file tools reach OPFS /
/// the bridge directly (R3/R4).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case", tag = "slice")]
pub enum StateSlice {
    #[default]
    None,
    BridgeUrl(Option<String>),
    WebSearch(Value),
    Google(Value),
    Telegram(Value),
    Roster(Value),
    Custom(Map<String, Value>),
}

/// The only way a tool mutates durable state: a typed delta the StateWriter actor
/// applies in order. A closed enum — adding a mutation kind is a deliberate
/// edit here, not an open `Value` blob (so the writer can reason about every
/// possible change). `Many` composes several in one response.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case", tag = "patch")]
pub enum StatePatch {
    #[default]
    Empty,
    /// Upsert rolling per-agent memories (merged by agent id).
    Memories(Vec<AgentMemory>),
    /// A schedule entry was created.
    ScheduleAdded(ScheduleEntry),
    /// A schedule entry was removed by id.
    ScheduleRemoved { id: String },
    /// An artifact was appended to a run's scratchpad gallery.
    ArtifactAppended {
        run_id: String,
        artifact: RunArtifact,
    },
    /// A workspace file hint was upserted (after the bytes landed in OPFS).
    UpsertFileMeta(FileMeta),
    /// Several patches applied as one unit.
    Many(Vec<StatePatch>),
}

impl StatePatch {
    /// Whether this patch is a no-op (so dispatch can skip the StateWriter hop).
    pub fn is_empty(&self) -> bool {
        match self {
            StatePatch::Empty => true,
            StatePatch::Many(patches) => patches.iter().all(StatePatch::is_empty),
            _ => false,
        }
    }
}

/// One tool invocation on the wire: identity + addressing + the model's untrusted
/// `args` + the projected `state` + a deadline. Built by the engine, routed by the
/// hub, consumed by the tool host. Transient — not persisted.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolRequest {
    /// Correlates request↔response across the hub.
    pub req_id: String,
    /// The model-assigned tool-call id (echoed into the result envelope).
    pub call_id: String,
    pub run_id: String,
    pub agent_id: String,
    /// Delegation depth, for loop/recursion guards.
    pub depth: u32,
    pub name: String,
    pub args: Value,
    pub state: StateSlice,
    /// Absolute deadline (epoch ms) the host enforces; the hub also supervises it.
    pub deadline_ms: u64,
}

/// The settled outcome of a [`ToolRequest`]: the result envelope the engine folds
/// into history, plus the durable [`StatePatch`] the StateWriter applies.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolResponse {
    pub req_id: String,
    pub result: ToolResult,
    pub patch: StatePatch,
}

/// The projected context a delegated sub-agent receives over the wire when it is
/// spawned on a fresh worker — never the whole [`AppSnapshot`]. Assembled by the
/// `EngineTool` spawn seam (plan step C5).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CtxBundle {
    pub run_id: String,
    pub agent_id: String,
    pub depth: u32,
    pub goal: String,
    pub system_prompt: String,
    pub tool_allowlist: Vec<String>,
}

/// Build the minimal [`StateSlice`] a tool's [`StateNeeds`] requires from the
/// snapshot. This is the projection boundary: the whole snapshot stays on main;
/// only the returned slice crosses the hub. Config-bearing variants serialize the
/// relevant sub-config to JSON during the additive phase (typed at C3).
pub fn project(snapshot: &AppSnapshot, needs: &StateNeeds) -> StateSlice {
    match needs {
        StateNeeds::None => StateSlice::None,
        StateNeeds::WebSearchConfig => StateSlice::WebSearch(
            serde_json::to_value(&snapshot.tool_config.web_search).unwrap_or(Value::Null),
        ),
        StateNeeds::GoogleAuth => StateSlice::Google(
            serde_json::to_value(&snapshot.tool_config.google).unwrap_or(Value::Null),
        ),
        StateNeeds::TelegramConfig => StateSlice::Telegram(
            serde_json::to_value(&snapshot.tool_config.telegram).unwrap_or(Value::Null),
        ),
        StateNeeds::AgentRoster => {
            StateSlice::Roster(serde_json::to_value(&snapshot.agents).unwrap_or(Value::Null))
        }
        // Resolved at the dispatch cutover (C3) once the bridge-url and custom
        // field paths are wired; an empty slice here is a safe no-op.
        StateNeeds::BridgeUrl => StateSlice::BridgeUrl(None),
        StateNeeds::Custom(_) => StateSlice::Custom(Map::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_patch_empty_detection() {
        assert!(StatePatch::Empty.is_empty());
        assert!(StatePatch::Many(vec![StatePatch::Empty, StatePatch::Empty]).is_empty());
        assert!(!StatePatch::ScheduleRemoved { id: "x".into() }.is_empty());
        assert!(
            !StatePatch::Many(vec![
                StatePatch::Empty,
                StatePatch::ScheduleRemoved { id: "x".into() }
            ])
            .is_empty()
        );
    }

    #[test]
    fn host_addr_round_trips_tagged() {
        let addr = HostAddr::McpServer {
            server_id: "chrome".into(),
        };
        let json = serde_json::to_string(&addr).unwrap();
        assert!(json.contains("\"host\":\"mcp_server\""));
        let parsed: HostAddr = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, addr);
    }

    #[test]
    fn project_none_is_none_and_websearch_is_carried() {
        let snap = AppSnapshot::default();
        assert_eq!(project(&snap, &StateNeeds::None), StateSlice::None);
        match project(&snap, &StateNeeds::WebSearchConfig) {
            StateSlice::WebSearch(v) => assert!(v.is_object() || v.is_null()),
            other => panic!("expected WebSearch slice, got {other:?}"),
        }
    }

    #[test]
    fn state_patch_round_trips_tagged() {
        let patch = StatePatch::UpsertFileMeta(FileMeta {
            path: "notes/todo.md".into(),
            size: 12,
            sha256: "abc".into(),
            modified_at: "unix-ms:1".into(),
        });
        let json = serde_json::to_string(&patch).unwrap();
        assert!(json.contains("\"patch\":\"upsert_file_meta\""));
        let parsed: StatePatch = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, patch);
    }
}
