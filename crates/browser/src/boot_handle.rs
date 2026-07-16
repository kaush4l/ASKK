//! `HarnessHandle` methods + the assembly seam — split from `boot.rs` to
//! stay under the ADR-012 file-size cap; a `#[path]` child module keeps the
//! same privacy access as inline code (same trick as `boot_host.rs`). The
//! struct itself stays in `boot.rs` (the facade's front door).

use super::*;

impl HarnessHandle {
    pub fn agents(&self) -> Vec<AgentCard> {
        self.cards.clone()
    }

    /// Non-fatal boot degradation the UI should surface once (e.g. the
    /// in-memory storage fallback).
    pub fn storage_warning(&self) -> Option<String> {
        self.storage_warning.clone()
    }

    pub fn current_run(&self) -> Option<RunId> {
        self.current.borrow().clone()
    }

    /// Start a run; it becomes the current run `drive`/`resolve` act on.
    pub async fn submit(&self, agent_id: &str, input: &str) -> Result<RunId, String> {
        let run_id = self
            .session
            .submit(agent_id, input)
            .await
            .map_err(|e| e.to_string())?;
        *self.current.borrow_mut() = Some(run_id.clone());
        self.known_runs.borrow_mut().push(run_id.clone());
        Ok(run_id)
    }

    /// Stop the current run (GAPS item 13 closed): a parked run lands the
    /// Interrupted terminal at once; a driving run's cancel token is set and
    /// checked per loop iteration.
    pub async fn cancel(&self) {
        if let Some(run_id) = self.current_run() {
            let _ = self.session.cancel(&run_id).await;
        }
    }

    /// Cancel a SPECIFIC run by id — the Fleet surface (ADR-042) steers many
    /// parallel loops, so it cancels by id rather than only the current run.
    /// A parked run lands Interrupted at once; a driving run's cancel token
    /// trips on its next loop check.
    pub async fn cancel_run(&self, run_id: &RunId) {
        let _ = self.session.cancel(run_id).await;
    }

    /// Every run this page session has seen, newest first, each with its
    /// fold. Delegate runs never submitted through the facade surface via
    /// their signals in the live buffer.
    pub fn runs(&self) -> Vec<(RunId, RunProjection)> {
        let mut ids = self.known_runs.borrow().clone();
        for signal in self.buffer.borrow().iter() {
            if !ids.contains(&signal.run_id) {
                ids.push(signal.run_id.clone());
            }
        }
        ids.iter()
            .rev()
            .map(|id| (id.clone(), self.projection(id)))
            .collect()
    }

    /// Streamed answer text for a mid-drive run: `LlmDelta` accumulation
    /// since the last `LlmRequest`, cleared once the full response lands.
    pub fn draft(&self, run_id: &RunId) -> String {
        let mut out = String::new();
        for signal in self.buffer.borrow().iter().filter(|s| &s.run_id == run_id) {
            match &signal.kind {
                SignalKind::LlmRequest | SignalKind::LlmResponse { .. } => out.clear(),
                SignalKind::LlmDelta { text } => out.push_str(text),
                _ => {}
            }
        }
        out
    }

    /// The most recent loop activity for the avatar/draft phase label.
    pub fn latest_activity(&self, run_id: &RunId) -> Option<SignalKind> {
        self.buffer
            .borrow()
            .iter()
            .rev()
            .filter(|s| &s.run_id == run_id)
            .find(|s| {
                matches!(
                    s.kind,
                    SignalKind::LlmRequest
                        | SignalKind::ParseOutcome { .. }
                        | SignalKind::ToolRequested { .. }
                        | SignalKind::ToolCompleted { .. }
                )
            })
            .map(|s| s.kind.clone())
    }

    /// Clear the chat history (ADR-046): drop the durable archive and forget
    /// every TERMINAL run — live runs survive with their signals, so a clear
    /// mid-run never blanks the answer still being written (their pre-clear
    /// signals do leave the archive; they persist again as the run appends).
    /// The live view clears even when the store refuses part of the archive —
    /// the error is returned so the UI can say the reload may bring some back.
    /// ponytail: a live run that never appends again (parked, then reloaded)
    /// leaves no trace at all — it is not there to fence. Accepted: the user
    /// asked for the history to go.
    pub async fn clear_history(&self) -> Result<(), String> {
        let alive: Vec<RunId> = self
            .runs()
            .into_iter()
            .filter(|(_, proj)| !proj.status.is_terminal())
            .map(|(id, _)| id)
            .collect();
        let cleared = self.session.clear_history().await;
        self.buffer
            .borrow_mut()
            .retain(|s| alive.contains(&s.run_id));
        self.known_runs.borrow_mut().retain(|id| alive.contains(id));
        if !self.current_run().is_some_and(|id| alive.contains(&id)) {
            *self.current.borrow_mut() = None;
        }
        cleared.map_err(|e| e.to_string())
    }

    /// UI preference (stage/theme/rails), persisted in the session store.
    pub async fn get_pref(&self, name: &str) -> Option<Value> {
        self.settings.pref(name).await.ok().flatten()
    }

    pub async fn set_pref(&self, name: &str, value: Value) {
        let _ = self.settings.set_pref(name, value).await;
    }

    /// Drive a SPECIFIC run to a terminal or confirmation pause. Parallel
    /// submits each spawn their own drive, so several runs progress
    /// concurrently (ADR-015; the signal log serializes their appends). The
    /// outcome is not returned — the projection is the UI's truth.
    pub async fn drive_run(&self, run_id: &RunId) {
        let _ = self.session.drive(run_id, self.host.clone()).await;
    }

    /// Drive the current run (host smoke + tests; the wasm UI drives per-run).
    #[cfg_attr(target_arch = "wasm32", allow(dead_code))]
    pub async fn drive(&self) {
        if let Some(run_id) = self.current_run() {
            self.drive_run(&run_id).await;
        }
    }

    /// Resolve a parked confirmation on the current run.
    pub async fn resolve(&self, action_id: &str, approve: bool) {
        let Some(run_id) = self.current_run() else {
            return;
        };
        let _ = self
            .session
            .resolve_action(
                &run_id,
                &ActionId(action_id.to_string()),
                approve,
                self.host.clone(),
            )
            .await;
    }

    /// Raw stamped signals of one run, in arrival order (clone of the live
    /// buffer slice — replayed prior-epoch signals were seeded there at boot,
    /// live ones arrive via the host sink, mirroring `draft`).
    pub fn signals(&self, run_id: &RunId) -> Vec<Signal> {
        self.buffer
            .borrow()
            .iter()
            .filter(|s| &s.run_id == run_id)
            .cloned()
            .collect()
    }

    /// Snapshot of the signal log's health probe (epoch/quarantined fixed at
    /// open; degraded reads the log's live cell).
    pub fn log_health(&self) -> LogHealth {
        LogHealth {
            epoch: self.health.epoch(),
            degraded: self.health.degraded(),
            quarantined: self.health.quarantined(),
        }
    }

    /// Fold of the run's signals. Parked/terminal runs come from the session
    /// (complete stream); a run mid-drive folds from the live buffer.
    pub fn projection(&self, run_id: &RunId) -> RunProjection {
        self.session.projection(run_id).unwrap_or_else(|| {
            let buffer = self.buffer.borrow();
            fold(buffer.iter().filter(|s| &s.run_id == run_id))
        })
    }

    pub fn get_profiles(&self) -> ProfileSet {
        self.profiles.borrow().clone()
    }

    /// Save (insert or replace) a named profile and make it active. The
    /// resolver reads the shared cell per run, so the next run uses it.
    pub async fn save_profile(&self, name: &str, form: ProviderProfileForm) -> Result<(), String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("profile name must not be empty".into());
        }
        self.settings
            .set_provider_profile(name, profile_to_json(&form))
            .await
            .map_err(|e| e.to_string())?;
        self.profiles.borrow_mut().upsert(name, form);
        self.persist_active().await
    }

    /// Route runs at a saved profile.
    pub async fn activate_profile(&self, name: &str) -> Result<(), String> {
        if self.profiles.borrow().get(name).is_none() {
            return Err(format!("unknown profile '{name}'"));
        }
        self.profiles.borrow_mut().active = name.to_string();
        self.persist_active().await
    }

    /// Delete a saved profile; an active deletion falls to the first left.
    pub async fn delete_profile(&self, name: &str) -> Result<(), String> {
        self.settings
            .remove_provider_profile(name)
            .await
            .map_err(|e| e.to_string())?;
        self.profiles.borrow_mut().remove(name);
        self.persist_active().await
    }

    /// Current SearXNG instance base URL ("" = disabled, fallback chain only).
    pub fn searxng_url(&self) -> String {
        self.searxng.borrow().clone()
    }

    /// Point `web_search` at a SearXNG instance (live cell — next call uses
    /// it) and persist the choice. Empty disables SearXNG.
    pub async fn set_searxng_url(&self, url: &str) {
        let url = url.trim().to_string();
        *self.searxng.borrow_mut() = url.clone();
        self.set_pref(SEARXNG_PREF, Value::from(url)).await;
    }

    /// Raw MCP server config text (JSON array or legacy URL lines, "" = none).
    pub fn mcp_servers(&self) -> String {
        self.mcp_servers.borrow().clone()
    }

    /// Persist the MCP server config; tools (re)register on the next reload.
    pub async fn set_mcp_servers(&self, text: &str) {
        *self.mcp_servers.borrow_mut() = text.to_string();
        self.set_pref(MCP_PREF, Value::from(text)).await;
    }

    /// Per-server MCP registration outcomes from this boot (read-only; a
    /// config edit takes effect — and re-statuses — on the next reload).
    pub fn mcp_status(&self) -> Vec<McpServerStatus> {
        self.mcp_status.clone()
    }

    async fn persist_active(&self) -> Result<(), String> {
        let active = self.profiles.borrow().active.clone();
        self.settings
            .set_pref(ACTIVE_PROFILE_PREF, Value::from(active))
            .await
            .map_err(|e| e.to_string())
    }
}

#[allow(clippy::too_many_arguments)] // ponytail: one private assembly seam
pub(super) fn build_handle(
    agents: Vec<AgentConfig>,
    teams: Vec<askk_engine::config::TeamConfig>,
    skills: Vec<SkillConfig>,
    soul: String,
    registry: ToolRegistry,
    resolver: ProviderResolver,
    log: SignalLog,
    kv: Rc<dyn KvStore>,
    blobs: Rc<dyn askk_engine::state::BlobStore>,
    host: Rc<dyn RunHost>,
    buffer: Rc<RefCell<Vec<Signal>>>,
    replayed: Vec<Signal>,
    profiles: Rc<RefCell<ProfileSet>>,
    searxng: Rc<RefCell<String>>,
) -> Result<HarnessHandle, String> {
    // Resume (GAPS A5, ADR-044): seed every replayed durable signal into the
    // live buffer so prior-epoch runs fold like any other, and list their ids
    // (first-seen order) in known_runs BEFORE any fresh submit — `runs()`
    // reverses, so fresh submissions sort ABOVE them (newest-first). The
    // epoch fence already made every replayed run terminal; the cross-tab
    // bus tap only fires in the host sink, so seeding never rebroadcasts.
    // ponytail: seeds every prior durable signal; add segment compaction /
    // last-N-runs cap when history growth hurts (the log never compacts
    // today either).
    let mut known_runs: Vec<RunId> = Vec::new();
    for signal in &replayed {
        if !known_runs.contains(&signal.run_id) {
            known_runs.push(signal.run_id.clone());
        }
    }
    buffer.borrow_mut().extend(replayed);
    // The probe outlives the log, which moves into the session below.
    let health = log.health_probe();
    let cards = agents
        .iter()
        .filter(|a| a.enabled)
        .map(|a| AgentCard {
            id: a.id.clone(),
            name: a.name.clone(),
            description: a.description.clone(),
        })
        .collect();
    let session = RunSession::new(SessionInit {
        agents,
        teams,
        soul,
        skills,
        registry,
        resolver,
        log,
        memory: MemoryStore::new(kv.clone(), DEFAULT_MAX_ENTRIES),
        session: SessionStore::new(kv.clone()),
        budgets: Budgets::default(),
        policy: ActionPolicy::default(),
        known_providers: vec![PROFILE_ID.to_string()],
    })
    .map_err(|e| e.to_string())?;
    Ok(HarnessHandle {
        session,
        host,
        health,
        buffer,
        cards,
        profiles,
        settings: SessionStore::new(kv.clone()),
        blobs,
        current: RefCell::new(None),
        known_runs: RefCell::new(known_runs),
        storage_warning: None,
        searxng,
        mcp_servers: RefCell::new(String::new()),
        mcp_status: Vec::new(),
    })
}
