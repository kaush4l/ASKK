//! The driving adapter AND composition root (ARCHITECTURE §4's fixed
//! straw-man bug): the only crate that knows browsers exist. Builds the real
//! ports, boots `core`, and exposes the seam to `transport.js` over
//! postMessage (§5 option B; Worker-hosted per ARCHITECTURE §1d).
//!
//! G3 interface freeze: types and signatures only; bodies are `todo!()`.

// G3 freeze: private fields are unread while bodies are todo!(); lift at G4.
#![allow(dead_code)]

mod error;
mod ports;

pub use error::WebError;
pub use ports::{BrowserClock, BrowserRng, FetchModel, FetchNet, IdbStore};

use wasm_bindgen::prelude::*;

/// The booted application, held by the Worker for its lifetime. Exists as a
/// wasm-bindgen class (rather than a global) so ownership is explicit and a
/// future multi-agent Worker can hold its own instance (§10 Tier 2).
#[wasm_bindgen]
pub struct WebApp {
    app: Option<core::App>,
}

#[wasm_bindgen]
impl WebApp {
    /// The composition root: construct the browser ports (IndexedDB store,
    /// fetch model/net brokers, real clock, WebCrypto rng), inject them as
    /// `dyn` objects, run `core::boot` (migrations, registry replay,
    /// built-in registration). The ONLY place adapters meet the core.
    pub async fn boot() -> Result<WebApp, JsValue> {
        todo!("G4")
    }

    /// The seam, transport-shaped: `transport.js` postMessages a JSON
    /// Request; this deserializes, calls `core::handle`, and returns the
    /// JSON Response whose body htmx swaps. JSON (not structured types)
    /// because the message channel is the one place both sides already
    /// speak it — no second wire format to keep honest (I4, I5).
    pub fn handle_request(&mut self, request_json: &str) -> String {
        let _ = request_json;
        todo!("G4")
    }
}
