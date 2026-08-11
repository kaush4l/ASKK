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
mod idb_bridge;
mod model;
mod ports;

pub use endpoint::Endpoint;
pub use error::WebError;
pub use idb::IdbStore;
pub use model::FetchModel;
pub use ports::{sleep, BrowserClock, BrowserRng, FetchNet};

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
        // The shipped catalogue FIRST, then the user's layer over it: an
        // override must land on top of whatever this deploy's file says.
        if let Some(raw) = assets::fetch_models().await {
            model.set_catalogue(&raw);
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
        };
        let mut app = core::boot(ports).await.map_err(js_err)?;
        // Agents are data fetched from `public/agents/`, not code compiled in:
        // built-ins first so a project agent of the same name replaces one.
        core::install_agents(&mut app, assets::fetch_agents().await);
        Ok(WebApp {
            app: Rc::new(RefCell::new(app)),
            model,
            store,
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
    /// The seam for a Rust caller — the `ui` crate's Dioxus event handlers
    /// (I4: same `core::handle`, no JSON hop, no second wire format). `&self`
    /// because the mutation is behind the `RefCell` the async half shares.
    pub fn handle(&self, req: kernel::Request) -> kernel::Response {
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

impl WebApp {
    /// Point the model broker at an endpoint and persist the profile. NOT on
    /// the seam, deliberately: `handle` writes an Event for every request
    /// (I8), and an event log is exactly where a credential must never
    /// appear. The base URL and key go straight from the settings pane to the
    /// broker and to `config/keys/model` in IndexedDB — the core is not told.
    ///
    /// PROVISIONAL (ADR-006 secret storage, Option A): the record is plain in
    /// IndexedDB. Option B (WebCrypto-wrapped at rest) is a HUMAN GATE and is
    /// one adapter file away; the UI states the trust model where keys are
    /// entered.
    /// `api_key: None` means "leave the stored key alone" — the settings field
    /// is write-only, so a blank field must not wipe a saved secret. `entry`
    /// is the catalogue key the user picked; `base_url`/`model` are their
    /// override of it, blank meaning "whatever models.json says".
    pub async fn set_endpoint(
        &self,
        entry: &str,
        base_url: &str,
        api_key: Option<&str>,
        model: &str,
    ) -> Result<(), WebError> {
        self.model.set_endpoint(entry, base_url, api_key, model);
        kernel::StorePort::kv(self.store.as_ref())
            .put(self.model.profile_key(), &self.model.profile_json())
            .await
            .map_err(WebError::Store)
    }

    /// The current entry's base URL, whether a key is set, the model name, and
    /// the env var the Python reads for it — never the key.
    pub fn endpoint_summary(&self) -> (String, bool, String, String) {
        self.model.endpoint_summary()
    }

    /// The catalogue: every entry name, which one is current, and what a named
    /// entry resolves to (so Settings can prefill when the pick changes).
    pub fn catalogue_names(&self) -> Vec<String> {
        self.model.catalogue_names()
    }

    pub fn current_entry(&self) -> String {
        self.model.current_entry()
    }

    pub fn entry_fields(&self, name: &str) -> (String, String, String) {
        self.model.entry_fields(name)
    }
}
