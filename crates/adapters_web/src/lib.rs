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

mod error;
mod idb;
mod idb_bridge;
mod ports;

pub use error::WebError;
pub use idb::IdbStore;
pub use ports::{BrowserClock, BrowserRng, FetchModel, FetchNet};

use wasm_bindgen::prelude::*;

/// The booted application, held for the page's lifetime. A wasm-bindgen
/// class (rather than a global) so ownership is explicit and a future
/// multi-agent Worker can hold its own instance (§10 Tier 2). Inner shape is
/// `Rc<RefCell<…>>` because the async runtime half (`core::drive`) runs as
/// spawned tasks that share the app with the sync seam.
#[wasm_bindgen]
pub struct WebApp {
    app: Rc<RefCell<core::App>>,
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
        let ports = core::Ports {
            model: Rc::new(FetchModel::new("config/keys/")),
            store,
            net: Rc::new(FetchNet::new(Vec::new())),
            clock: Rc::new(BrowserClock),
            rng: Rc::new(BrowserRng),
        };
        let app = core::boot(ports).await.map_err(js_err)?;
        Ok(WebApp {
            app: Rc::new(RefCell::new(app)),
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
