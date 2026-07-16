//! Session bootstrap + the `HarnessHandle` facade — the ADR-013 edge. The UI
//! calls this module only; everything it passes or receives is an askk-core
//! type or a plain struct defined here. Config is baked in via `include_str!`
//! of `agents/` (data, not code).

use std::cell::RefCell;
use std::rc::Rc;

use askk_core::{fold, ActionId, ActionPolicy, Budgets, RunId, RunProjection, Signal, SignalKind};
use askk_engine::config::{AgentConfig, SkillConfig};
use askk_engine::run::{ProviderResolver, RunHost, RunSession, SessionInit};
use askk_engine::state::{KvStore, MemoryStore, SessionStore, SignalLog, DEFAULT_MAX_ENTRIES};
use askk_engine::tools::{
    register_artifacts, register_builtins, register_knowledge, register_mcp, register_shell,
    register_web_search, register_workspace, ToolRegistry,
};
use serde_json::Value;

#[cfg(any(target_arch = "wasm32", test))]
use super::profile::profile_from_json;
use super::profile::profile_to_json;
pub use super::profile::{AgentCard, NamedProfile, ProfileSet, ProviderProfileForm};
/// Re-exported so the UI reads MCP boot statuses through the facade path.
pub use askk_engine::tools::McpServerStatus;

#[cfg(not(target_arch = "wasm32"))]
pub use askk_engine::testutil::block_on;

/// The single provider id agents reference (`provider: default`); which
/// saved profile it points at is the profile set's `active` pick.
const PROFILE_ID: &str = "default";
/// Pref key holding the active profile's name.
const ACTIVE_PROFILE_PREF: &str = "active_profile";
/// Pref key holding the SearXNG instance base URL ("" = disabled).
const SEARXNG_PREF: &str = "searxng_url";
/// Pref key holding newline-separated MCP server URLs ("" = none).
const MCP_PREF: &str = "mcp_servers";
/// Shipped default instance — the rare public one that serves JSON with
/// CORS. It rate-limits under load (the chain falls back cleanly);
/// point at a self-hosted instance for reliability.
#[cfg(target_arch = "wasm32")]
const SEARXNG_DEFAULT: &str = "https://search.rhscz.eu";

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
    /// Live SearXNG base URL cell shared with `web_search` ("" = disabled).
    searxng: Rc<RefCell<String>>,
    /// Blob store shared with the signal log — `host::artifacts` reads
    /// published `artifact/<slug>` docs from it.
    pub(super) blobs: Rc<dyn askk_engine::state::BlobStore>,
    /// Raw MCP server config text (pref mirror; registration happens at
    /// boot, so edits apply on the next reload).
    mcp_servers: RefCell<String>,
    /// Per-server MCP registration outcomes from boot (Settings status list).
    mcp_status: Vec<McpServerStatus>,
}

/// `HarnessHandle` methods + `build_handle` — a `#[path]` child module
/// (same privacy access as inline) under the ADR-012 file-size cap.
#[path = "boot_handle.rs"]
mod boot_handle;
use boot_handle::build_handle;

/// Browser bootstrap: OPFS stores (in-memory fallback when the browser's
/// storage grant is broken), fetch transport, `Date.now` clock, provider
/// resolved from the persisted profile via the inference registry.
#[cfg(target_arch = "wasm32")]
pub async fn session(notify: Box<dyn Fn()>) -> Result<HarnessHandle, String> {
    use super::browser::BrowserHost;
    use super::fetch::FetchTransport;
    use askk_engine::state::{BlobStore, MemBlob, MemKv};
    use askk_inference::{ProviderProfile, ProviderRegistry, Transport};

    let (kv, blobs, storage_warning): (Rc<dyn KvStore>, Rc<dyn BlobStore>, Option<String>) =
        match super::opfs::stores().await {
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
    let (log, _replayed) = SignalLog::open(blobs.clone(), Box::new(|| js_sys::Date::now() as u64))
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
    // First boot (no saved profiles): seed the manual-smoke model so the
    // harness can run before Settings is ever opened (ADR-020 smoke lane).
    if set.profiles.is_empty() {
        set = super::profile::seeded();
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

    // SearXNG instance: pref if set (empty = user disabled), shipped
    // default otherwise.
    let searxng_url = match settings.pref(SEARXNG_PREF).await.ok().flatten() {
        Some(v) => v.as_str().unwrap_or_default().to_string(),
        None => SEARXNG_DEFAULT.to_string(),
    };
    let searxng = Rc::new(RefCell::new(searxng_url));

    // MCP servers (JSON config array or legacy newline URLs; missing/empty
    // = none). Tools register at boot, so an edit applies on the next reload.
    let mcp_text = settings
        .pref(MCP_PREF)
        .await
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default();

    let transport: Rc<dyn Transport> = Rc::new(FetchTransport::new());
    let mut registry = ToolRegistry::new();
    let now = || js_sys::Date::now() as u64;
    register_builtins(&mut registry).map_err(|e| e.to_string())?;
    register_web_search(&mut registry, transport.clone(), searxng.clone())
        .map_err(|e| e.to_string())?;
    register_knowledge(&mut registry, kv.clone(), now).map_err(|e| e.to_string())?;
    register_artifacts(&mut registry, blobs.clone(), now).map_err(|e| e.to_string())?;
    let shell_exec = Rc::new(super::vm::SerialShell::new());
    register_shell(&mut registry, shell_exec.clone()).map_err(|e| e.to_string())?;
    register_workspace(&mut registry, shell_exec).map_err(|e| e.to_string())?;
    let mcp_status = register_mcp(
        &mut registry,
        transport.clone(),
        &askk_engine::tools::parse_servers(&mcp_text),
    )
    .await;

    // The resolver reads the live profile-set cell per run: a settings save
    // or an active-profile switch is effective on the next run, no rebuild.
    let resolver_profiles = profiles.clone();
    let resolver: ProviderResolver = Box::new(move |profile_id| {
        let form = resolver_profiles.borrow().active_form();
        // Base URL `local` (or a `local/` model prefix) → in-browser
        // inference via the transformers.js worker; no server, no key.
        if let Some(local) = super::local_llm::local_provider(profile_id, &form) {
            return Ok(local);
        }
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
    // Cross-tab mirror (ADR-031): local signals broadcast via the tap,
    // foreign signals join the live buffer (rendered like delegate runs).
    let (tap, notify) = super::bus::wire(buffer.clone(), notify);
    let host: Rc<dyn RunHost> = Rc::new(BrowserHost::new(buffer.clone(), notify, tap));
    // fetched_config also registers any manifest-declared JS tools into the
    // registry, so it must run before the registry moves into build_handle.
    let (agents, teams, skills, soul) = match super::config::fetched_config(&mut registry).await {
        Some(config) => config,
        None => {
            super::config::register_baked_tools(&mut registry);
            super::config::baked_config()?
        }
    };
    let mut handle = build_handle(
        agents, teams, skills, soul, registry, resolver, log, kv, blobs, host, buffer, profiles,
        searxng,
    )?;
    // One boot-degradation channel: broken storage and dead MCP servers both
    // surface once in the UI; neither fails boot.
    let mut warnings: Vec<String> = storage_warning.into_iter().collect();
    warnings.extend(
        mcp_status
            .iter()
            .filter_map(|s| s.error.as_ref().map(|e| format!("mcp {}: {e}", s.url))),
    );
    handle.storage_warning = (!warnings.is_empty()).then(|| warnings.join("; "));
    handle.mcp_status = mcp_status;
    *handle.mcp_servers.borrow_mut() = mcp_text;
    Ok(handle)
}

/// Host-target bootstrap (`host_session` + the host `session` shim) — a
/// `#[path]` child module (same privacy access as inline) under the ADR-012
/// file-size cap.
#[cfg(not(target_arch = "wasm32"))]
#[path = "boot_host.rs"]
mod boot_host;
#[cfg(not(target_arch = "wasm32"))]
pub use boot_host::{host_session, session};

#[cfg(all(test, not(target_arch = "wasm32")))]
#[path = "boot_tests.rs"]
mod tests;
