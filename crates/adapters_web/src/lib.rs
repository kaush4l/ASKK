//! The driving adapter AND composition root (ARCHITECTURE §4's fixed
//! straw-man bug): the only crate that knows browsers exist. Builds the real
//! ports, boots `core`, and exposes the seam. The core runs on the MAIN
//! thread (ARCHITECTURE §1d) — the Spike-A-proven fallback.

use std::cell::RefCell;
use std::rc::Rc;

mod assets;
mod c2w;
mod cheerpx;
mod engine;
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
mod roster;
mod settings;
mod spawn;
mod seam;
mod warmth;
mod worker;
mod workers;

pub use c2w::C2wWorkspace;
pub use cheerpx::CheerpxWorkspace;
pub use engine::{engine, set_engine, stored, Engine};
pub use warmth::{prewarm, warmth, Warmth};
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

#[wasm_bindgen]
impl WebApp {
    /// The composition root: construct the browser ports (IndexedDB store,
    /// fetch model/net brokers, real clock, WebCrypto rng), inject them,
    /// run `core::boot` (migrations, event replay, built-in registration).
    /// The ONLY place adapters meet the core.
    pub async fn boot() -> Result<WebApp, JsValue> {
        let store = Rc::new(IdbStore::open("harness").await.map_err(js_err)?);
        // Opened by the page and by every Worker: a space that lived in this
        // agent's own store would be a space nobody could share.
        let spaces = Rc::new(IdbStore::open(worker::SPACES_DB).await.map_err(js_err)?);
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
            spaces: spaces as Rc<dyn kernel::KvStore>,
            // The Linux, not booted — and WHICH Linux is a setting, read
            // once, here (increment 18). Both implement the same port, so
            // this is the only line in the codebase that knows there are two;
            // changing the setting takes effect on the next load, because
            // this line runs once.
            workspace: match engine::engine() {
                Engine::Cheerpx => Rc::new(CheerpxWorkspace) as Rc<dyn kernel::WorkspacePort>,
                Engine::C2w => Rc::new(C2wWorkspace) as Rc<dyn kernel::WorkspacePort>,
            },
            agents: Rc::clone(&agents) as Rc<dyn kernel::AgentPort>,
        };
        let mut app = core::boot(ports).await.map_err(js_err)?;
        // Agents are data fetched from `public/agents/`, not code compiled in:
        // built-ins first so a project agent of the same name replaces one.
        let files = assets::fetch_agents().await;
        core::install_agents(&mut app, files);
        // …merged with whatever this browser AUTHORED, which the replayed log
        // already holds (increment 11): a Worker boots from the same roster the
        // page runs, or `main` could not delegate to an agent written here.
        let files_json =
            serde_json::to_string(&core::agent_files(&app)).unwrap_or_else(|_| "[]".into());
        // This page's agent holds its conversation across a reload the way
        // every sub-agent now does — from its own log, not from the transcript
        // the screen happens to show (increment 08).
        core::restore_log(&mut app).await.map_err(js_err)?;
        // Every agent that is not this page gets its own Worker (Python
        // `AgentThread`), started at boot so the board is honest on first paint.
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
