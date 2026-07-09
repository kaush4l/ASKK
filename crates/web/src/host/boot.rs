//! Session bootstrap + the `HarnessHandle` facade — the ADR-013 edge. The UI
//! calls this module only; everything it passes or receives is an askk-core
//! type or a plain struct defined here. Config is baked in via `include_str!`
//! of `agents/` (data, not code).

use std::cell::RefCell;
use std::rc::Rc;

use askk_core::{fold, ActionId, ActionPolicy, Budgets, RunId, RunProjection, Signal, SignalKind};
use askk_runtime::config::{AgentConfig, SkillConfig};
use askk_runtime::run::{ProviderResolver, RunHost, RunSession, SessionInit};
use askk_runtime::state::{KvStore, MemoryStore, SessionStore, SignalLog, DEFAULT_MAX_ENTRIES};
use askk_runtime::tools::{register_builtins, register_web_search, ToolRegistry};
use serde_json::Value;

#[cfg(any(target_arch = "wasm32", test))]
use super::profile::profile_from_json;
use super::profile::profile_to_json;
pub use super::profile::{AgentCard, NamedProfile, ProfileSet, ProviderProfileForm};

#[cfg(not(target_arch = "wasm32"))]
pub use askk_runtime::testutil::block_on;

/// The single provider id agents reference (`provider: default`); which
/// saved profile it points at is the profile set's `active` pick.
const PROFILE_ID: &str = "default";
/// Pref key holding the active profile's name.
const ACTIVE_PROFILE_PREF: &str = "active_profile";

/// The one facade the UI talks to.
pub struct HarnessHandle {
    session: RunSession,
    host: Rc<dyn RunHost>,
    /// Live signal buffer fed by the host sink — the fold source for a run
    /// that is mid-drive (and therefore out of the session's run map).
    buffer: Rc<RefCell<Vec<Signal>>>,
    cards: Vec<AgentCard>,
    profiles: Rc<RefCell<ProfileSet>>,
    settings: SessionStore,
    current: RefCell<Option<RunId>>,
    /// Submission order — the Agents forest lists these (plus any delegate
    /// runs observed in the live buffer) newest-first.
    known_runs: RefCell<Vec<RunId>>,
    /// Set when boot fell back to in-memory stores (broken OPFS grant).
    storage_warning: Option<String>,
}

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

    async fn persist_active(&self) -> Result<(), String> {
        let active = self.profiles.borrow().active.clone();
        self.settings
            .set_pref(ACTIVE_PROFILE_PREF, Value::from(active))
            .await
            .map_err(|e| e.to_string())
    }
}

#[allow(clippy::too_many_arguments)] // ponytail: one private assembly seam
fn build_handle(
    agents: Vec<AgentConfig>,
    skills: Vec<SkillConfig>,
    soul: String,
    registry: ToolRegistry,
    resolver: ProviderResolver,
    log: SignalLog,
    kv: Rc<dyn KvStore>,
    host: Rc<dyn RunHost>,
    buffer: Rc<RefCell<Vec<Signal>>>,
    profiles: Rc<RefCell<ProfileSet>>,
) -> Result<HarnessHandle, String> {
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
        buffer,
        cards,
        profiles,
        settings: SessionStore::new(kv),
        current: RefCell::new(None),
        known_runs: RefCell::new(Vec::new()),
        storage_warning: None,
    })
}

/// OPFS stores, verified writable end to end (some contexts — incognito,
/// embedded webviews — grant OPFS but fail `createWritable` with quota
/// errors at ~KB scale). The probe writes real payloads through both seams
/// so a broken grant is caught at boot, not mid-run.
#[cfg(target_arch = "wasm32")]
async fn opfs_stores() -> Result<(Rc<dyn KvStore>, Rc<dyn askk_runtime::state::BlobStore>), String>
{
    use super::opfs::{OpfsBlob, OpfsKv};
    use askk_runtime::state::BlobStore;

    let kv: Rc<dyn KvStore> = Rc::new(OpfsKv::new().await.map_err(|e| e.to_string())?);
    let blobs: Rc<dyn BlobStore> = Rc::new(OpfsBlob::new().await.map_err(|e| e.to_string())?);
    kv.set("probe/kv", Value::from("ok"))
        .await
        .map_err(|e| e.to_string())?;
    kv.remove("probe/kv").await.map_err(|e| e.to_string())?;
    // ponytail: 64 KiB ≈ one busy run's log segment; the REWRITE of the same
    // path matters — broken grants pass a single write and fail the second.
    for _ in 0..2 {
        blobs
            .write("probe.bin", &vec![0u8; 64 * 1024])
            .await
            .map_err(|e| e.to_string())?;
    }
    blobs.remove("probe.bin").await.map_err(|e| e.to_string())?;
    Ok((kv, blobs))
}

/// Browser bootstrap: OPFS stores (in-memory fallback when the browser's
/// storage grant is broken), fetch transport, `Date.now` clock, provider
/// resolved from the persisted profile via the inference registry.
#[cfg(target_arch = "wasm32")]
pub async fn session(notify: Box<dyn Fn()>) -> Result<HarnessHandle, String> {
    use super::browser::BrowserHost;
    use super::fetch::FetchTransport;
    use askk_inference::{ProviderProfile, ProviderRegistry, Transport};
    use askk_runtime::state::{BlobStore, MemBlob, MemKv};

    let (kv, blobs, storage_warning): (Rc<dyn KvStore>, Rc<dyn BlobStore>, Option<String>) =
        match opfs_stores().await {
            Ok((kv, blobs)) => (kv, blobs, None),
            Err(e) => (
                Rc::new(MemKv::new()),
                Rc::new(MemBlob::new()),
                Some(format!(
                    "browser storage unavailable ({e}); running in-memory — profiles and \
                     history will not survive a reload"
                )),
            ),
        };
    let (log, _replayed) = SignalLog::open(blobs, Box::new(|| js_sys::Date::now() as u64))
        .await
        .map_err(|e| e.to_string())?;

    let settings = SessionStore::new(kv.clone());
    let mut set = ProfileSet::default();
    for name in settings
        .provider_profile_ids()
        .await
        .map_err(|e| e.to_string())?
    {
        if let Some(stored) = settings
            .provider_profile(&name)
            .await
            .map_err(|e| e.to_string())?
        {
            set.profiles.push(NamedProfile {
                name,
                form: profile_from_json(&stored),
            });
        }
    }
    set.active = settings
        .pref(ACTIVE_PROFILE_PREF)
        .await
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(String::from))
        .filter(|name| set.get(name).is_some())
        .or_else(|| set.profiles.first().map(|p| p.name.clone()))
        .unwrap_or_default();
    let profiles = Rc::new(RefCell::new(set));

    let transport: Rc<dyn Transport> = Rc::new(FetchTransport::new());
    let mut registry = ToolRegistry::new();
    register_builtins(&mut registry, || js_sys::Date::now() as u64).map_err(|e| e.to_string())?;
    register_web_search(&mut registry, transport.clone()).map_err(|e| e.to_string())?;
    askk_runtime::tools::register_shell(&mut registry, Rc::new(super::vm::SerialShell::new()))
        .map_err(|e| e.to_string())?;

    // The resolver reads the live profile-set cell per run: a settings save
    // or an active-profile switch is effective on the next run, no rebuild.
    let resolver_profiles = profiles.clone();
    let resolver: ProviderResolver = Box::new(move |profile_id| {
        let form = resolver_profiles.borrow().active_form();
        let mut providers = ProviderRegistry::new(transport.clone());
        providers.add_profile(ProviderProfile {
            id: profile_id.to_string(),
            base_url: form.base_url.clone(),
            api_key: form.api_key.clone(),
            model: form.model.clone(),
            temperature: form.temperature,
            // ponytail: 2048 default caps runaway local-model generations
            // (unbounded TOON loops observed); the profile field overrides.
            max_tokens: form.max_tokens.or(Some(2048)),
        });
        providers.get(&format!("{profile_id}/{}", form.model))
    });

    let buffer: Rc<RefCell<Vec<Signal>>> = Rc::new(RefCell::new(Vec::new()));
    let host: Rc<dyn RunHost> = Rc::new(BrowserHost::new(buffer.clone(), notify));
    // fetched_config also registers any manifest-declared JS tools into the
    // registry, so it must run before the registry moves into build_handle.
    let (agents, skills, soul) = match super::config::fetched_config(&mut registry).await {
        Some(config) => config,
        None => {
            super::config::register_baked_tools(&mut registry);
            super::config::baked_config()?
        }
    };
    let mut handle = build_handle(
        agents, skills, soul, registry, resolver, log, kv, host, buffer, profiles,
    )?;
    handle.storage_warning = storage_warning;
    Ok(handle)
}

/// Host bootstrap: memory stores + a scripted `MockProvider` — the living
/// smoke session `main` drives (and tests assert on).
#[cfg(not(target_arch = "wasm32"))]
pub async fn host_session() -> Result<HarnessHandle, String> {
    use askk_core::Provider;
    use askk_inference::{MockProvider, MockTransport};
    use askk_runtime::run::TestHost;
    use askk_runtime::state::{BlobStore, MemBlob, MemKv};

    let kv: Rc<dyn KvStore> = Rc::new(MemKv::new());
    let blobs: Rc<dyn BlobStore> = Rc::new(MemBlob::new());
    let (log, _replayed) = SignalLog::open(blobs, Box::new(|| 0))
        .await
        .map_err(|e| e.to_string())?;
    let mut registry = ToolRegistry::new();
    register_builtins(&mut registry, || 7).map_err(|e| e.to_string())?;
    register_web_search(&mut registry, Rc::new(MockTransport::new())).map_err(|e| e.to_string())?;
    askk_runtime::tools::register_shell(&mut registry, Rc::new(super::vm::SerialShell::new()))
        .map_err(|e| e.to_string())?;
    super::config::register_baked_tools(&mut registry);

    let mock = Rc::new(MockProvider::new("default/mock"));
    mock.push_text("action: tool\nanswer: {\"name\": \"echo\", \"arguments\": {\"text\": \"hello from the harness\"}}");
    mock.push_text("action: answer\nanswer: echo returned: hello from the harness");
    let provider: Rc<dyn Provider> = mock;
    let resolver: ProviderResolver = Box::new(move |_| Ok(provider.clone()));

    let buffer: Rc<RefCell<Vec<Signal>>> = Rc::new(RefCell::new(Vec::new()));
    let host: Rc<dyn RunHost> = Rc::new(TestHost::new());
    let profiles = Rc::new(RefCell::new(ProfileSet::default()));
    let (agents, skills, soul) = super::config::baked_config()?;
    build_handle(
        agents, skills, soul, registry, resolver, log, kv, host, buffer, profiles,
    )
}

/// One entry for the UI on both targets (the host branch exists so `ui/`
/// compiles and previews without wasm; it is not launched by host `main`).
#[cfg(not(target_arch = "wasm32"))]
pub async fn session(notify: Box<dyn Fn()>) -> Result<HarnessHandle, String> {
    let _ = notify; // TestHost records signals itself
    host_session().await
}

#[cfg(all(test, not(target_arch = "wasm32")))]
#[path = "boot_tests.rs"]
mod tests;
