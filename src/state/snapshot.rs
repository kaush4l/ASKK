//! [`AppSnapshot`] — the single serializable source of truth for the whole app
//! (provider, profiles, agents, skills, workflows, jobs, runs). Its `impl` holds
//! the normalization and profile-management logic that keeps a loaded snapshot
//! valid across upgrades and reloads. Persisted to IndexedDB by `crate::storage`.

use serde::{Deserialize, Serialize};

use super::AppResult;
use super::event::{AgentEventKind, event, now_iso};
use super::manifest::{
    Agent, Skill, default_agents, default_skills, default_soul_prompt, parse_tools,
};
use super::provider::{
    ModelProfile, ProviderConfig, ProviderProfile, default_context_window, default_max_tokens,
    default_model_profiles,
};
use super::run::{
    AgentRun, JobRecord, OrchestratorConfig, default_max_parallelism,
    default_no_progress_turn_limit, default_orchestrator_workflow_id, default_run_step_budget,
    default_verification_retry_budget,
};
use super::tool_config::ToolConfig;
use super::workflow::{WorkflowDefinition, default_workflows};

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
        // The effective `provider` config carries the active generation preset's
        // tuning; re-apply it so a freshly loaded snapshot is internally consistent.
        if let Some(id) = self.active_model_profile_id.clone() {
            let _ = self.apply_model_profile(&id);
        }
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

    /// Mirror the current provider tuning into the active generation preset, so
    /// live edits to temperature/max-tokens/top-p/context persist into it without a
    /// separate "Update" step.
    pub fn sync_active_model_profile(&mut self) {
        let Some(id) = self.active_model_profile_id.clone() else {
            return;
        };
        let (temperature, max_tokens, top_p, context_window) = (
            self.provider.temperature,
            self.provider.max_tokens,
            self.provider.top_p,
            self.provider.context_window,
        );
        if let Some(profile) = self
            .model_profiles
            .iter_mut()
            .find(|profile| profile.id == id)
        {
            profile.temperature = temperature;
            profile.max_tokens = max_tokens;
            profile.top_p = top_p;
            profile.context_window = context_window;
        }
    }

    /// Add a fresh generation preset from defaults and make it active.
    pub fn add_model_profile(&mut self) -> String {
        let profile = ModelProfile::new(
            "New preset",
            0.2,
            default_max_tokens(),
            None,
            default_context_window(),
        );
        let id = profile.id.clone();
        self.model_profiles.push(profile);
        let _ = self.apply_model_profile(&id);
        "Added generation preset: New preset".to_string()
    }

    /// Clone the active generation preset under a new id, and make it active.
    pub fn duplicate_active_model_profile(&mut self) -> String {
        self.ensure_model_profiles();
        let Some(id) = self.active_model_profile_id.clone() else {
            return self.save_model_profile("Generation preset");
        };
        let Some(source) = self
            .model_profiles
            .iter()
            .find(|profile| profile.id == id)
            .cloned()
        else {
            return self.save_model_profile("Generation preset");
        };
        let name = format!("{} copy", source.name);
        let profile = ModelProfile::new(
            name.clone(),
            source.temperature,
            source.max_tokens,
            source.top_p,
            source.context_window,
        );
        self.active_model_profile_id = Some(profile.id.clone());
        self.model_profiles.push(profile);
        format!("Duplicated generation preset: {name}")
    }

    /// Rename the active generation preset in place.
    pub fn rename_active_model_profile(&mut self, name: &str) -> String {
        let profile_name = sanitized_profile_name(name, "Generation preset");
        let Some(id) = self.active_model_profile_id.clone() else {
            return "No active generation preset.".to_string();
        };
        if let Some(profile) = self
            .model_profiles
            .iter_mut()
            .find(|profile| profile.id == id)
        {
            profile.name = profile_name.clone();
            return format!("Renamed generation preset: {profile_name}");
        }
        "No active generation preset.".to_string()
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

    /// Make a saved connection active, copying ONLY its connection fields (base
    /// URL, model, auth, key) onto the effective provider config. Tuning is left
    /// untouched — that is owned by the active generation preset, not the connection.
    pub fn select_connection(&mut self, connection_id: &str) -> AppResult<String> {
        let Some(profile) = self
            .provider_profiles
            .iter()
            .find(|profile| profile.id == connection_id)
            .cloned()
        else {
            return Err(format!("No connection found with id {connection_id}"));
        };
        self.set_connection_fields(&profile.config);
        self.active_provider_profile_id = Some(profile.id);
        Ok(format!("Selected connection: {}", profile.name))
    }

    /// Copy the connection-only fields from `source` onto the effective provider
    /// config (used by select/delete so tuning is never disturbed).
    fn set_connection_fields(&mut self, source: &ProviderConfig) {
        self.provider.base_url = source.base_url.clone();
        self.provider.model = source.model.clone();
        self.provider.auth_mode = source.auth_mode;
        self.provider.api_key = source.api_key.clone();
        self.provider.persist_api_key = source.persist_api_key;
    }

    /// Mirror the current connection fields into the active connection profile, so
    /// live edits persist without a separate "Update" step.
    pub fn sync_active_connection(&mut self) {
        let Some(id) = self.active_provider_profile_id.clone() else {
            return;
        };
        let connection = self.provider.clone();
        if let Some(profile) = self
            .provider_profiles
            .iter_mut()
            .find(|profile| profile.id == id)
        {
            profile.config.base_url = connection.base_url;
            profile.config.model = connection.model;
            profile.config.auth_mode = connection.auth_mode;
            profile.config.api_key = connection.api_key;
            profile.config.persist_api_key = connection.persist_api_key;
        }
    }

    /// Add a fresh connection from defaults and make it active (a blank slate to
    /// configure; rename via the Name field). Distinct from duplicate, which copies.
    pub fn add_connection(&mut self) -> String {
        let config = ProviderConfig::default();
        let profile = ProviderProfile::new("New connection", config.clone());
        let id = profile.id.clone();
        self.provider_profiles.push(profile);
        self.set_connection_fields(&config);
        self.active_provider_profile_id = Some(id);
        "Added connection: New connection".to_string()
    }

    /// Clone the active connection under a new id, and make it active.
    pub fn duplicate_active_connection(&mut self) -> String {
        let Some(id) = self.active_provider_profile_id.clone() else {
            return self.save_current_provider_profile("Connection");
        };
        let Some(source) = self
            .provider_profiles
            .iter()
            .find(|profile| profile.id == id)
            .cloned()
        else {
            return self.save_current_provider_profile("Connection");
        };
        let name = format!("{} copy", source.name);
        let profile = ProviderProfile::new(name.clone(), source.config);
        self.active_provider_profile_id = Some(profile.id.clone());
        self.provider_profiles.push(profile);
        format!("Duplicated connection: {name}")
    }

    /// Rename the active connection in place.
    pub fn rename_active_connection(&mut self, name: &str) -> String {
        let profile_name = ProviderProfile::sanitized_name(name, &self.provider);
        let Some(id) = self.active_provider_profile_id.clone() else {
            return "No active connection.".to_string();
        };
        if let Some(profile) = self
            .provider_profiles
            .iter_mut()
            .find(|profile| profile.id == id)
        {
            profile.name = profile_name.clone();
            return format!("Renamed connection: {profile_name}");
        }
        "No active connection.".to_string()
    }

    pub fn save_current_provider_profile(&mut self, name: &str) -> String {
        let profile_name = ProviderProfile::sanitized_name(name, &self.provider);
        let profile = ProviderProfile::new(profile_name.clone(), self.provider.clone());
        self.active_provider_profile_id = Some(profile.id.clone());
        self.provider_profiles.push(profile);
        format!("Saved connection: {profile_name}")
    }

    pub fn delete_provider_profile(&mut self, profile_id: &str) -> String {
        if self.provider_profiles.len() <= 1 {
            return "Keep at least one connection.".to_string();
        }

        let Some(index) = self
            .provider_profiles
            .iter()
            .position(|profile| profile.id == profile_id)
        else {
            return format!("No connection found with id {profile_id}");
        };

        let removed = self.provider_profiles.remove(index);
        if self.active_provider_profile_id.as_deref() == Some(profile_id)
            && let Some(next) = self.provider_profiles.first().cloned()
        {
            self.set_connection_fields(&next.config);
            self.active_provider_profile_id = Some(next.id);
        }
        format!("Deleted connection: {}", removed.name)
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

#[cfg(test)]
mod tests {
    // Tests build a default snapshot and then assign the one field under test; that
    // reads more clearly than a full struct-update literal here.
    #![allow(clippy::field_reassign_with_default)]
    use crate::responses::ResponseFormat;
    use crate::state::*;
    use serde_json::json;

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
    fn connection_helpers_save_sync_rename_select_and_delete() {
        let mut snapshot = AppSnapshot::default();

        // New connection captured from the current effective config.
        snapshot.provider.model = "first-model".to_string();
        let save_status = snapshot.save_current_provider_profile("First");
        let first_id = snapshot.active_provider_profile_id.clone().unwrap();
        assert_eq!(save_status, "Saved connection: First");

        // Live edits mirror into the active connection (no explicit "update" step).
        snapshot.provider.model = "second-model".to_string();
        snapshot.sync_active_connection();
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

        // Rename in place.
        assert_eq!(
            snapshot.rename_active_connection("Second"),
            "Renamed connection: Second"
        );

        // Selecting another connection copies ONLY connection fields; the active
        // generation preset's tuning (temperature) must be left untouched.
        snapshot.provider.temperature = 0.9;
        let default_id = snapshot
            .provider_profiles
            .iter()
            .find(|profile| profile.id != first_id)
            .unwrap()
            .id
            .clone();
        snapshot.select_connection(&default_id).unwrap();
        assert_eq!(snapshot.provider.model, "gpt-4.1-mini");
        assert_eq!(snapshot.provider.temperature, 0.9);

        let delete_status = snapshot.delete_provider_profile(&first_id);
        assert_eq!(delete_status, "Deleted connection: Second");
        assert!(
            !snapshot
                .provider_profiles
                .iter()
                .any(|profile| profile.id == first_id)
        );
    }

    #[test]
    fn generation_preset_helpers_sync_duplicate_and_rename() {
        let mut snapshot = AppSnapshot::default();
        let active_id = snapshot.active_model_profile_id.clone().unwrap();

        // Live tuning edit mirrors into the active preset.
        snapshot.provider.temperature = 0.42;
        snapshot.provider.max_tokens = 1234;
        snapshot.sync_active_model_profile();
        let active = snapshot
            .model_profiles
            .iter()
            .find(|profile| profile.id == active_id)
            .unwrap();
        assert_eq!(active.temperature, 0.42);
        assert_eq!(active.max_tokens, 1234);

        // Duplicate creates a new, distinct active preset.
        let before = snapshot.model_profiles.len();
        snapshot.duplicate_active_model_profile();
        assert_eq!(snapshot.model_profiles.len(), before + 1);
        let new_id = snapshot.active_model_profile_id.clone().unwrap();
        assert_ne!(new_id, active_id);

        // Rename in place.
        assert_eq!(
            snapshot.rename_active_model_profile("My preset"),
            "Renamed generation preset: My preset"
        );
        assert_eq!(
            snapshot
                .model_profiles
                .iter()
                .find(|profile| profile.id == new_id)
                .unwrap()
                .name,
            "My preset"
        );
    }

    #[test]
    fn with_profile_defaults_applies_active_generation_preset_to_provider() {
        let mut snapshot = AppSnapshot::default();
        let active_id = snapshot.active_model_profile_id.clone().unwrap();
        if let Some(profile) = snapshot
            .model_profiles
            .iter_mut()
            .find(|profile| profile.id == active_id)
        {
            profile.temperature = 0.33;
            profile.max_tokens = 999;
        }
        // Effective config out of sync until normalization re-applies the preset.
        snapshot.provider.temperature = 0.0;
        snapshot.provider.max_tokens = 1;

        let snapshot = snapshot.with_profile_defaults();

        assert_eq!(snapshot.provider.temperature, 0.33);
        assert_eq!(snapshot.provider.max_tokens, 999);
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
