use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

pub type AppResult<T> = Result<T, String>;

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
    #[serde(default)]
    pub provider_profiles: Vec<ProviderProfile>,
    #[serde(default)]
    pub active_provider_profile_id: Option<String>,
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
        let provider = ProviderConfig::default();
        let profile = ProviderProfile::new("OpenAI", provider.clone());
        let active_provider_profile_id = Some(profile.id.clone());
        Self {
            provider,
            provider_profiles: vec![profile],
            active_provider_profile_id,
            agents: vec![
                Agent::new(
                    "Planner",
                    "Break the user goal into concrete steps. Use tools when they improve the run.",
                    tools.clone(),
                ),
                Agent::new(
                    "Researcher",
                    "Collect useful context, query memory, and fetch public web text when CORS allows it.",
                    tools.clone(),
                ),
                Agent::new(
                    "Synthesizer",
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
        "web_search".to_string(),
        "web_extract".to_string(),
    ]
}

impl AppSnapshot {
    pub fn with_profile_defaults(mut self) -> Self {
        self.ensure_provider_profiles();
        self.normalize_agent_branding();
        self
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
        assert_eq!(snapshot.runs[0].messages[0].content, "Planner: done");
        assert_eq!(snapshot.runs[0].events[0].title, "Planner responded");
        assert_eq!(snapshot.runs[0].events[0].body, "Planner finished");
        assert_eq!(snapshot.runs[0].final_answer, "Synthesizer: final");
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

        snapshot.sanitize_api_keys();

        assert!(snapshot.provider.api_key.is_empty());
        assert_eq!(snapshot.provider_profiles[0].config.api_key, "kept");
        assert!(snapshot.provider_profiles[1].config.api_key.is_empty());
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
