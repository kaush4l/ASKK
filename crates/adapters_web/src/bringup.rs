//! BRINGING THE APP UP: what has to be true before `core::boot` runs, and what
//! has to happen before the page can take a turn.
//!
//! Its own module because `lib.rs` is the composition root — the wiring
//! diagram — and three multi-step preparations inlined into it hid the wiring
//! behind the errands. Each function here answers one question the root asks
//! once: which endpoints may this browser be pointed at, which may it reach,
//! and who is awake.

use std::rc::Rc;

use wasm_bindgen::prelude::*;

use crate::{assets, js_err, ondevice, AgentWorkers, FetchModel, FetchNet, IdbStore};

/// WHAT THIS BROWSER MAY BE POINTED AT: the catalogue as shipped, plus an
/// on-device entry where this browser has one, plus the user's own layer on
/// top — in that order, because an override must land on whatever this
/// deploy's file says. Returns the SHIPPED bytes, which are what a sub-agent's
/// Worker is handed: Chrome does not offer the Prompt API inside a Worker, so
/// an on-device entry there would be an entry that always fails.
pub(crate) async fn offered_catalogue(model: &FetchModel, store: &IdbStore) -> String {
    let models_json = assets::fetch_models().await.unwrap_or_default();
    if !models_json.is_empty() {
        model.set_catalogue(&models_json);
    }
    if let Some(entry) = ondevice::probe().await {
        model.add_catalogue(&entry);
    }
    if let Ok(Some(raw)) = kernel::StorePort::kv(store).get(model.profile_key()).await {
        model.load_profile(&raw);
    }
    models_json
}

/// The brokered net, carrying the one destination this build can reach.
///
/// THE ALLOWLIST IS BUILT FROM THE SETTING, never from a constant: an unset
/// search endpoint is an empty list, and an empty list denies — which is what
/// `web_search` turns into the sentence naming Settings (CLAUDE.md §17: a
/// network allowlist is the user's gate, so this build ships the capability
/// and not the destination).
pub(crate) fn search_net(model: &FetchModel) -> Rc<FetchNet> {
    let net = Rc::new(FetchNet::new());
    net.allow(kernel::SEARCH_ENDPOINT, &model.search_url());
    net
}

/// Bring the booted app to life: install the agent files, restore this page's
/// own conversation from its log, then start a Worker for every OTHER agent.
/// In that order, because a Worker is handed the roster at boot and the
/// roster is not complete until both the shipped files and the ones this
/// browser AUTHORED are in it. Returns those merged bytes.
pub(crate) async fn wake_roster(
    app: &mut core::App,
    agents: &AgentWorkers,
    model: &FetchModel,
    models_json: &str,
) -> Result<String, JsValue> {
    // Agents are data fetched from `public/agents/`, not code compiled in:
    // built-ins first so a project agent of the same name replaces one.
    core::install_agents(app, assets::fetch_agents().await);
    // …and the words every STAGE enters with, by the same road (`public/stages/`).
    core::install_briefs(app, assets::fetch_briefs().await);
    let files_json = serde_json::to_string(&core::agent_files(app)).unwrap_or_else(|_| "[]".into());
    // This page's agent holds its conversation across a reload the way every
    // sub-agent now does — from its own log, not from the transcript the
    // screen happens to show (increment 08).
    core::restore_log(app).await.map_err(js_err)?;
    // Started at boot so the board is honest on first paint.
    let names: Vec<String> = core::agent_names(app);
    let profile_json = model.profile_json();
    // A sub-agent walks the same loop, so it is handed the same briefs.
    let briefs_json =
        serde_json::to_string(&core::brief_files(app)).unwrap_or_else(|_| "[]".into());
    let boot = crate::workers::Boot {
        agents: &files_json,
        briefs: &briefs_json,
        models: models_json,
        profile: &profile_json,
    };
    agents.spawn(&names, core::ENTRY_AGENT, boot);
    Ok(files_json)
}