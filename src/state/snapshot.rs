//! [`AppSnapshot`] — the single serializable source of truth for the whole app
//! (provider, profiles, agents, skills, workflows, jobs, runs). Its `impl` holds
//! the normalization and profile-management logic that keeps a loaded snapshot
//! valid across upgrades and reloads. Persisted to IndexedDB by `crate::storage`.

use serde::{Deserialize, Serialize};

use super::AppResult;
use super::agent_memory::AgentMemory;
use super::compiled_function::{CompiledFunction, default_compiled_function};
use super::event::{AgentEventKind, event, now_iso};
use super::files::FileMeta;
use super::instance::InstanceCollection;
use super::manifest::{
    Agent, RefError, Skill, default_agents, default_skills, default_soul_prompt, parse_tools,
    validate_agent_refs,
};
use super::mcp::{
    McpServerConfig, McpServerKind, default_process_definition, default_shellized_definition,
};
use super::provider::{
    ModelProfile, ProviderConfig, ProviderProfile, default_context_window, default_max_tokens,
    default_model_profiles,
};
use super::run::{
    AgentRun, JobRecord, OrchestratorConfig, RunStatus, default_max_parallelism,
    default_no_progress_turn_limit, default_orchestrator_workflow_id, default_run_step_budget,
    default_verification_retry_budget,
};
use super::schedule::ScheduleEntry;
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
    pub mcp_servers: Vec<McpServerConfig>,
    /// User-defined compiled functions, hosted together in the stateful tool-host
    /// worker at run start (see `state::compiled_function`).
    #[serde(default)]
    pub compiled_functions: Vec<CompiledFunction>,
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
    /// Rolling per-agent summaries (continuity across invocations).
    #[serde(default)]
    pub agent_memories: Vec<AgentMemory>,
    /// Scheduled reminders and briefing triggers. Fired by the in-tab scheduler.
    #[serde(default)]
    pub schedules: Vec<ScheduleEntry>,
    pub runs: Vec<AgentRun>,
    /// Legacy on-disk view of the single live run. Retained for serde back-compat:
    /// older IndexedDB snapshots persisted `current_run`, and a single live run
    /// still round-trips through it. It is NOT read directly — every access goes
    /// through the [`AppSnapshot::current_run`] / [`AppSnapshot::set_current_run`]
    /// accessors, which keep it in lockstep with the authoritative [`instances`]
    /// collection. Hydrated into `instances` at load time by
    /// [`AppSnapshot::with_profile_defaults`].
    ///
    /// `pub(crate)` only so in-crate `..AppSnapshot::default()` struct-update
    /// literals (mostly test fixtures) still compile; it is not part of the public
    /// API and must not be read or written directly — go through the accessors.
    #[serde(rename = "current_run", default)]
    pub(crate) current_run_wire: Option<AgentRun>,
    /// On-disk view of the WHOLE instance fleet: each instance's projected run, in
    /// chronological order. This is the multi-instance schema — a save flattens the
    /// [`instances`](Self::instances) collection here (see
    /// [`AppSnapshot::sync_instances_wire`]), and a load rebuilds the collection from
    /// it (see [`AppSnapshot::hydrate_instances`]). Only the projections persist; the
    /// per-instance reducer/control are runtime-only and rebuilt on load.
    ///
    /// Back-compat: older IndexedDB snapshots predate this field, so it is
    /// `#[serde(default)]` (an absent array deserializes to empty). When it is empty,
    /// `hydrate_instances` falls back to the single legacy `current_run` — so a legacy
    /// snapshot loads into a one-element collection, and a multi-instance snapshot
    /// round-trips the full fleet.
    ///
    /// `pub(crate)` for the same struct-update reason as `current_run_wire`; not part
    /// of the public API — go through the accessors / collection.
    #[serde(rename = "instances", default)]
    pub(crate) instances_wire: Vec<AgentRun>,
    /// The authoritative, addressable set of engine instances. The active
    /// instance's projection stands in for the legacy `current_run`. Runtime-only:
    /// rebuilt from `instances_wire` (or the legacy `current_run_wire`/`runs`) on
    /// load, so the collection itself never rides the wire — only its projected runs
    /// do, through `instances_wire`. `pub(crate)` for the same struct-update reason
    /// as `current_run_wire`.
    #[serde(skip)]
    pub(crate) instances: InstanceCollection,
    pub status: String,
    /// Monotonic write version — the StateWriter actor's consistency guard
    /// (rejects a stale apply whose base version is behind the live snapshot).
    #[serde(default)]
    pub version: u64,
    /// Durable hints about workspace files in OPFS. The bytes live off-hub; only
    /// these descriptors ride on the snapshot. See [`FileMeta`].
    #[serde(default)]
    pub files: Vec<FileMeta>,
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
            mcp_servers: vec![McpServerConfig::new_workspace()],
            compiled_functions: Vec::new(),
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
            agent_memories: Vec::new(),
            schedules: Vec::new(),
            runs: Vec::new(),
            current_run_wire: None,
            instances_wire: Vec::new(),
            instances: InstanceCollection::new(),
            status: "Ready".to_string(),
            version: 0,
            files: Vec::new(),
        }
    }
}

impl AppSnapshot {
    pub fn with_profile_defaults(mut self) -> Self {
        // Rebuild the runtime instance collection from the legacy wire field FIRST,
        // so every normalizer below (and `recover_interrupted_run_after_reload`)
        // operates through the active-run accessors on a hydrated collection.
        self.hydrate_instances();
        self.ensure_provider_profiles();
        self.ensure_model_profiles();
        self.ensure_workflow_defaults();
        self.ensure_orchestrator_defaults();
        self.ensure_workspace_mcp_server();
        self.recover_interrupted_run_after_reload();
        self.ensure_prompt_defaults();
        self.normalize_agent_branding();
        self.normalize_agent_tools();
        self.report_agent_ref_problems();
        // The effective `provider` config carries the active generation preset's
        // tuning; re-apply it so a freshly loaded snapshot is internally consistent.
        if let Some(id) = self.active_model_profile_id.clone() {
            let _ = self.apply_model_profile(&id);
        }
        self
    }

    // === Active-run accessors ===
    // `current_run` is no longer a field: the authoritative state is the keyed
    // `instances` collection, whose *active* instance (most-recent live, else last)
    // stands in for the old single run. These three accessors preserve every read
    // site verbatim while keeping the legacy `current_run_wire` serde field in
    // lockstep so the on-disk format and a single-run round-trip are unchanged.

    /// The active instance's run — the old `snapshot.current_run.as_ref()`.
    pub fn current_run(&self) -> Option<&AgentRun> {
        self.instances.active_run()
    }

    /// The active instance's run, mutable — the old `snapshot.current_run.as_mut()`.
    /// Returns a handle straight into the authoritative projection, so an in-place
    /// edit (including a status flip) is immediately visible through
    /// [`Self::current_run`]. The legacy `current_run_wire` mirror is re-flattened
    /// from the projection at save time by [`Self::checkpoint_current_run`] /
    /// [`Self::sync_current_run_wire`]; it is deliberately NOT eagerly cloned here,
    /// since the returned `&mut` would leave any pre-mutation clone stale anyway and
    /// the wire is only consulted on serialize.
    pub fn current_run_mut(&mut self) -> Option<&mut AgentRun> {
        self.instances.active_run_mut()
    }

    /// Set (or clear) the active run — the old `snapshot.current_run = Some(run)` /
    /// `= None`. `Some(run)` upserts the instance by id (seeding/refreshing its
    /// projection); `None` drops the active instance. The legacy wire field is kept
    /// in lockstep so a save serializes the same `current_run` as before.
    pub fn set_current_run(&mut self, run: Option<AgentRun>) {
        match run {
            Some(run) => {
                self.current_run_wire = Some(run.clone());
                self.instances.upsert_run(run);
            }
            None => {
                self.current_run_wire = None;
                self.instances.clear_active();
            }
        }
    }

    /// The addressable engine-instance collection (read-only). The fleet units
    /// build on this; today it holds the single active run, so it has no in-crate
    /// reader yet.
    #[allow(dead_code)]
    pub fn instances(&self) -> &InstanceCollection {
        &self.instances
    }

    /// Wipe the entire run history — every engine instance and the `runs` list —
    /// and clear the legacy wire field. The seam for "new chat" / "clear chat",
    /// which reset the whole chat surface (the old `runs.clear()` +
    /// `current_run = None`).
    pub fn clear_all_runs(&mut self) {
        self.runs.clear();
        self.instances.clear();
        self.current_run_wire = None;
        self.instances_wire.clear();
    }

    /// Hydrate the runtime `instances` collection from the wire fields after a load.
    ///
    /// Prefers the multi-instance schema: every run in `instances_wire` is upserted
    /// (preserving chronological order). When that array is empty — an older snapshot
    /// that predates the fleet schema — it falls back to seeding the single active
    /// instance from the legacy `current_run_wire`. Either way, the legacy
    /// `current_run` keeps the active run alive across the migration, so a
    /// single-`current_run` snapshot loads into a one-element collection and a
    /// multi-instance snapshot rebuilds the whole fleet.
    ///
    /// Idempotent: upsert-by-id means a re-hydrate refreshes projections rather than
    /// duplicating instances. Called by [`Self::with_profile_defaults`].
    fn hydrate_instances(&mut self) {
        if !self.instances_wire.is_empty() {
            for run in self.instances_wire.clone() {
                self.instances.upsert_run(run);
            }
            return;
        }
        if let Some(run) = self.current_run_wire.clone() {
            self.instances.upsert_run(run);
        }
    }

    /// Re-flatten the active instance's projection back into the legacy
    /// `current_run_wire` field so a serialize emits the same `current_run` the old
    /// schema did. The save path's normalizers (and `checkpoint_current_run`) run
    /// this before persisting.
    fn sync_current_run_wire(&mut self) {
        self.current_run_wire = self.instances.active_run().cloned();
    }

    /// Re-flatten the WHOLE instance collection into `instances_wire` so a serialize
    /// emits the full fleet (the multi-instance schema). Paired with
    /// [`Self::sync_current_run_wire`]: the active run still rides on `current_run`
    /// for back-compat, while every instance (active or not) rides on `instances`.
    /// The save path runs this before persisting (via [`Self::checkpoint_current_run`]).
    fn sync_instances_wire(&mut self) {
        self.instances_wire = self.instances.projections();
    }

    /// Validate every loaded agent's frontmatter references (tools, strategy,
    /// workflow, sub-agents) against the rest of this snapshot, collecting all
    /// problems. Returns one [`RefError`] per problem, across all agents. Pure —
    /// it reads, never mutates. The load path surfaces these via
    /// [`Self::report_agent_ref_problems`]; a bad reference is reported, never a
    /// hard crash, so a fleet degrades gracefully but loudly.
    pub fn agent_ref_problems(&self) -> Vec<RefError> {
        self.agents
            .iter()
            .filter_map(|agent| validate_agent_refs(agent, self).err())
            .flatten()
            .collect()
    }

    /// Fold any agent reference problems into the snapshot `status` string so a
    /// malformed `agents/*.md` is surfaced loudly at load instead of being silently
    /// dropped (or trapping the app mid-fleet). No-op when every reference resolves.
    ///
    /// Runs after `recover_interrupted_run_after_reload`, which may have set a
    /// meaningful status (e.g. "Recovered a paused run …"); that message is
    /// preserved and the ref-problem summary is appended, so neither signal hides
    /// the other. Only a default/blank status is replaced outright.
    pub fn report_agent_ref_problems(&mut self) {
        let problems = self.agent_ref_problems();
        if problems.is_empty() {
            return;
        }
        let detail = problems
            .iter()
            .map(RefError::to_string)
            .collect::<Vec<_>>()
            .join("; ");
        let summary = format!(
            "Loaded with {} agent reference problem(s): {detail}",
            problems.len(),
        );
        let existing = self.status.trim();
        self.status = if existing.is_empty() || existing == "Ready" {
            summary
        } else {
            format!("{existing} {summary}")
        };
    }

    /// Return this snapshot with `agent` enabled and moved to the front of the agent
    /// list (de-duplicated by id), so a dispatched or inline run operates as that
    /// agent. Returns a new value; the receiver is consumed.
    pub fn with_active_agent(mut self, mut agent: Agent) -> Self {
        agent.enabled = true;
        self.agents.retain(|existing| existing.id != agent.id);
        self.agents.insert(0, agent);
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
        // Seed a blank soul, and migrate the obsolete bundled soul: older snapshots
        // persisted the previous default, which was titled "# Shared Agent Soul". That
        // header was retired in favour of the persona-driven soul, so any stored soul
        // still carrying it is an un-edited old default and is replaced with the
        // current one. A user-authored soul never contains that header, so edits are
        // preserved.
        if self.soul.trim().is_empty() || self.soul.contains("# Shared Agent Soul") {
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
        if let Some(run) = self.current_run_mut() {
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
        // Flatten the active instance back into the legacy wire field so a save
        // (the only caller path) serializes the same `current_run` as before, AND
        // flatten the whole collection into `instances_wire` so the full fleet
        // persists under the multi-instance schema.
        self.sync_current_run_wire();
        self.sync_instances_wire();
        if let Some(run) = self.current_run().cloned() {
            self.upsert_job_from_run(&run, run.status);
        }
    }

    pub fn is_stale_checkpoint_for(&self, existing: &AppSnapshot) -> bool {
        let Some(incoming) = self.current_run() else {
            return false;
        };
        let Some(current) = existing.current_run() else {
            return false;
        };
        let incoming_is_live_checkpoint =
            self.status.starts_with("Running ") || !incoming.status.is_terminal();
        incoming.id == current.id && current.status.is_terminal() && incoming_is_live_checkpoint
    }

    /// Flip every `Running` instance in the fleet to `Paused` (resumable) after a
    /// reload, recording an interrupt event and a resumable job per run. The browser
    /// can't have live runs the moment it reloads, so any persisted `Running` status
    /// is a stale in-flight checkpoint; each one stays addressable in the collection,
    /// resumable by id. A terminal or already-paused instance is left untouched.
    ///
    /// Generalizes the single-run recovery: the active run was the only one that
    /// could be `Running` under the legacy schema, so a single-run snapshot behaves
    /// exactly as before, while a multi-instance fleet pauses every interrupted run.
    pub fn recover_interrupted_run_after_reload(&mut self) {
        // Collect the paused projections so the job upserts (which borrow `self`
        // mutably) run after the in-place collection mutation finishes.
        let mut recovered = Vec::new();
        for instance in self.instances.iter_mut() {
            if instance.projection.status != RunStatus::Running {
                continue;
            }
            let run = &mut instance.projection;
            run.status = RunStatus::Paused;
            run.scratchpad.interrupted = true;
            run.events.push(event(
                &run.id,
                None,
                AgentEventKind::Interrupted,
                "Run paused after reload",
                "The browser reloaded while this run was active. The checkpoint is resumable.",
            ));
            instance.status = RunStatus::Paused;
            recovered.push(instance.projection.clone());
        }

        if recovered.is_empty() {
            return;
        }

        self.status = if recovered.len() == 1 {
            "Recovered a paused run from IndexedDB.".to_string()
        } else {
            format!("Recovered {} paused runs from IndexedDB.", recovered.len())
        };
        for run in &recovered {
            self.upsert_job_from_run(run, RunStatus::Paused);
        }
        // Keep the legacy wire fields in lockstep with the now-paused collection so a
        // re-serialize (or a stale-checkpoint comparison) reflects the recovery.
        self.sync_current_run_wire();
        self.sync_instances_wire();
    }

    pub fn upsert_job_from_run(&mut self, run: &AgentRun, status: RunStatus) {
        let now = now_iso();
        let progress = run
            .events
            .last()
            .map(|event| event.title.clone())
            .unwrap_or_else(|| run.status.to_string());
        if let Some(job) = self.jobs.iter_mut().find(|job| job.id == run.id) {
            job.status = status;
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
            status,
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
        if !self.tool_config.google.persist_tokens {
            self.tool_config.google.access_token.clear();
        }
        if !self.tool_config.telegram.persist_token {
            self.tool_config.telegram.bot_token.clear();
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

    // MCP-server helpers, driven by the MCP dashboard (`components/mcp_page.rs`).
    /// Make sure the built-in workspace MCP server exists (snapshots persisted
    /// before it shipped won't have it). Inserted first so it lists ahead of
    /// user-added servers. Returns `true` when the snapshot changed. Idempotent;
    /// a user who doesn't want its tools disables it (the flag persists) rather
    /// than removing it.
    pub fn ensure_workspace_mcp_server(&mut self) -> bool {
        let present = self
            .mcp_servers
            .iter()
            .any(|server| server.kind == McpServerKind::Workspace);
        if present {
            return false;
        }
        self.mcp_servers.insert(0, McpServerConfig::new_workspace());
        true
    }

    /// Add a fresh, enabled browser-kind MCP server (a pre-written JS module) from
    /// defaults.
    pub fn add_mcp_server(&mut self) -> String {
        let server = McpServerConfig::new("New MCP server", "/assets/mcp_reference_server.js");
        let name = server.name.clone();
        self.mcp_servers.push(server);
        format!("Added MCP server: {name}")
    }

    /// Add a fresh, enabled shellized MCP server seeded with the default tool-definition
    /// template, ready to edit. The runtime wraps the definition in the generic shell
    /// worker at run start.
    pub fn add_shellized_mcp_server(&mut self) -> String {
        let server =
            McpServerConfig::new_shellized("New shellized server", default_shellized_definition());
        let name = server.name.clone();
        self.mcp_servers.push(server);
        format!("Added shellized MCP server: {name}")
    }

    /// Add a fresh, enabled process MCP server seeded with the default
    /// `npx chrome-devtools-mcp@latest` spec, ready to edit. A local bridge spawns the
    /// process and relays MCP JSON-RPC over its stdio at run start.
    pub fn add_process_mcp_server(&mut self) -> String {
        let mut server = McpServerConfig::new_process(
            "New process server",
            "npx",
            vec!["chrome-devtools-mcp@latest".into()],
        );
        // Seed the editor with the pretty, ready-to-edit spec (the compact form
        // `new_process` produces parses identically), matching the shellized server's
        // editing experience.
        server.definition = default_process_definition();
        let name = server.name.clone();
        self.mcp_servers.push(server);
        format!("Added process MCP server: {name}")
    }

    /// Remove an MCP server by id. Zero MCP servers is valid, so no minimum is
    /// enforced (unlike connections).
    pub fn remove_mcp_server(&mut self, id: &str) -> String {
        let Some(index) = self.mcp_servers.iter().position(|server| server.id == id) else {
            return format!("No MCP server found with id {id}");
        };
        let removed = self.mcp_servers.remove(index);
        format!("Removed MCP server: {}", removed.name)
    }

    /// Enable or disable an MCP server by id.
    pub fn toggle_mcp_server(&mut self, id: &str, enabled: bool) -> String {
        let Some(server) = self.mcp_servers.iter_mut().find(|server| server.id == id) else {
            return format!("No MCP server found with id {id}");
        };
        server.enabled = enabled;
        let verb = if enabled { "Enabled" } else { "Disabled" };
        format!("{verb} MCP server: {}", server.name)
    }

    /// Rename an MCP server by id.
    pub fn rename_mcp_server(&mut self, id: &str, name: &str) -> String {
        let Some(server) = self.mcp_servers.iter_mut().find(|server| server.id == id) else {
            return format!("No MCP server found with id {id}");
        };
        server.name = name.to_string();
        format!("Renamed MCP server: {}", server.name)
    }

    // Compiled-function helpers, driven by the MCP dashboard's tool-host section.
    /// Add a fresh, enabled compiled function seeded with the stateful-counter
    /// example, ready to edit.
    pub fn add_compiled_function(&mut self) -> String {
        let function = default_compiled_function();
        let name = function.name.clone();
        self.compiled_functions.push(function);
        format!("Added compiled function: {name}")
    }

    /// Remove a compiled function by id. Zero functions is valid (the tool host is
    /// simply not brought up).
    pub fn remove_compiled_function(&mut self, id: &str) -> String {
        let Some(index) = self
            .compiled_functions
            .iter()
            .position(|function| function.id == id)
        else {
            return format!("No compiled function found with id {id}");
        };
        let removed = self.compiled_functions.remove(index);
        format!("Removed compiled function: {}", removed.name)
    }

    /// Enable or disable a compiled function by id.
    pub fn toggle_compiled_function(&mut self, id: &str, enabled: bool) -> String {
        let Some(function) = self
            .compiled_functions
            .iter_mut()
            .find(|function| function.id == id)
        else {
            return format!("No compiled function found with id {id}");
        };
        function.enabled = enabled;
        let verb = if enabled { "Enabled" } else { "Disabled" };
        format!("{verb} compiled function: {}", function.name)
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

#[cfg(test)]
#[path = "snapshot_tests.rs"]
mod tests;
