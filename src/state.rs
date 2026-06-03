use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

pub type AppResult<T> = Result<T, String>;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ProviderConfig {
    pub base_url: String,
    pub model: String,
    pub api_key: String,
    pub persist_api_key: bool,
    pub temperature: f64,
    pub max_tokens: u32,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".to_string(),
            model: "gpt-4.1-mini".to_string(),
            api_key: String::new(),
            persist_api_key: false,
            temperature: 0.2,
            max_tokens: 900,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub role: String,
    pub enabled: bool,
    pub enabled_tools: Vec<String>,
}

impl Agent {
    pub fn new(
        name: impl Into<String>,
        role: impl Into<String>,
        enabled_tools: Vec<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            role: role.into(),
            enabled: true,
            enabled_tools,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ToolCall {
    pub id: String,
    pub agent_id: String,
    pub tool_name: String,
    pub arguments: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ToolResult {
    pub call_id: String,
    pub ok: bool,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct MemoryItem {
    pub id: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct TaskItem {
    pub id: String,
    pub title: String,
    pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum AgentEventKind {
    Started,
    LlmRequest,
    LlmResponse,
    ToolRequested,
    ToolCompleted,
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct AgentRun {
    pub id: String,
    pub goal: String,
    pub status: String,
    pub messages: Vec<Message>,
    pub events: Vec<AgentEvent>,
    pub tool_calls: Vec<ToolCall>,
    pub tool_results: Vec<ToolResult>,
    pub final_answer: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct AppSnapshot {
    pub provider: ProviderConfig,
    pub agents: Vec<Agent>,
    pub memories: Vec<MemoryItem>,
    pub tasks: Vec<TaskItem>,
    pub runs: Vec<AgentRun>,
    pub current_run: Option<AgentRun>,
    pub status: String,
}

impl Default for AppSnapshot {
    fn default() -> Self {
        let tools = default_tool_names();
        Self {
            provider: ProviderConfig::default(),
            agents: vec![
                Agent::new(
                    "ASKK Planner",
                    "Break the user goal into concrete steps. Use tools when they improve the run.",
                    tools.clone(),
                ),
                Agent::new(
                    "ASKK Researcher",
                    "Collect useful context, query memory, and fetch public web text when CORS allows it.",
                    tools.clone(),
                ),
                Agent::new(
                    "ASKK Synthesizer",
                    "Turn run events and tool results into a concise final answer.",
                    tools,
                ),
            ],
            memories: Vec::new(),
            tasks: Vec::new(),
            runs: Vec::new(),
            current_run: None,
            status: "Ready".to_string(),
        }
    }
}

pub fn default_tool_names() -> Vec<String> {
    vec![
        "memory_write".to_string(),
        "memory_search".to_string(),
        "summarize_notes".to_string(),
        "create_task".to_string(),
        "update_task".to_string(),
        "web_fetch_text".to_string(),
    ]
}

pub fn now_iso() -> String {
    js_sys::Date::new_0()
        .to_iso_string()
        .as_string()
        .unwrap_or_else(|| "unknown-time".to_string())
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
