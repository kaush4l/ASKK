//! Session bootstrap + the `HarnessHandle` facade — the ADR-013 edge. The UI
//! calls this module only; everything it passes or receives is an askk-core
//! type or a plain struct defined here. Config is baked in via `include_str!`
//! of `agents/` (data, not code).

use std::cell::RefCell;
use std::rc::Rc;

use askk_core::{fold, ActionId, ActionPolicy, Budgets, RunId, RunProjection, Signal, SignalKind};
use askk_runtime::config::{load_soul, AgentConfig, SkillConfig};
use askk_runtime::run::{ProviderResolver, RunHost, RunSession, SessionInit};
use askk_runtime::state::{KvStore, MemoryStore, SessionStore, SignalLog, DEFAULT_MAX_ENTRIES};
use askk_runtime::tools::{register_builtins, ToolRegistry};
use serde_json::Value;

#[cfg(any(target_arch = "wasm32", test))]
use super::profile::profile_from_json;
use super::profile::profile_to_json;
pub use super::profile::{AgentCard, ProviderProfileForm};

#[cfg(not(target_arch = "wasm32"))]
pub use askk_runtime::testutil::block_on;

const SOUL_MD: &str = include_str!("../../../../agents/soul.md");
const ASSISTANT_MD: &str = include_str!("../../../../agents/assistant.md");
const CONCISE_MD: &str = include_str!("../../../../agents/skills/concise.md");

/// The single provider profile id agents reference (`provider: default`).
const PROFILE_ID: &str = "default";

/// The one facade the UI talks to.
pub struct HarnessHandle {
    session: RunSession,
    host: Rc<dyn RunHost>,
    /// Live signal buffer fed by the host sink — the fold source for a run
    /// that is mid-drive (and therefore out of the session's run map).
    buffer: Rc<RefCell<Vec<Signal>>>,
    cards: Vec<AgentCard>,
    profile: Rc<RefCell<ProviderProfileForm>>,
    settings: SessionStore,
    current: RefCell<Option<RunId>>,
    /// Submission order — the Agents forest lists these (plus any delegate
    /// runs observed in the live buffer) newest-first.
    known_runs: RefCell<Vec<RunId>>,
}

impl HarnessHandle {
    pub fn agents(&self) -> Vec<AgentCard> {
        self.cards.clone()
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

    /// Drive the current run to a terminal or a confirmation pause. The
    /// outcome is not returned — the projection is the UI's truth.
    pub async fn drive(&self) {
        let Some(run_id) = self.current_run() else {
            return;
        };
        let _ = self.session.drive(&run_id, self.host.clone()).await;
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

    pub fn get_profile(&self) -> ProviderProfileForm {
        self.profile.borrow().clone()
    }

    /// Persist the profile and make it live: the resolver reads the shared
    /// cell per run, so the next run uses the new values.
    pub async fn set_profile(&self, form: ProviderProfileForm) -> Result<(), String> {
        self.settings
            .set_provider_profile(PROFILE_ID, profile_to_json(&form))
            .await
            .map_err(|e| e.to_string())?;
        *self.profile.borrow_mut() = form;
        Ok(())
    }
}

fn baked_config() -> Result<(Vec<AgentConfig>, Vec<SkillConfig>, String), String> {
    let agents = vec![
        AgentConfig::from_markdown("agents/assistant.md", ASSISTANT_MD)
            .map_err(|e| e.to_string())?,
    ];
    let skills = vec![
        SkillConfig::from_markdown("agents/skills/concise.md", CONCISE_MD)
            .map_err(|e| e.to_string())?,
    ];
    Ok((agents, skills, load_soul(SOUL_MD)))
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
    profile: Rc<RefCell<ProviderProfileForm>>,
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
        profile,
        settings: SessionStore::new(kv),
        current: RefCell::new(None),
        known_runs: RefCell::new(Vec::new()),
    })
}

/// Browser bootstrap: OPFS stores, fetch transport, `Date.now` clock,
/// provider resolved from the persisted profile via the inference registry.
#[cfg(target_arch = "wasm32")]
pub async fn session(notify: Box<dyn Fn()>) -> Result<HarnessHandle, String> {
    use super::browser::BrowserHost;
    use super::fetch::FetchTransport;
    use super::opfs::{OpfsBlob, OpfsKv};
    use askk_inference::{ProviderProfile, ProviderRegistry, Transport};
    use askk_runtime::state::BlobStore;

    let kv: Rc<dyn KvStore> = Rc::new(OpfsKv::new().await.map_err(|e| e.to_string())?);
    let blobs: Rc<dyn BlobStore> = Rc::new(OpfsBlob::new().await.map_err(|e| e.to_string())?);
    let (log, _replayed) = SignalLog::open(blobs, Box::new(|| js_sys::Date::now() as u64))
        .await
        .map_err(|e| e.to_string())?;

    let settings = SessionStore::new(kv.clone());
    let stored = settings
        .provider_profile(PROFILE_ID)
        .await
        .map_err(|e| e.to_string())?;
    let profile = Rc::new(RefCell::new(
        stored.as_ref().map(profile_from_json).unwrap_or_default(),
    ));

    let mut registry = ToolRegistry::new();
    register_builtins(&mut registry, || js_sys::Date::now() as u64).map_err(|e| e.to_string())?;

    // The resolver reads the live profile cell per run: a settings save is
    // effective on the next run, no rebuild. Registry construction is cheap.
    let transport: Rc<dyn Transport> = Rc::new(FetchTransport::new());
    let resolver_profile = profile.clone();
    let resolver: ProviderResolver = Box::new(move |profile_id| {
        let form = resolver_profile.borrow().clone();
        let mut providers = ProviderRegistry::new(transport.clone());
        providers.add_profile(ProviderProfile {
            id: profile_id.to_string(),
            base_url: form.base_url.clone(),
            api_key: form.api_key.clone(),
            model: form.model.clone(),
            temperature: form.temperature,
            max_tokens: None,
        });
        providers.get(&format!("{profile_id}/{}", form.model))
    });

    let buffer: Rc<RefCell<Vec<Signal>>> = Rc::new(RefCell::new(Vec::new()));
    let host: Rc<dyn RunHost> = Rc::new(BrowserHost::new(buffer.clone(), notify));
    let (agents, skills, soul) = baked_config()?;
    build_handle(
        agents, skills, soul, registry, resolver, log, kv, host, buffer, profile,
    )
}

/// Host bootstrap: memory stores + a scripted `MockProvider` — the living
/// smoke session `main` drives (and tests assert on).
#[cfg(not(target_arch = "wasm32"))]
pub async fn host_session() -> Result<HarnessHandle, String> {
    use askk_core::Provider;
    use askk_inference::MockProvider;
    use askk_runtime::run::TestHost;
    use askk_runtime::state::{BlobStore, MemBlob, MemKv};

    let kv: Rc<dyn KvStore> = Rc::new(MemKv::new());
    let blobs: Rc<dyn BlobStore> = Rc::new(MemBlob::new());
    let (log, _replayed) = SignalLog::open(blobs, Box::new(|| 0))
        .await
        .map_err(|e| e.to_string())?;
    let mut registry = ToolRegistry::new();
    register_builtins(&mut registry, || 7).map_err(|e| e.to_string())?;

    let mock = Rc::new(MockProvider::new("default/mock"));
    mock.push_text("action: tool\ntool: echo\nargs: {\"text\": \"hello from the harness\"}");
    mock.push_text("action: answer\nresponse: echo returned: hello from the harness");
    let provider: Rc<dyn Provider> = mock;
    let resolver: ProviderResolver = Box::new(move |_| Ok(provider.clone()));

    let buffer: Rc<RefCell<Vec<Signal>>> = Rc::new(RefCell::new(Vec::new()));
    let host: Rc<dyn RunHost> = Rc::new(TestHost::new());
    let profile = Rc::new(RefCell::new(ProviderProfileForm::default()));
    let (agents, skills, soul) = baked_config()?;
    build_handle(
        agents, skills, soul, registry, resolver, log, kv, host, buffer, profile,
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
mod tests {
    use super::*;
    use askk_core::{RunStatus, SignalKind};

    #[test]
    fn baked_agents_surface_as_cards() {
        block_on(async {
            let handle = host_session().await.unwrap();
            let cards = handle.agents();
            assert_eq!(cards.len(), 1);
            assert_eq!(cards[0].id, "assistant");
            assert!(!cards[0].description.is_empty());
        });
    }

    #[test]
    fn scripted_happy_path_answers_through_the_facade() {
        block_on(async {
            let handle = host_session().await.unwrap();
            let run = handle.submit("assistant", "say hello").await.unwrap();
            assert_eq!(handle.current_run(), Some(run.clone()));
            handle.drive().await;
            let proj = handle.projection(&run);
            assert_eq!(proj.status, RunStatus::Answered);
            assert_eq!(proj.turns_used, 2);
            assert!(proj
                .messages
                .iter()
                .any(|m| m.content.contains("hello from the harness")));
        });
    }

    #[test]
    fn unknown_agent_is_a_string_error_not_a_panic() {
        block_on(async {
            let handle = host_session().await.unwrap();
            let err = handle.submit("ghost", "hi").await.unwrap_err();
            assert!(err.contains("ghost"));
        });
    }

    #[test]
    fn mid_drive_projection_folds_the_live_buffer() {
        block_on(async {
            let handle = host_session().await.unwrap();
            // A run id the session does not know simulates mid-drive (the
            // run is out of the session map while driving).
            let run_id = RunId::new("live-run");
            handle.buffer.borrow_mut().push(Signal {
                seq: 1,
                run_id: run_id.clone(),
                ts_ms: 0,
                kind: SignalKind::PhaseEntered {
                    name: "main".into(),
                },
            });
            let proj = handle.projection(&run_id);
            assert_eq!(proj.status, RunStatus::Running);
            assert!(proj.timeline.iter().any(|t| t.contains("phase: main")));
            // Other runs' signals do not leak into the fold.
            let other = handle.projection(&RunId::new("someone-else"));
            assert!(other.timeline.is_empty());
        });
    }

    #[test]
    fn profile_round_trips_through_form_json_and_store() {
        let form = ProviderProfileForm {
            base_url: "http://localhost:1234/v1".into(),
            model: "qwen".into(),
            api_key: "sk-local".into(),
            temperature: Some(0.5),
        };
        block_on(async {
            let handle = host_session().await.unwrap();
            assert_eq!(handle.get_profile(), ProviderProfileForm::default());
            handle.set_profile(form.clone()).await.unwrap();
            assert_eq!(handle.get_profile(), form);
            // Persisted, not just cached.
            let stored = handle
                .settings
                .provider_profile(PROFILE_ID)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(profile_from_json(&stored), form);
        });
    }

    #[test]
    fn cancel_lands_the_interrupted_terminal_on_a_parked_run() {
        block_on(async {
            let handle = host_session().await.unwrap();
            let run = handle.submit("assistant", "say hello").await.unwrap();
            handle.cancel().await;
            assert_eq!(handle.projection(&run).status, RunStatus::Interrupted);
        });
    }

    #[test]
    fn runs_lists_submitted_and_buffer_observed_runs_newest_first() {
        block_on(async {
            let handle = host_session().await.unwrap();
            let first = handle.submit("assistant", "one").await.unwrap();
            handle.drive().await;
            // A delegate run seen only through the live buffer.
            let ghost = RunId::new("delegate-run");
            handle.buffer.borrow_mut().push(Signal {
                seq: 1,
                run_id: ghost.clone(),
                ts_ms: 0,
                kind: SignalKind::PhaseEntered {
                    name: "main".into(),
                },
            });
            let runs = handle.runs();
            let ids: Vec<&RunId> = runs.iter().map(|(id, _)| id).collect();
            assert_eq!(ids, vec![&ghost, &first]);
            assert_eq!(runs[1].1.status, RunStatus::Answered);
        });
    }

    #[test]
    fn draft_accumulates_deltas_and_clears_on_response() {
        block_on(async {
            let handle = host_session().await.unwrap();
            let run_id = RunId::new("r-draft");
            let push = |kind: SignalKind| {
                handle.buffer.borrow_mut().push(Signal {
                    seq: 0,
                    run_id: run_id.clone(),
                    ts_ms: 0,
                    kind,
                });
            };
            push(SignalKind::LlmRequest);
            push(SignalKind::LlmDelta { text: "hel".into() });
            push(SignalKind::LlmDelta { text: "lo".into() });
            assert_eq!(handle.draft(&run_id), "hello");
            assert_eq!(
                handle.latest_activity(&run_id),
                Some(SignalKind::LlmRequest)
            );
            push(SignalKind::LlmResponse {
                text: "hello".into(),
            });
            assert_eq!(handle.draft(&run_id), "");
        });
    }

    #[test]
    fn prefs_round_trip_through_the_session_store() {
        block_on(async {
            let handle = host_session().await.unwrap();
            assert_eq!(handle.get_pref("ui").await, None);
            handle
                .set_pref("ui", serde_json::json!({"theme": "amber"}))
                .await;
            let stored = handle.get_pref("ui").await.unwrap();
            assert_eq!(stored["theme"], "amber");
        });
    }
}
