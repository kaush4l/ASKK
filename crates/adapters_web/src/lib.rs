//! The driving adapter AND composition root (ARCHITECTURE §4's fixed
//! straw-man bug): the only crate that knows browsers exist. Builds the real
//! ports, boots `core`, and exposes the seam. The core runs on the MAIN
//! thread (ARCHITECTURE §1d) — the Spike-A-proven fallback.

use std::cell::RefCell;
use std::rc::Rc;

mod assets;
mod c2w;
pub mod catalogue;
mod endpoint;
mod error;
mod idb;
mod leftovers;
mod model;
pub mod ondevice;
mod ports;
mod roster;
mod seam;
mod settings;
mod wire;
mod worker;
mod workers;

pub use c2w::{prewarm, warmth, C2wWorkspace, Warmth};
pub use leftovers::{drop_engine_setting, drop_workspace_leftover, workspace_leftover, Leftover};
pub use endpoint::Endpoint;
pub use error::WebError;
pub use idb::IdbStore;
pub use model::{FetchModel, TIMEOUT_SECS};
pub use ports::{sleep, BrowserClock, BrowserRng, FetchNet};
pub use worker::AgentWorker;

pub use workers::AgentWorkers;

use wasm_bindgen::prelude::*;

/// The booted application, held for the page's lifetime. A wasm-bindgen
/// class (rather than a global) so ownership is explicit and a future
/// multi-agent Worker can hold its own instance (§10 Tier 2). Inner shape is
/// `Rc<RefCell<…>>` because the async runtime half (`core::drive`) runs as
/// spawned tasks that share the app with the sync seam.
#[wasm_bindgen]
pub struct WebApp {
    app: Rc<RefCell<core::App>>,
    /// The credential broker, held so settings can repoint it. Kept OUT of
    /// `core::Ports`' reach as a concrete type: the core only ever sees the
    /// `ModelPort` trait object, so nothing in the core can read a key (I6).
    model: Rc<FetchModel>,
    store: Rc<IdbStore>,
    /// The network broker, held for the same reason as `model`: saving the
    /// search endpoint has to reach the port the core is already holding. The
    /// core sees only `NetPort`, so nothing upstream can add to the allowlist.
    net: Rc<FetchNet>,
    /// The Workers, held as the concrete type as well as behind `AgentPort`:
    /// the core delegates through the port, but only the composition root may
    /// start, stop or report on a Worker's LIFE (increment 07).
    workers: Rc<AgentWorkers>,
    /// The model catalogue every sub-agent Worker was booted with, so
    /// restarting them hands them the same one (a Worker cannot learn it).
    models: RefCell<String>,
    /// The agent FILES every live Worker was booted from. Compared after every
    /// seam round-trip, so an agent authored in the browser gets its own Worker
    /// with no reload, a deleted one loses it, and an EDITED prompt reaches the
    /// Worker that has to use it (`roster.rs`).
    spawned: RefCell<String>,
}

fn js_err(e: impl std::fmt::Debug) -> JsValue {
    JsValue::from_str(&format!("{e:?}"))
}

/// WHAT THIS BROWSER MAY BE POINTED AT: the catalogue as shipped, plus an
/// on-device entry where this browser has one, plus the user's own layer on
/// top — in that order, because an override must land on whatever this
/// deploy's file says. Returns the SHIPPED bytes, which are what a sub-agent's
/// Worker is handed: Chrome does not offer the Prompt API inside a Worker, so
/// an on-device entry there would be an entry that always fails.
async fn offered_catalogue(model: &FetchModel, store: &IdbStore) -> String {
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
fn search_net(model: &FetchModel) -> Rc<FetchNet> {
    let net = Rc::new(FetchNet::new());
    net.allow(kernel::SEARCH_ENDPOINT, &model.search_url());
    net
}

/// Bring the booted app to life: install the agent files, restore this page's
/// own conversation from its log, then start a Worker for every OTHER agent.
/// In that order, because a Worker is handed the roster at boot and the
/// roster is not complete until both the shipped files and the ones this
/// browser AUTHORED are in it. Returns those merged bytes.
async fn wake_roster(
    app: &mut core::App,
    agents: &AgentWorkers,
    model: &FetchModel,
    models_json: &str,
) -> Result<String, JsValue> {
    // Agents are data fetched from `public/agents/`, not code compiled in:
    // built-ins first so a project agent of the same name replaces one.
    core::install_agents(app, assets::fetch_agents().await);
    let files_json = serde_json::to_string(&core::agent_files(app)).unwrap_or_else(|_| "[]".into());
    // This page's agent holds its conversation across a reload the way every
    // sub-agent now does — from its own log, not from the transcript the
    // screen happens to show (increment 08).
    core::restore_log(app).await.map_err(js_err)?;
    // Started at boot so the board is honest on first paint.
    let names: Vec<String> = core::agent_names(app);
    let profile_json = model.profile_json();
    agents.spawn(&names, core::ENTRY_AGENT, &files_json, models_json, &profile_json);
    Ok(files_json)
}

#[wasm_bindgen]
impl WebApp {
    /// The composition root: construct the browser ports (IndexedDB store,
    /// fetch model/net brokers, real clock, WebCrypto rng), inject them,
    /// run `core::boot` (migrations, event replay, built-in registration),
    /// then bring the roster up. The ONLY place adapters meet the core.
    pub async fn boot() -> Result<WebApp, JsValue> {
        let store = Rc::new(IdbStore::open("harness").await.map_err(js_err)?);
        // Opened by the page and by every Worker: a space that lived in this
        // agent's own store would be a space nobody could share.
        let spaces = Rc::new(IdbStore::open(worker::SPACES_DB).await.map_err(js_err)?);
        let model = Rc::new(FetchModel::new("config/keys/"));
        let agents = Rc::new(AgentWorkers::none());
        let models_json = offered_catalogue(&model, store.as_ref()).await;
        let net = search_net(&model);
        let ports = core::Ports {
            model: Rc::clone(&model) as Rc<dyn kernel::ModelPort>,
            store: Rc::clone(&store) as Rc<dyn kernel::StorePort>,
            net: Rc::clone(&net) as Rc<dyn kernel::NetPort>,
            clock: Rc::new(BrowserClock),
            rng: Rc::new(BrowserRng),
            spaces: Rc::clone(&spaces) as Rc<dyn kernel::KvStore>,
            // The Linux, not booted. ONE ENGINE, NOT A CHOICE: container2wasm
            // is an image this project builds and serves itself, which is the
            // whole reason it is the only one — nothing here streams a disk
            // or a runtime from somebody else's CDN.
            workspace: Rc::new(C2wWorkspace) as Rc<dyn kernel::WorkspacePort>,
            agents: Rc::clone(&agents) as Rc<dyn kernel::AgentPort>,
        };
        let mut app = core::boot(ports).await.map_err(js_err)?;
        let files_json = wake_roster(&mut app, &agents, &model, &models_json).await?;
        Ok(WebApp {
            app: Rc::new(RefCell::new(app)),
            model,
            store,
            net,
            workers: agents,
            models: RefCell::new(models_json),
            spawned: RefCell::new(files_json),
        })
    }

    /// The seam, transport-shaped: a JSON Request in, the JSON Response out.
    /// JSON because the boundary already speaks it — no second wire format to
    /// keep honest (I4, I5).
    pub fn handle_request(&mut self, request_json: &str) -> String {
        let response = match serde_json::from_str::<kernel::Request>(request_json) {
            Ok(req) => self.handle(req),
            Err(e) => kernel::Response {
                status: 400,
                headers: vec![("content-type".into(), "text/html; charset=utf-8".into())],
                body: format!("<div class=\"error\">malformed transport request: {e}</div>"),
            },
        };
        serde_json::to_string(&response).expect("Response serializes")
    }
}
