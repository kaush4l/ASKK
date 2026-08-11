//! The driving adapter AND composition root (ARCHITECTURE §4's fixed
//! straw-man bug): the only crate that knows browsers exist. Builds the real
//! ports, boots `core`, and exposes the seam to `transport.js`.
//!
//! G4 note (ARCHITECTURE §1d): the core runs on the MAIN thread — the
//! Spike-A-proven fallback the architecture explicitly reserved. The Worker
//! move is transport-only (the seam is unchanged); it lands when a runaway
//! module can actually exist (the forge, G5+).

use std::cell::RefCell;
use std::rc::Rc;

mod assets;
pub mod catalogue;
mod endpoint;
mod error;
mod idb;
mod idb_kv;
mod idb_bridge;
mod model;
mod overrides;
mod wire;
mod ports;
mod settings;
mod spawn;
mod worker;
mod workers;

pub use endpoint::Endpoint;
pub use error::WebError;
pub use idb::IdbStore;
pub use model::FetchModel;
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
    /// The Workers, held as the concrete type as well as behind `AgentPort`:
    /// the core delegates through the port, but only the composition root may
    /// start, stop or report on a Worker's LIFE (increment 07).
    workers: Rc<AgentWorkers>,
    /// What every sub-agent Worker was booted with, so restarting them after
    /// an endpoint change hands them the new one (a Worker cannot learn it).
    world: RefCell<(String, String)>,
}

fn js_err(e: impl std::fmt::Debug) -> JsValue {
    JsValue::from_str(&format!("{e:?}"))
}

#[wasm_bindgen]
impl WebApp {
    /// The composition root: construct the browser ports (IndexedDB store,
    /// fetch model/net brokers, real clock, WebCrypto rng), inject them,
    /// run `core::boot` (migrations, event replay, built-in registration).
    /// The ONLY place adapters meet the core.
    pub async fn boot() -> Result<WebApp, JsValue> {
        let store = Rc::new(IdbStore::open("harness").await.map_err(js_err)?);
        let model = Rc::new(FetchModel::new("config/keys/"));
        let agents = Rc::new(AgentWorkers::none());
        // The shipped catalogue FIRST, then the user's layer over it: an
        // override must land on top of whatever this deploy's file says.
        let models_json = assets::fetch_models().await.unwrap_or_default();
        if !models_json.is_empty() {
            model.set_catalogue(&models_json);
        }
        // The user's configured endpoint, restored before the first turn.
        if let Ok(Some(raw)) = kernel::StorePort::kv(store.as_ref())
            .get(model.profile_key())
            .await
        {
            model.load_profile(&raw);
        }
        let ports = core::Ports {
            model: Rc::clone(&model) as Rc<dyn kernel::ModelPort>,
            store: Rc::clone(&store) as Rc<dyn kernel::StorePort>,
            net: Rc::new(FetchNet::new(Vec::new())),
            clock: Rc::new(BrowserClock),
            rng: Rc::new(BrowserRng),
            agents: Rc::clone(&agents) as Rc<dyn kernel::AgentPort>,
        };
        let mut app = core::boot(ports).await.map_err(js_err)?;
        // Agents are data fetched from `public/agents/`, not code compiled in:
        // built-ins first so a project agent of the same name replaces one.
        let files = assets::fetch_agents().await;
        let files_json = serde_json::to_string(&files).unwrap_or_else(|_| "[]".into());
        core::install_agents(&mut app, files);
        // This page's agent holds its conversation across a reload the way
        // every sub-agent now does — from its own log, not from the transcript
        // the screen happens to show (increment 08).
        core::restore_log(&mut app).await.map_err(js_err)?;
        // Every agent that is not this page gets its own Worker — its own JS
        // context, its own Wasm instance, its own event loop (Python
        // `AgentThread`). Started at boot, the way the registry starts every
        // thread at load, so the board is honest the moment the page paints.
        let names: Vec<String> = core::agent_names(&app);
        agents.spawn(
            &names,
            core::ENTRY_AGENT,
            &files_json,
            &models_json,
            &model.profile_json(),
        );
        Ok(WebApp {
            app: Rc::new(RefCell::new(app)),
            model,
            store,
            workers: agents,
            world: RefCell::new((files_json, models_json)),
        })
    }

    /// The seam, transport-shaped: `transport.js` passes a JSON Request;
    /// this deserializes, calls `core::handle`, kicks the async runtime half
    /// (agent pump + event persistence) as a background task, and returns
    /// the JSON Response whose body htmx swaps. JSON because the boundary
    /// already speaks it — no second wire format to keep honest (I4, I5).
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

impl WebApp {
    /// Every agent loaded in this browser — the UI needs the list to give each
    /// one its own conversation (increment 07).
    pub fn agent_names(&self) -> Vec<String> {
        core::agent_names(&self.app.borrow())
    }

    /// Stop every sub-agent Worker and start it again on the CURRENT endpoint.
    /// A Worker is handed its profile once, at boot; without this, changing
    /// the endpoint in Settings left every sub-agent calling the old one while
    /// the page called the new — the same question answered two ways depending
    /// on which pane you asked.
    pub fn restart_agents(&self) {
        self.workers.close_all();
        let (files, models) = self.world.borrow().clone();
        self.workers.spawn(
            &self.agent_names(),
            core::ENTRY_AGENT,
            &files,
            &models,
            &self.model.profile_json(),
        );
    }

    /// The seam for a Rust caller — the `ui` crate's Dioxus event handlers
    /// (I4: same `core::handle`, no JSON hop, no second wire format). `&self`
    /// because the mutation is behind the `RefCell` the async half shares.
    pub fn handle(&self, req: kernel::Request) -> kernel::Response {
        // Worker lifecycle facts arrive on a JS callback, where the app is
        // already borrowed by whatever handler is running; they are queued
        // there and land in the log HERE, through the one status door (I8).
        for (agent, status, detail) in self.workers.take_reports() {
            core::report_agent(&mut self.app.borrow_mut(), &agent, status, &detail);
        }
        let response = core::handle(&mut self.app.borrow_mut(), req);
        let app = Rc::clone(&self.app);
        wasm_bindgen_futures::spawn_local(async move {
            if let Err(e) = core::drive(app).await {
                web_sys::console::error_1(&js_err(e));
            }
        });
        response
    }
}
