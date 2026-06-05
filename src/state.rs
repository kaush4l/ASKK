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
pub enum ProviderAuthMode {
    Bearer,
    None,
}

impl Default for ProviderAuthMode {
    fn default() -> Self {
        Self::Bearer
    }
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
            max_tokens: 900,
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

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WebSearchProvider {
    Auto,
    #[serde(rename = "duckduckgo")]
    DuckDuckGo,
    #[serde(rename = "searxng")]
    SearXng,
    Brave,
    Tavily,
}

impl Default for WebSearchProvider {
    fn default() -> Self {
        Self::Auto
    }
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
    #[serde(default)]
    pub provider_profiles: Vec<ProviderProfile>,
    #[serde(default)]
    pub active_provider_profile_id: Option<String>,
    #[serde(default)]
    pub tool_config: ToolConfig,
    #[serde(default = "default_soul_prompt")]
    pub soul: String,
    pub agents: Vec<Agent>,
    #[serde(default = "default_skills")]
    pub skills: Vec<Skill>,
    pub memories: Vec<MemoryItem>,
    pub tasks: Vec<TaskItem>,
    pub runs: Vec<AgentRun>,
    pub current_run: Option<AgentRun>,
    pub status: String,
}

impl Default for AppSnapshot {
    fn default() -> Self {
        let provider = ProviderConfig::default();
        let profile = ProviderProfile::new("OpenAI", provider.clone());
        let active_provider_profile_id = Some(profile.id.clone());
        Self {
            provider,
            provider_profiles: vec![profile],
            active_provider_profile_id,
            tool_config: ToolConfig::default(),
            soul: default_soul_prompt(),
            agents: default_agents(),
            skills: default_skills(),
            memories: Vec::new(),
            tasks: Vec::new(),
            runs: Vec::new(),
            current_run: None,
            status: "Ready".to_string(),
        }
    }
}

pub fn default_tool_names() -> Vec<String> {
    vec!["web_search".to_string()]
}

pub fn default_bridge_tools_url() -> String {
    "http://127.0.0.1:8874/askk/tools".to_string()
}

fn default_web_search_count() -> u32 {
    5
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
        self.ensure_prompt_defaults();
        self.normalize_agent_branding();
        self.normalize_agent_tools();
        self
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
            agent.enabled_tools = default_tool_names();
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
        if self.active_provider_profile_id.as_deref() == Some(profile_id) {
            if let Some(next) = self.provider_profiles.first().cloned() {
                self.provider = next.config;
                self.active_provider_profile_id = Some(next.id);
            }
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
    let _ = value;
    default_tool_names()
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
}

fn strip_agent_branding(value: &mut String) {
    if value.contains("ASKK ") {
        *value = value.replace("ASKK ", "");
    }
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
        assert_eq!(agent.enabled_tools, default_tool_names());
        assert_eq!(agent.response_format, ResponseFormat::Json);
        assert_eq!(agent.role, "Research deeply.");
        assert_eq!(
            agent.source_path.as_deref(),
            Some("agents/deep-research.md")
        );

        let serialized = agent_to_markdown(&agent);
        assert!(serialized.contains("name: Deep Research"));
        assert!(serialized.contains("tools: all"));
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
    fn default_tool_list_contains_only_web_search() {
        assert_eq!(default_tool_names(), vec!["web_search"]);
        assert_eq!(parse_tools("all"), vec!["web_search"]);
        assert_eq!(
            parse_tools("memory_search, web_extract"),
            vec!["web_search"]
        );
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
        assert!(!snapshot
            .provider_profiles
            .iter()
            .any(|profile| profile.id == first_id));
    }
}
