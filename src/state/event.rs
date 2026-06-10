//! The run timeline: typed [`AgentEvent`]s emitted as a run progresses, the
//! [`event`] constructor that stamps them, and [`now_iso`] (the one place time is
//! read, with a browser and a host implementation).

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum AgentEventKind {
    Started,
    Routing,
    MetaTool,
    LlmRequest,
    LlmResponse,
    ToolRequested,
    ToolCompleted,
    WorkerStarted,
    WorkerCompleted,
    Workflow,
    /// A strategy phase began.
    PhaseStarted,
    /// A strategy phase completed (body carries the routing decision).
    PhaseCompleted,
    /// Working memory was compacted (older messages folded into a summary).
    MemoryCompacted,
    Verification,
    /// A browser MCP server was connected at run start.
    McpConnected,
    /// A connected MCP server's tools were discovered via `tools/list`.
    McpToolsListed,
    Interrupted,
    FinalAnswer,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct AgentEvent {
    pub id: String,
    pub run_id: String,
    pub agent_id: Option<String>,
    pub kind: AgentEventKind,
    pub title: String,
    pub body: String,
    pub created_at: String,
}

pub fn event(
    run_id: &str,
    agent_id: Option<String>,
    kind: AgentEventKind,
    title: impl Into<String>,
    body: impl Into<String>,
) -> AgentEvent {
    AgentEvent {
        id: Uuid::new_v4().to_string(),
        run_id: run_id.to_string(),
        agent_id,
        kind,
        title: title.into(),
        body: body.into(),
        created_at: now_iso(),
    }
}

/// Current time as an ISO-8601 string in the browser, or a `unix-ms:` stamp on the
/// host test runner (which has no `js_sys::Date`).
pub fn now_iso() -> String {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::new_0()
            .to_iso_string()
            .as_string()
            .unwrap_or_else(|| "unknown-time".to_string())
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default();
        format!("unix-ms:{millis}")
    }
}
