use crate::responses::ResponseFormat;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

pub type AppResult<T> = Result<T, String>;

const DEFAULT_SOUL: &str = include_str!("../soul.md");
const DEFAULT_AGENT_FILES: [(&str, &str); 3] = [
    ("agents/planner.md", include_str!("../agents/planner.md")),
    (
        "agents/researcher.md",
        include_str!("../agents/researcher.md"),
    ),
    (
        "agents/synthesizer.md",
        include_str!("../agents/synthesizer.md"),
    ),
];
const DEFAULT_SKILL_FILES: [(&str, &str); 2] = [
    (
        "skills/research/SKILL.md",
        include_str!("../skills/research/SKILL.md"),
    ),
    (
        "skills/synthesis/SKILL.md",
        include_str!("../skills/synthesis/SKILL.md"),
    ),
];

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ProviderAuthMode {
    #[default]
    Bearer,
    None,
}

impl ProviderAuthMode {
    pub fn from_form_value(value: &str) -> Self {
        match value {
            "none" => Self::None,
            _ => Self::Bearer,
        }
    }

    pub fn as_form_value(self) -> &'static str {
        match self {
            Self::Bearer => "bearer",
            Self::None => "none",
        }
    }

    pub fn requires_key(self) -> bool {
        matches!(self, Self::Bearer)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ProviderConfig {
    pub base_url: String,
    pub model: String,
    pub api_key: String,
    #[serde(default)]
    pub auth_mode: ProviderAuthMode,
    pub persist_api_key: bool,
    pub temperature: f64,
    pub max_tokens: u32,
    /// Optional nucleus-sampling parameter. Sent to the provider only when set.
    #[serde(default)]
    pub top_p: Option<f64>,
    /// Total context budget for this model. Long-running agents default to 131k.
    #[serde(default = "default_context_window")]
    pub context_window: u32,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".to_string(),
            model: "gpt-4.1-mini".to_string(),
            api_key: String::new(),
            auth_mode: ProviderAuthMode::Bearer,
            persist_api_key: false,
            temperature: 0.2,
            max_tokens: default_max_tokens(),
            top_p: None,
            context_window: default_context_window(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ProviderProfile {
    pub id: String,
    pub name: String,
    pub config: ProviderConfig,
}

impl ProviderProfile {
    pub fn new(name: impl Into<String>, config: ProviderConfig) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            config,
        }
    }

    pub fn sanitized_name(name: &str, config: &ProviderConfig) -> String {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
        if !config.model.trim().is_empty() {
            return config.model.trim().to_string();
        }
        "Provider Profile".to_string()
    }
}

/// A reusable bundle of inference-tuning settings (temperature and friends) that
/// can be paired with a model to tweak behavior per agent need without changing
/// the provider connection. Applying a profile writes its values onto the active
/// [`ProviderConfig`].
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ModelProfile {
    pub id: String,
    pub name: String,
    pub temperature: f64,
    pub max_tokens: u32,
    #[serde(default)]
    pub top_p: Option<f64>,
    #[serde(default = "default_context_window")]
    pub context_window: u32,
}

impl ModelProfile {
    pub fn new(
        name: impl Into<String>,
        temperature: f64,
        max_tokens: u32,
        top_p: Option<f64>,
        context_window: u32,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            temperature,
            max_tokens,
            top_p,
            context_window,
        }
    }
}

pub fn default_model_profiles() -> Vec<ModelProfile> {
    vec![
        ModelProfile::new(
            "Precise",
            0.2,
            default_max_tokens(),
            None,
            default_context_window(),
        ),
        ModelProfile::new(
            "Balanced",
            0.5,
            default_max_tokens(),
            None,
            default_context_window(),
        ),
        ModelProfile::new(
            "Creative",
            0.8,
            default_max_tokens(),
            Some(0.95),
            default_context_window(),
        ),
    ]
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum WebSearchProvider {
    #[default]
    Auto,
    #[serde(rename = "duckduckgo")]
    DuckDuckGo,
    #[serde(rename = "searxng")]
    SearXng,
    Brave,
    Tavily,
}

impl WebSearchProvider {
    pub fn from_form_value(value: &str) -> Self {
        match value {
            "duckduckgo" => Self::DuckDuckGo,
            "searxng" => Self::SearXng,
            "brave" => Self::Brave,
            "tavily" => Self::Tavily,
            _ => Self::Auto,
        }
    }

    pub fn as_form_value(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::DuckDuckGo => "duckduckgo",
            Self::SearXng => "searxng",
            Self::Brave => "brave",
            Self::Tavily => "tavily",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WebSearchToolConfig {
    #[serde(default = "default_bridge_tools_url")]
    pub bridge_tools_url: String,
    #[serde(default)]
    pub provider: WebSearchProvider,
    #[serde(default = "default_web_search_count")]
    pub default_count: u32,
    #[serde(default)]
    pub country: String,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub freshness: String,
    #[serde(default)]
    pub searxng_url: String,
    #[serde(default)]
    pub brave_api_key: String,
    #[serde(default)]
    pub tavily_api_key: String,
    #[serde(default)]
    pub persist_api_keys: bool,
}

impl Default for WebSearchToolConfig {
    fn default() -> Self {
        Self {
            bridge_tools_url: default_bridge_tools_url(),
            provider: WebSearchProvider::Auto,
            default_count: default_web_search_count(),
            country: String::new(),
            language: String::new(),
            freshness: String::new(),
            searxng_url: String::new(),
            brave_api_key: String::new(),
            tavily_api_key: String::new(),
            persist_api_keys: false,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct ToolConfig {
    #[serde(default)]
    pub web_search: WebSearchToolConfig,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub role: String,
    pub enabled: bool,
    pub enabled_tools: Vec<String>,
    #[serde(default)]
    pub response_format: ResponseFormat,
    #[serde(default)]
    pub source_path: Option<String>,
    /// Optional model profile this agent runs with. Falls back to the workspace
    /// active model profile when unset.
    #[serde(default)]
    pub model_profile_id: Option<String>,
    #[serde(default)]
    pub workflow_id: Option<String>,
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
            response_format: ResponseFormat::Toon,
            source_path: None,
            model_profile_id: None,
            workflow_id: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub content: String,
    pub enabled: bool,
    #[serde(default)]
    pub source_path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkflowTransition {
    pub from: String,
    pub to: String,
    pub label: String,
}

impl WorkflowTransition {
    pub fn new(from: impl Into<String>, to: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            from: from.into(),
            to: to.into(),
            label: label.into(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkflowDefinition {
    pub id: String,
    pub name: String,
    pub initial_step: String,
    #[serde(default)]
    pub transitions: Vec<WorkflowTransition>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct WorkflowRuntimeState {
    #[serde(default)]
    pub workflow_id: String,
    #[serde(default)]
    pub current_step: String,
    #[serde(default)]
    pub history: Vec<String>,
    #[serde(default)]
    pub blocked_transition: String,
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
    Routing,
    MetaTool,
    LlmRequest,
    LlmResponse,
    ToolRequested,
    ToolCompleted,
    WorkerStarted,
    WorkerCompleted,
    Workflow,
    Verification,
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

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum RunLane {
    DirectAnswer,
    SingleAction,
    #[default]
    BoundedTask,
    BackgroundJob,
    Batch,
}

impl RunLane {
    pub fn as_label(self) -> &'static str {
        match self {
            Self::DirectAnswer => "direct answer",
            Self::SingleAction => "single action",
            Self::BoundedTask => "bounded task",
            Self::BackgroundJob => "background job",
            Self::Batch => "batch",
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::DirectAnswer => "direct_answer",
            Self::SingleAction => "single_action",
            Self::BoundedTask => "bounded_task",
            Self::BackgroundJob => "background_job",
            Self::Batch => "batch",
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VerificationCheckType {
    EvidenceContains,
    ToolResultContains,
    ShellCommand,
    FileExists,
    ContentRegex,
    LlmCritic,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct VerificationCheck {
    pub check_type: VerificationCheckType,
    pub description: String,
    pub value: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct VerificationSpec {
    #[serde(default)]
    pub deterministic_checks: Vec<VerificationCheck>,
    #[serde(default)]
    pub tool_result_checks: Vec<VerificationCheck>,
    #[serde(default)]
    pub llm_critic_checks: Vec<VerificationCheck>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct VerificationState {
    #[serde(default)]
    pub spec: VerificationSpec,
    #[serde(default)]
    pub attempts: u32,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub last_result: String,
    #[serde(default)]
    pub failures: Vec<String>,
    #[serde(default)]
    pub last_progress_signature: String,
    #[serde(default)]
    pub no_progress_turns: u32,
}

impl Default for VerificationState {
    fn default() -> Self {
        Self {
            spec: VerificationSpec::default(),
            attempts: 0,
            status: "pending".to_string(),
            last_result: String::new(),
            failures: Vec::new(),
            last_progress_signature: String::new(),
            no_progress_turns: 0,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RunBudgets {
    #[serde(default = "default_run_step_budget")]
    pub max_steps: u32,
    #[serde(default = "default_verification_retry_budget")]
    pub max_verification_retries: u32,
    #[serde(default = "default_no_progress_turn_limit")]
    pub max_no_progress_turns: u32,
    #[serde(default)]
    pub steps_used: u32,
    #[serde(default)]
    pub token_budget: u32,
    #[serde(default)]
    pub tokens_used: u32,
    #[serde(default)]
    pub cost_budget_cents: u32,
    #[serde(default)]
    pub cost_used_cents: u32,
}

impl Default for RunBudgets {
    fn default() -> Self {
        Self {
            max_steps: default_run_step_budget(),
            max_verification_retries: default_verification_retry_budget(),
            max_no_progress_turns: default_no_progress_turn_limit(),
            steps_used: 0,
            token_budget: 0,
            tokens_used: 0,
            cost_budget_cents: 0,
            cost_used_cents: 0,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ScratchpadObservation {
    pub id: String,
    pub source: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RunArtifact {
    pub id: String,
    pub name: String,
    pub artifact_type: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct MetaToolCall {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub arguments: Value,
    #[serde(default)]
    pub result: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct WorkerScratchpad {
    #[serde(default)]
    pub current_plan: Vec<String>,
    #[serde(default)]
    pub observations: Vec<ScratchpadObservation>,
    #[serde(default)]
    pub artifacts: Vec<RunArtifact>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WorkerRun {
    pub id: String,
    pub role: String,
    #[serde(default)]
    pub agent_id: Option<String>,
    pub sub_goal: String,
    pub status: String,
    #[serde(default)]
    pub budget: RunBudgets,
    #[serde(default)]
    pub scratchpad: WorkerScratchpad,
    #[serde(default)]
    pub evidence: Vec<String>,
    #[serde(default)]
    pub result: String,
}

impl WorkerRun {
    // Worker orchestration is not wired into the minimal loop yet.
    #[allow(dead_code)]
    pub fn new(
        role: impl Into<String>,
        agent_id: Option<String>,
        sub_goal: impl Into<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            role: role.into(),
            agent_id,
            sub_goal: sub_goal.into(),
            status: "pending".to_string(),
            budget: RunBudgets::default(),
            scratchpad: WorkerScratchpad::default(),
            evidence: Vec::new(),
            result: String::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct RunScratchpad {
    #[serde(default)]
    pub goal: String,
    #[serde(default)]
    pub lane: RunLane,
    #[serde(default)]
    pub current_plan: Vec<String>,
    #[serde(default)]
    pub meta_tool_calls: Vec<MetaToolCall>,
    #[serde(default)]
    pub recent_observations: Vec<ScratchpadObservation>,
    #[serde(default)]
    pub artifacts: Vec<RunArtifact>,
    #[serde(default)]
    pub workers: Vec<WorkerRun>,
    #[serde(default)]
    pub verification: VerificationState,
    #[serde(default)]
    pub workflow: WorkflowRuntimeState,
    #[serde(default)]
    pub budgets: RunBudgets,
    #[serde(default)]
    pub interrupted: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct JobRecord {
    pub id: String,
    pub goal: String,
    #[serde(default)]
    pub lane: RunLane,
    pub status: String,
    #[serde(default)]
    pub progress: String,
    #[serde(default)]
    pub checkpoint: Option<RunScratchpad>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub last_error: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct OrchestratorConfig {
    #[serde(default)]
    pub routing_provider_profile_id: Option<String>,
    #[serde(default)]
    pub worker_provider_profile_id: Option<String>,
    #[serde(default = "default_max_parallelism")]
    pub max_parallelism: u32,
    #[serde(default = "default_run_step_budget")]
    pub max_steps: u32,
    #[serde(default = "default_verification_retry_budget")]
    pub verification_retries: u32,
    #[serde(default = "default_no_progress_turn_limit")]
    pub no_progress_turns: u32,
    #[serde(default = "default_orchestrator_workflow_id")]
    pub workflow_id: Option<String>,
}

impl Default for OrchestratorConfig {
    fn default() -> Self {
        Self {
            routing_provider_profile_id: None,
            worker_provider_profile_id: None,
            max_parallelism: default_max_parallelism(),
            max_steps: default_run_step_budget(),
            verification_retries: default_verification_retry_budget(),
            no_progress_turns: default_no_progress_turn_limit(),
            workflow_id: default_orchestrator_workflow_id(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct AgentRun {
    pub id: String,
    pub goal: String,
    pub status: String,
    #[serde(default)]
    pub lane: RunLane,
    #[serde(default)]
    pub scratchpad: RunScratchpad,
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
    #[serde(default)]
    pub provider_profiles: Vec<ProviderProfile>,
    #[serde(default)]
    pub active_provider_profile_id: Option<String>,
    #[serde(default)]
    pub model_profiles: Vec<ModelProfile>,
    #[serde(default)]
    pub active_model_profile_id: Option<String>,
    #[serde(default)]
    pub tool_config: ToolConfig,
    #[serde(default)]
    pub orchestrator: OrchestratorConfig,
    #[serde(default = "default_soul_prompt")]
    pub soul: String,
    pub agents: Vec<Agent>,
    #[serde(default = "default_skills")]
    pub skills: Vec<Skill>,
    #[serde(default = "default_workflows")]
    pub workflows: Vec<WorkflowDefinition>,
    pub memories: Vec<MemoryItem>,
    pub tasks: Vec<TaskItem>,
    #[serde(default)]
    pub jobs: Vec<JobRecord>,
    pub runs: Vec<AgentRun>,
    pub current_run: Option<AgentRun>,
    pub status: String,
}

impl Default for AppSnapshot {
    fn default() -> Self {
        let provider = ProviderConfig::default();
        let profile = ProviderProfile::new("OpenAI", provider.clone());
        let active_provider_profile_id = Some(profile.id.clone());
        let default_profile_id = profile.id.clone();
        let model_profiles = default_model_profiles();
        let active_model_profile_id = model_profiles.first().map(|profile| profile.id.clone());
        Self {
            provider,
            provider_profiles: vec![profile],
            active_provider_profile_id,
            model_profiles,
            active_model_profile_id,
            tool_config: ToolConfig::default(),
            orchestrator: OrchestratorConfig {
                routing_provider_profile_id: Some(default_profile_id.clone()),
                worker_provider_profile_id: Some(default_profile_id),
                ..OrchestratorConfig::default()
            },
            soul: default_soul_prompt(),
            agents: default_agents(),
            skills: default_skills(),
            workflows: default_workflows(),
            memories: Vec::new(),
            tasks: Vec::new(),
            jobs: Vec::new(),
            runs: Vec::new(),
            current_run: None,
            status: "Ready".to_string(),
        }
    }
}

pub fn default_tool_names() -> Vec<String> {
    vec![
        "web_search".to_string(),
        "file_read".to_string(),
        "file_write".to_string(),
        "file_list".to_string(),
    ]
}

pub fn default_bridge_tools_url() -> String {
    "http://127.0.0.1:8874/askk/tools".to_string()
}

fn default_web_search_count() -> u32 {
    5
}

/// Default total context budget. Long-running agents assume at least 131k tokens.
pub fn default_context_window() -> u32 {
    131_072
}

/// Default completion-token cap. Generous enough that synthesized answers are not
/// truncated, while staying well under the context window.
pub fn default_max_tokens() -> u32 {
    4_096
}

fn default_max_parallelism() -> u32 {
    3
}

fn default_run_step_budget() -> u32 {
    8
}

fn default_verification_retry_budget() -> u32 {
    1
}

fn default_no_progress_turn_limit() -> u32 {
    2
}

pub fn default_orchestrator_workflow_id() -> Option<String> {
    Some("parallel_batch".to_string())
}

pub fn default_workflows() -> Vec<WorkflowDefinition> {
    vec![WorkflowDefinition {
        id: "parallel_batch".to_string(),
        name: "Parallel batch orchestration".to_string(),
        initial_step: "planned".to_string(),
        transitions: vec![
            WorkflowTransition::new("planned", "workers_running", "dispatch child workers"),
            WorkflowTransition::new("workers_running", "workers_running", "dispatch next wave"),
            WorkflowTransition::new("workers_running", "workers_joined", "join child worker"),
            WorkflowTransition::new(
                "workers_joined",
                "workers_joined",
                "join another child worker",
            ),
            WorkflowTransition::new("workers_joined", "workers_running", "dispatch next wave"),
            WorkflowTransition::new("workers_joined", "aggregated", "aggregate child results"),
            WorkflowTransition::new("workers_running", "failed", "child worker failed"),
            WorkflowTransition::new("workers_joined", "failed", "aggregation failed"),
            WorkflowTransition::new("failed", "failed", "remain failed"),
        ],
    }]
}

pub fn default_soul_prompt() -> String {
    DEFAULT_SOUL.trim().to_string()
}

pub fn default_agents() -> Vec<Agent> {
    let agents = DEFAULT_AGENT_FILES
        .iter()
        .filter_map(|(path, content)| agent_from_markdown(path, content).ok())
        .collect::<Vec<_>>();

    if agents.is_empty() {
        return vec![Agent::new("Agent", "", default_tool_names())];
    }
    agents
}

pub fn default_skills() -> Vec<Skill> {
    DEFAULT_SKILL_FILES
        .iter()
        .filter_map(|(path, content)| skill_from_markdown(path, content).ok())
        .collect()
}

pub fn agent_from_markdown(path: &str, content: &str) -> AppResult<Agent> {
    let (meta, body) = split_markdown_frontmatter(content);
    let id = meta_value(&meta, "id")
        .filter(|value| !value.trim().is_empty())
        .map(|value| slugify(&value))
        .unwrap_or_else(|| slug_from_path(path));
    let name = meta_value(&meta, "name")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| title_from_slug(&id));
    let enabled = meta_value(&meta, "enabled")
        .map(|value| parse_bool(&value))
        .unwrap_or(true);
    let enabled_tools = meta_value(&meta, "tools")
        .map(|value| parse_tools(&value))
        .unwrap_or_else(default_tool_names);
    let response_format = meta_value(&meta, "response_format")
        .or_else(|| meta_value(&meta, "format"))
        .map(|value| ResponseFormat::from_form_value(&value))
        .unwrap_or_default();
    let workflow_id = meta_value(&meta, "workflow")
        .filter(|value| !value.trim().is_empty())
        .map(|value| slugify(&value));
    let role = body.trim().to_string();

    if role.is_empty() {
        return Err(format!("Agent file {path} does not contain a prompt body."));
    }

    Ok(Agent {
        id,
        name,
        role,
        enabled,
        enabled_tools,
        response_format,
        source_path: Some(path.to_string()),
        model_profile_id: None,
        workflow_id,
    })
}

pub fn agent_to_markdown(agent: &Agent) -> String {
    let tools = if same_tools(&agent.enabled_tools, &default_tool_names()) {
        "all".to_string()
    } else {
        agent.enabled_tools.join(", ")
    };
    format!(
        "---\nid: {id}\nname: {name}\nenabled: {enabled}\ntools: {tools}\nresponse_format: {response_format}\n---\n\n{role}\n",
        id = slugify(&agent.id),
        name = agent.name.trim(),
        enabled = agent.enabled,
        tools = tools,
        response_format = agent.response_format.as_form_value(),
        role = agent.role.trim(),
    )
}

pub fn agent_markdown_path(agent: &Agent) -> String {
    agent
        .source_path
        .as_deref()
        .filter(|path| path.starts_with("agents/") && path.ends_with(".md"))
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("agents/{}.md", slugify(&agent.name)))
}

pub fn skill_from_markdown(path: &str, content: &str) -> AppResult<Skill> {
    let (meta, body) = split_markdown_frontmatter(content);
    let id = meta_value(&meta, "id")
        .filter(|value| !value.trim().is_empty())
        .map(|value| slugify(&value))
        .unwrap_or_else(|| slug_from_path(path));
    let name = meta_value(&meta, "name")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| title_from_slug(&id));
    let enabled = meta_value(&meta, "enabled")
        .map(|value| parse_bool(&value))
        .unwrap_or(true);
    let body = body.trim().to_string();

    if body.is_empty() {
        return Err(format!("Skill file {path} does not contain a body."));
    }

    Ok(Skill {
        id,
        name,
        content: body,
        enabled,
        source_path: Some(path.to_string()),
    })
}

impl AppSnapshot {
    pub fn with_profile_defaults(mut self) -> Self {
        self.ensure_provider_profiles();
        self.ensure_model_profiles();
        self.ensure_workflow_defaults();
        self.ensure_orchestrator_defaults();
        self.recover_interrupted_run_after_reload();
        self.ensure_prompt_defaults();
        self.normalize_agent_branding();
        self.normalize_agent_tools();
        self
    }

    /// Seed default model profiles for older snapshots and keep the active id valid.
    pub fn ensure_model_profiles(&mut self) {
        if self.model_profiles.is_empty() {
            self.model_profiles = default_model_profiles();
            self.active_model_profile_id = self
                .model_profiles
                .first()
                .map(|profile| profile.id.clone());
            return;
        }

        let active_valid = self
            .active_model_profile_id
            .as_ref()
            .is_some_and(|id| self.model_profiles.iter().any(|profile| &profile.id == id));
        if !active_valid {
            self.active_model_profile_id = self
                .model_profiles
                .first()
                .map(|profile| profile.id.clone());
        }
    }

    /// Apply a saved model profile's tuning onto the active provider config.
    pub fn apply_model_profile(&mut self, profile_id: &str) -> AppResult<String> {
        let Some(profile) = self
            .model_profiles
            .iter()
            .find(|profile| profile.id == profile_id)
            .cloned()
        else {
            return Err(format!("No model profile found with id {profile_id}"));
        };
        self.provider.temperature = profile.temperature;
        self.provider.max_tokens = profile.max_tokens;
        self.provider.top_p = profile.top_p;
        self.provider.context_window = profile.context_window;
        self.active_model_profile_id = Some(profile.id);
        Ok(format!("Applied model profile: {}", profile.name))
    }

    /// Save the active provider tuning as a new named model profile.
    pub fn save_model_profile(&mut self, name: &str) -> String {
        let profile_name = sanitized_profile_name(name, "Model Profile");
        let profile = ModelProfile::new(
            profile_name.clone(),
            self.provider.temperature,
            self.provider.max_tokens,
            self.provider.top_p,
            self.provider.context_window,
        );
        self.active_model_profile_id = Some(profile.id.clone());
        self.model_profiles.push(profile);
        format!("Saved model profile: {profile_name}")
    }

    /// Update the active model profile with the current provider tuning.
    pub fn update_active_model_profile(&mut self, name: &str) -> String {
        self.ensure_model_profiles();
        let Some(active_id) = self.active_model_profile_id.clone() else {
            return self.save_model_profile(name);
        };
        let profile_name = sanitized_profile_name(name, "Model Profile");
        let (temperature, max_tokens, top_p, context_window) = (
            self.provider.temperature,
            self.provider.max_tokens,
            self.provider.top_p,
            self.provider.context_window,
        );
        let Some(profile) = self
            .model_profiles
            .iter_mut()
            .find(|profile| profile.id == active_id)
        else {
            return self.save_model_profile(&profile_name);
        };
        profile.name = profile_name.clone();
        profile.temperature = temperature;
        profile.max_tokens = max_tokens;
        profile.top_p = top_p;
        profile.context_window = context_window;
        format!("Updated model profile: {profile_name}")
    }

    /// Delete a model profile, keeping at least one and a valid active id.
    pub fn delete_model_profile(&mut self, profile_id: &str) -> String {
        if self.model_profiles.len() <= 1 {
            return "Keep at least one model profile.".to_string();
        }
        let Some(index) = self
            .model_profiles
            .iter()
            .position(|profile| profile.id == profile_id)
        else {
            return format!("No model profile found with id {profile_id}");
        };
        let removed = self.model_profiles.remove(index);
        if self.active_model_profile_id.as_deref() == Some(profile_id) {
            self.active_model_profile_id = self
                .model_profiles
                .first()
                .map(|profile| profile.id.clone());
        }
        format!("Deleted model profile: {}", removed.name)
    }

    pub fn ensure_prompt_defaults(&mut self) {
        if self.soul.trim().is_empty() {
            self.soul = default_soul_prompt();
        }
        if self.skills.is_empty() {
            self.skills = default_skills();
        }
    }

    pub fn normalize_agent_branding(&mut self) {
        for agent in &mut self.agents {
            strip_agent_branding(&mut agent.name);
        }
        if let Some(run) = &mut self.current_run {
            normalize_run_branding(run);
        }
        for run in &mut self.runs {
            normalize_run_branding(run);
        }
    }

    pub fn normalize_agent_tools(&mut self) {
        for agent in &mut self.agents {
            let normalized = parse_tools(&agent.enabled_tools.join(","));
            agent.enabled_tools = normalized;
        }
    }

    pub fn ensure_provider_profiles(&mut self) {
        if self.provider_profiles.is_empty() {
            let name = ProviderProfile::sanitized_name("Current Provider", &self.provider);
            let profile = ProviderProfile::new(name, self.provider.clone());
            self.active_provider_profile_id = Some(profile.id.clone());
            self.provider_profiles.push(profile);
            return;
        }

        let active_exists = self.active_provider_profile_id.as_ref().is_some_and(|id| {
            self.provider_profiles
                .iter()
                .any(|profile| &profile.id == id)
        });

        if !active_exists {
            self.active_provider_profile_id = self
                .provider_profiles
                .first()
                .map(|profile| profile.id.clone());
        }
    }

    pub fn ensure_workflow_defaults(&mut self) {
        if self.workflows.is_empty() {
            self.workflows = default_workflows();
        }
        if self.orchestrator.workflow_id.is_none() {
            self.orchestrator.workflow_id = default_orchestrator_workflow_id();
        }
    }

    pub fn ensure_orchestrator_defaults(&mut self) {
        let active_id = self.active_provider_profile_id.clone();
        if self.orchestrator.routing_provider_profile_id.is_none() {
            self.orchestrator.routing_provider_profile_id = active_id.clone();
        }
        if self.orchestrator.worker_provider_profile_id.is_none() {
            self.orchestrator.worker_provider_profile_id = active_id;
        }
        if self.orchestrator.max_parallelism == 0 {
            self.orchestrator.max_parallelism = default_max_parallelism();
        }
        if self.orchestrator.max_steps == 0 {
            self.orchestrator.max_steps = default_run_step_budget();
        }
        if self.orchestrator.verification_retries == 0 {
            self.orchestrator.verification_retries = default_verification_retry_budget();
        }
        if self.orchestrator.no_progress_turns == 0 {
            self.orchestrator.no_progress_turns = default_no_progress_turn_limit();
        }
    }

    pub fn checkpoint_current_run(&mut self) {
        if let Some(run) = self.current_run.clone() {
            self.upsert_job_from_run(&run, &run.status);
        }
    }

    pub fn is_stale_checkpoint_for(&self, existing: &AppSnapshot) -> bool {
        let Some(incoming) = self.current_run.as_ref() else {
            return false;
        };
        let Some(current) = existing.current_run.as_ref() else {
            return false;
        };
        let incoming_is_live_checkpoint =
            self.status.starts_with("Running ") || !is_terminal_run_status(&incoming.status);
        incoming.id == current.id
            && is_terminal_run_status(&current.status)
            && incoming_is_live_checkpoint
    }

    pub fn recover_interrupted_run_after_reload(&mut self) {
        let Some(mut run) = self.current_run.clone() else {
            return;
        };
        if run.status != "running" {
            return;
        }

        run.status = "paused".to_string();
        run.scratchpad.interrupted = true;
        run.events.push(event(
            &run.id,
            None,
            AgentEventKind::Interrupted,
            "Run paused after reload",
            "The browser reloaded while this run was active. The checkpoint is resumable.",
        ));
        self.status = "Recovered a paused run from IndexedDB.".to_string();
        self.current_run = Some(run.clone());
        self.upsert_job_from_run(&run, "paused");
    }

    pub fn upsert_job_from_run(&mut self, run: &AgentRun, status: &str) {
        let now = now_iso();
        let progress = run
            .events
            .last()
            .map(|event| event.title.clone())
            .unwrap_or_else(|| run.status.clone());
        if let Some(job) = self.jobs.iter_mut().find(|job| job.id == run.id) {
            job.status = status.to_string();
            job.progress = progress;
            job.checkpoint = Some(run.scratchpad.clone());
            job.updated_at = now;
            job.last_error = run
                .events
                .iter()
                .rev()
                .find(|event| event.kind == AgentEventKind::Error)
                .map(|event| event.body.clone())
                .unwrap_or_default();
            return;
        }

        self.jobs.push(JobRecord {
            id: run.id.clone(),
            goal: run.goal.clone(),
            lane: run.lane,
            status: status.to_string(),
            progress,
            checkpoint: Some(run.scratchpad.clone()),
            created_at: run.created_at.clone(),
            updated_at: now,
            last_error: String::new(),
        });
    }

    pub fn sanitize_api_keys(&mut self) {
        if !self.provider.persist_api_key {
            self.provider.api_key.clear();
        }
        for profile in &mut self.provider_profiles {
            if !profile.config.persist_api_key {
                profile.config.api_key.clear();
            }
        }
        if !self.tool_config.web_search.persist_api_keys {
            self.tool_config.web_search.brave_api_key.clear();
            self.tool_config.web_search.tavily_api_key.clear();
        }
    }

    pub fn select_provider_profile(&mut self, profile_id: &str) -> AppResult<String> {
        let Some(profile) = self
            .provider_profiles
            .iter()
            .find(|profile| profile.id == profile_id)
            .cloned()
        else {
            return Err(format!("No provider profile found with id {profile_id}"));
        };
        self.provider = profile.config;
        self.active_provider_profile_id = Some(profile.id);
        Ok(format!("Selected provider profile: {}", profile.name))
    }

    pub fn save_current_provider_profile(&mut self, name: &str) -> String {
        let profile_name = ProviderProfile::sanitized_name(name, &self.provider);
        let profile = ProviderProfile::new(profile_name.clone(), self.provider.clone());
        self.active_provider_profile_id = Some(profile.id.clone());
        self.provider_profiles.push(profile);
        format!("Saved provider profile: {profile_name}")
    }

    pub fn update_active_provider_profile(&mut self, name: &str) -> String {
        self.ensure_provider_profiles();
        let Some(active_id) = self.active_provider_profile_id.clone() else {
            return self.save_current_provider_profile(name);
        };
        let profile_name = ProviderProfile::sanitized_name(name, &self.provider);
        let Some(profile) = self
            .provider_profiles
            .iter_mut()
            .find(|profile| profile.id == active_id)
        else {
            return self.save_current_provider_profile(&profile_name);
        };
        profile.name = profile_name.clone();
        profile.config = self.provider.clone();
        format!("Updated provider profile: {profile_name}")
    }

    pub fn delete_provider_profile(&mut self, profile_id: &str) -> String {
        if self.provider_profiles.len() <= 1 {
            return "Keep at least one provider profile.".to_string();
        }

        let Some(index) = self
            .provider_profiles
            .iter()
            .position(|profile| profile.id == profile_id)
        else {
            return format!("No provider profile found with id {profile_id}");
        };

        let removed = self.provider_profiles.remove(index);
        if self.active_provider_profile_id.as_deref() == Some(profile_id)
            && let Some(next) = self.provider_profiles.first().cloned()
        {
            self.provider = next.config;
            self.active_provider_profile_id = Some(next.id);
        }
        format!("Deleted provider profile: {}", removed.name)
    }
}

fn split_markdown_frontmatter(content: &str) -> (Vec<(String, String)>, String) {
    let normalized = content.replace("\r\n", "\n");
    let mut lines = normalized.lines();
    if lines.next() != Some("---") {
        return (Vec::new(), normalized);
    }

    let mut meta = Vec::new();
    let mut body = Vec::new();
    let mut in_meta = true;
    for line in lines {
        if in_meta && line.trim() == "---" {
            in_meta = false;
            continue;
        }
        if in_meta {
            if let Some((key, value)) = line.split_once(':') {
                meta.push((key.trim().to_ascii_lowercase(), value.trim().to_string()));
            }
        } else {
            body.push(line);
        }
    }
    (meta, body.join("\n"))
}

fn meta_value(meta: &[(String, String)], key: &str) -> Option<String> {
    meta.iter()
        .find(|(candidate, _)| candidate == key)
        .map(|(_, value)| value.clone())
}

fn parse_bool(value: &str) -> bool {
    !matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "false" | "0" | "no"
    )
}

fn parse_tools(value: &str) -> Vec<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("all") {
        return default_tool_names();
    }

    let mut tools = Vec::new();
    for raw in trimmed.split(',') {
        let candidate = raw.trim();
        if candidate.is_empty() {
            continue;
        }
        if !candidate
            .chars()
            .all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
        {
            continue;
        }
        let normalized = candidate.to_ascii_lowercase();
        if !tools.iter().any(|tool| tool == &normalized) {
            tools.push(normalized);
        }
    }

    if tools.is_empty() {
        default_tool_names()
    } else {
        tools
    }
}

fn same_tools(left: &[String], right: &[String]) -> bool {
    let mut left = left.to_vec();
    let mut right = right.to_vec();
    left.sort();
    right.sort();
    left == right
}

fn slug_from_path(path: &str) -> String {
    let file = path
        .rsplit('/')
        .next()
        .unwrap_or(path)
        .trim_end_matches(".md")
        .trim_end_matches(".MD");
    slugify(file)
}

fn title_from_slug(slug: &str) -> String {
    slug.split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn slugify(value: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in value.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        Uuid::new_v4().to_string()
    } else {
        slug
    }
}

fn normalize_run_branding(run: &mut AgentRun) {
    strip_agent_branding(&mut run.final_answer);
    for message in &mut run.messages {
        strip_agent_branding(&mut message.content);
    }
    for event in &mut run.events {
        strip_agent_branding(&mut event.title);
        strip_agent_branding(&mut event.body);
    }
    for call in &mut run.scratchpad.meta_tool_calls {
        strip_agent_branding(&mut call.result);
    }
    for worker in &mut run.scratchpad.workers {
        strip_agent_branding(&mut worker.role);
        strip_agent_branding(&mut worker.result);
        for evidence in &mut worker.evidence {
            strip_agent_branding(evidence);
        }
    }
}

fn strip_agent_branding(value: &mut String) {
    if value.contains("ASKK ") {
        *value = value.replace("ASKK ", "");
    }
}

fn sanitized_profile_name(name: &str, fallback: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn is_terminal_run_status(status: &str) -> bool {
    matches!(status, "complete" | "error" | "cancelled" | "interrupted")
}

pub fn now_iso() -> String {
    #[cfg(target_arch = "wasm32")]
    {
        return js_sys::Date::new_0()
            .to_iso_string()
            .as_string()
            .unwrap_or_else(|| "unknown-time".to_string());
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn provider_auth_mode_defaults_to_bearer_for_old_config() {
        let config: ProviderConfig = serde_json::from_value(json!({
            "base_url": "https://api.openai.com/v1",
            "model": "gpt-4.1-mini",
            "api_key": "",
            "persist_api_key": false,
            "temperature": 0.2,
            "max_tokens": 900
        }))
        .unwrap();

        assert_eq!(config.auth_mode, ProviderAuthMode::Bearer);
    }

    #[test]
    fn old_snapshot_without_auth_mode_deserializes() {
        let snapshot = serde_json::from_value::<AppSnapshot>(json!({
            "provider": {
                "base_url": "https://api.openai.com/v1",
                "model": "gpt-4.1-mini",
                "api_key": "",
                "persist_api_key": false,
                "temperature": 0.2,
                "max_tokens": 900
            },
            "agents": [],
            "memories": [],
            "tasks": [],
            "runs": [],
            "current_run": null,
            "status": "Ready"
        }))
        .unwrap();

        assert_eq!(snapshot.provider.auth_mode, ProviderAuthMode::Bearer);
        assert_eq!(
            snapshot.tool_config.web_search.bridge_tools_url,
            default_bridge_tools_url()
        );
    }

    #[test]
    fn old_snapshot_seeds_provider_profile_on_normalize() {
        let snapshot = serde_json::from_value::<AppSnapshot>(json!({
            "provider": {
                "base_url": "http://127.0.0.1:8874/v1",
                "model": "local-model",
                "api_key": "",
                "auth_mode": "none",
                "persist_api_key": false,
                "temperature": 0.2,
                "max_tokens": 900
            },
            "agents": [],
            "memories": [],
            "tasks": [],
            "runs": [],
            "current_run": null,
            "status": "Ready"
        }))
        .unwrap()
        .with_profile_defaults();

        assert_eq!(snapshot.provider_profiles.len(), 1);
        assert_eq!(snapshot.provider_profiles[0].config.model, "local-model");
        assert_eq!(
            snapshot.active_provider_profile_id.as_deref(),
            Some(snapshot.provider_profiles[0].id.as_str())
        );
    }

    #[test]
    fn old_snapshot_strips_agent_branding_on_normalize() {
        let snapshot = serde_json::from_value::<AppSnapshot>(json!({
            "provider": {
                "base_url": "https://api.openai.com/v1",
                "model": "gpt-4.1-mini",
                "api_key": "",
                "persist_api_key": false,
                "temperature": 0.2,
                "max_tokens": 900
            },
            "agents": [
                {
                    "id": "planner",
                    "name": "ASKK Planner",
                    "role": "Plan.",
                    "enabled": true,
                    "enabled_tools": []
                }
            ],
            "memories": [],
            "tasks": [],
            "runs": [
                {
                    "id": "run-1",
                    "goal": "Test",
                    "status": "complete",
                    "messages": [
                        {
                            "role": "assistant",
                            "content": "ASKK Planner: done"
                        }
                    ],
                    "events": [
                        {
                            "id": "event-1",
                            "run_id": "run-1",
                            "agent_id": "planner",
                            "kind": "LlmResponse",
                            "title": "ASKK Planner responded",
                            "body": "ASKK Planner finished",
                            "created_at": "now"
                        }
                    ],
                    "tool_calls": [],
                    "tool_results": [],
                    "final_answer": "ASKK Synthesizer: final",
                    "created_at": "now"
                }
            ],
            "current_run": null,
            "status": "Ready"
        }))
        .unwrap()
        .with_profile_defaults();

        assert_eq!(snapshot.agents[0].name, "Planner");
        assert_eq!(snapshot.agents[0].response_format, ResponseFormat::Toon);
        assert_eq!(snapshot.runs[0].messages[0].content, "Planner: done");
        assert_eq!(snapshot.runs[0].events[0].title, "Planner responded");
        assert_eq!(snapshot.runs[0].events[0].body, "Planner finished");
        assert_eq!(snapshot.runs[0].final_answer, "Synthesizer: final");
        assert_eq!(snapshot.agents[0].enabled_tools, default_tool_names());
    }

    #[test]
    fn parses_agent_markdown_frontmatter_and_normalizes_tools() {
        let agent = agent_from_markdown(
            "agents/deep-research.md",
            "---\nid: deep-research\nname: Deep Research\nenabled: false\ntools: memory_search, web_search\nresponse_format: json\n---\n\nResearch deeply.",
        )
        .unwrap();

        assert_eq!(agent.id, "deep-research");
        assert_eq!(agent.name, "Deep Research");
        assert!(!agent.enabled);
        assert_eq!(
            agent.enabled_tools,
            vec!["memory_search".to_string(), "web_search".to_string()]
        );
        assert_eq!(agent.response_format, ResponseFormat::Json);
        assert_eq!(agent.role, "Research deeply.");
        assert_eq!(
            agent.source_path.as_deref(),
            Some("agents/deep-research.md")
        );

        let serialized = agent_to_markdown(&agent);
        assert!(serialized.contains("name: Deep Research"));
        assert!(serialized.contains("tools: memory_search, web_search"));
        assert!(serialized.contains("response_format: json"));
        assert!(serialized.contains("Research deeply."));
    }

    #[test]
    fn agent_markdown_defaults_to_toon_response_format() {
        let agent = agent_from_markdown(
            "agents/planner.md",
            "---\nid: planner\nname: Planner\nenabled: true\ntools: all\n---\n\nPlan.",
        )
        .unwrap();

        assert_eq!(agent.response_format, ResponseFormat::Toon);
    }

    #[test]
    fn parses_skill_markdown_frontmatter_and_body() {
        let skill = skill_from_markdown(
            "skills/research/SKILL.md",
            "---\nid: research\nname: Research\nenabled: true\n---\n\nUse evidence.",
        )
        .unwrap();

        assert_eq!(skill.id, "research");
        assert_eq!(skill.name, "Research");
        assert!(skill.enabled);
        assert_eq!(skill.content, "Use evidence.");
        assert_eq!(
            skill.source_path.as_deref(),
            Some("skills/research/SKILL.md")
        );
    }

    #[test]
    fn sanitize_api_keys_clears_active_provider_and_profiles() {
        let mut snapshot = AppSnapshot::default();
        snapshot.provider.api_key = "active-secret".to_string();
        snapshot.provider.persist_api_key = false;
        snapshot.provider_profiles = vec![
            ProviderProfile::new(
                "Persisted",
                ProviderConfig {
                    api_key: "kept".to_string(),
                    persist_api_key: true,
                    ..ProviderConfig::default()
                },
            ),
            ProviderProfile::new(
                "Ephemeral",
                ProviderConfig {
                    api_key: "cleared".to_string(),
                    persist_api_key: false,
                    ..ProviderConfig::default()
                },
            ),
        ];
        snapshot.tool_config.web_search.brave_api_key = "brave-secret".to_string();
        snapshot.tool_config.web_search.tavily_api_key = "tavily-secret".to_string();
        snapshot.tool_config.web_search.persist_api_keys = false;

        snapshot.sanitize_api_keys();

        assert!(snapshot.provider.api_key.is_empty());
        assert_eq!(snapshot.provider_profiles[0].config.api_key, "kept");
        assert!(snapshot.provider_profiles[1].config.api_key.is_empty());
        assert!(snapshot.tool_config.web_search.brave_api_key.is_empty());
        assert!(snapshot.tool_config.web_search.tavily_api_key.is_empty());
    }

    #[test]
    fn sanitize_api_keys_keeps_web_search_keys_when_enabled() {
        let mut snapshot = AppSnapshot::default();
        snapshot.tool_config.web_search.brave_api_key = "brave-secret".to_string();
        snapshot.tool_config.web_search.tavily_api_key = "tavily-secret".to_string();
        snapshot.tool_config.web_search.persist_api_keys = true;

        snapshot.sanitize_api_keys();

        assert_eq!(
            snapshot.tool_config.web_search.brave_api_key,
            "brave-secret"
        );
        assert_eq!(
            snapshot.tool_config.web_search.tavily_api_key,
            "tavily-secret"
        );
    }

    #[test]
    fn web_search_tool_config_deserializes_defaults() {
        let config = serde_json::from_value::<ToolConfig>(json!({
            "web_search": {
                "provider": "duckduckgo"
            }
        }))
        .unwrap();

        assert_eq!(config.web_search.provider, WebSearchProvider::DuckDuckGo);
        assert_eq!(
            config.web_search.bridge_tools_url,
            default_bridge_tools_url()
        );
        assert_eq!(config.web_search.default_count, 5);
        assert!(!config.web_search.persist_api_keys);
    }

    #[test]
    fn default_tool_list_contains_expected_browser_tools() {
        assert_eq!(
            default_tool_names(),
            vec!["web_search", "file_read", "file_write", "file_list"]
        );
        assert_eq!(parse_tools("all"), default_tool_names());
    }

    #[test]
    fn parses_agent_tool_allowlist_from_markdown() {
        assert_eq!(
            parse_tools("calculator, file_read, web_search"),
            vec!["calculator", "file_read", "web_search"]
        );
        assert_eq!(
            parse_tools(" calculator , calculator , file-read "),
            vec!["calculator"]
        );
    }

    #[test]
    fn normalize_agent_tools_preserves_manifest_allowlist() {
        let mut snapshot = AppSnapshot::default();
        snapshot.agents = vec![Agent::new(
            "Restricted",
            "Use only the allowed tools.",
            vec!["web_search".to_string(), "web_search".to_string()],
        )];

        snapshot.normalize_agent_tools();

        assert_eq!(snapshot.agents[0].enabled_tools, vec!["web_search"]);
    }

    #[test]
    fn normalize_agent_tools_defaults_only_empty_allowlists() {
        let mut snapshot = AppSnapshot::default();
        snapshot.agents = vec![Agent::new("Legacy", "Use defaults.", Vec::new())];

        snapshot.normalize_agent_tools();

        assert_eq!(snapshot.agents[0].enabled_tools, default_tool_names());
    }

    #[test]
    fn provider_profile_helpers_select_update_and_delete() {
        let mut snapshot = AppSnapshot::default();
        snapshot.provider.model = "first-model".to_string();
        let save_status = snapshot.save_current_provider_profile("First");
        let first_id = snapshot.active_provider_profile_id.clone().unwrap();
        snapshot.provider.model = "second-model".to_string();
        let update_status = snapshot.update_active_provider_profile("Second");

        assert_eq!(save_status, "Saved provider profile: First");
        assert_eq!(update_status, "Updated provider profile: Second");
        assert_eq!(
            snapshot
                .provider_profiles
                .iter()
                .find(|profile| profile.id == first_id)
                .unwrap()
                .config
                .model,
            "second-model"
        );

        let default_id = snapshot
            .provider_profiles
            .iter()
            .find(|profile| profile.id != first_id)
            .unwrap()
            .id
            .clone();
        snapshot.select_provider_profile(&default_id).unwrap();
        assert_eq!(snapshot.provider.model, "gpt-4.1-mini");

        let delete_status = snapshot.delete_provider_profile(&first_id);
        assert_eq!(delete_status, "Deleted provider profile: Second");
        assert!(
            !snapshot
                .provider_profiles
                .iter()
                .any(|profile| profile.id == first_id)
        );
    }

    #[test]
    fn checkpoint_current_run_persists_resumable_job_record() {
        let mut snapshot = AppSnapshot::default();
        let run = AgentRun {
            id: "run-checkpoint".to_string(),
            goal: "Persist this run".to_string(),
            lane: RunLane::BoundedTask,
            status: "running".to_string(),
            scratchpad: RunScratchpad {
                budgets: RunBudgets {
                    steps_used: 2,
                    max_steps: 5,
                    ..RunBudgets::default()
                },
                ..RunScratchpad::default()
            },
            messages: Vec::new(),
            events: vec![event(
                "run-checkpoint",
                Some("assistant".to_string()),
                AgentEventKind::LlmRequest,
                "LLM request 2/5",
                "Checkpointable progress",
            )],
            tool_calls: Vec::new(),
            tool_results: Vec::new(),
            final_answer: String::new(),
            created_at: "now".to_string(),
        };
        snapshot.current_run = Some(run);

        snapshot.checkpoint_current_run();

        assert_eq!(snapshot.jobs.len(), 1);
        assert_eq!(snapshot.jobs[0].id, "run-checkpoint");
        assert_eq!(snapshot.jobs[0].status, "running");
        assert_eq!(snapshot.jobs[0].progress, "LLM request 2/5");
        assert_eq!(
            snapshot.jobs[0]
                .checkpoint
                .as_ref()
                .unwrap()
                .budgets
                .steps_used,
            2
        );
    }

    #[test]
    fn stale_running_checkpoint_does_not_overwrite_completed_run() {
        let mut completed = AppSnapshot::default();
        completed.current_run = Some(AgentRun {
            id: "run-race".to_string(),
            goal: "Final result".to_string(),
            lane: RunLane::Batch,
            status: "complete".to_string(),
            scratchpad: RunScratchpad::default(),
            messages: Vec::new(),
            events: Vec::new(),
            tool_calls: Vec::new(),
            tool_results: Vec::new(),
            final_answer: "done".to_string(),
            created_at: "now".to_string(),
        });

        let mut stale = completed.clone();
        stale.status = "Running batch lane...".to_string();
        stale.current_run.as_mut().unwrap().status = "running".to_string();
        stale.current_run.as_mut().unwrap().final_answer.clear();

        assert!(stale.is_stale_checkpoint_for(&completed));

        stale.current_run.as_mut().unwrap().status = "complete".to_string();
        stale.current_run.as_mut().unwrap().final_answer = "done".to_string();
        assert!(stale.is_stale_checkpoint_for(&completed));
        assert!(!completed.is_stale_checkpoint_for(&stale));

        let mut interrupted = completed.clone();
        interrupted.status = "Run interrupted.".to_string();
        interrupted.current_run.as_mut().unwrap().status = "interrupted".to_string();
        let mut stale_after_interrupt = interrupted.clone();
        stale_after_interrupt.status = "Running bounded task lane...".to_string();
        stale_after_interrupt.current_run.as_mut().unwrap().status = "running".to_string();
        assert!(stale_after_interrupt.is_stale_checkpoint_for(&interrupted));
    }

    #[test]
    fn normalize_pauses_running_run_after_reload_and_keeps_resume_checkpoint() {
        let mut snapshot = AppSnapshot::default();
        snapshot.current_run = Some(AgentRun {
            id: "run-reload".to_string(),
            goal: "Resume after reload".to_string(),
            lane: RunLane::BoundedTask,
            status: "running".to_string(),
            scratchpad: RunScratchpad::default(),
            messages: Vec::new(),
            events: Vec::new(),
            tool_calls: Vec::new(),
            tool_results: Vec::new(),
            final_answer: String::new(),
            created_at: "now".to_string(),
        });

        let snapshot = snapshot.with_profile_defaults();

        let run = snapshot.current_run.as_ref().unwrap();
        assert_eq!(run.status, "paused");
        assert!(run.scratchpad.interrupted);
        assert_eq!(snapshot.jobs.len(), 1);
        assert_eq!(snapshot.jobs[0].id, "run-reload");
        assert_eq!(snapshot.jobs[0].status, "paused");
        assert!(snapshot.jobs[0].checkpoint.is_some());
        assert!(
            run.events
                .iter()
                .any(|event| event.kind == AgentEventKind::Interrupted)
        );
    }
}
