//! # Code: the tab's own place to run a program
//!
//! The server runs commands in the workspace (`host/workspace.rs`); a tab has no processes.
//! What it has is a sandbox the browser already enforces: a hidden frame with an opaque origin
//! and, inside it, a worker (`code.js`). Code run there cannot read this page, the store, or
//! the network (only the Python runtime's files are fetched), and a run that does not end is
//! stopped by replacing the worker.
//!
//! | language | runtime | first use |
//! | --- | --- | --- |
//! | `js` | the browser's own engine | at once |
//! | `python` | Pyodide (CPython as wasm), from its CDN | a download of several MB, then kept |
use super::on_tab;
use crate::core::code::Code;
use crate::core::Fut;
use serde_json::Value;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(module = "/src/local/code.js")]
extern "C" {
    #[wasm_bindgen(catch)]
    async fn run_code(language: String, code: String, timeout: u32) -> Result<JsValue, JsValue>;
}

async fn run(language: String, code: String, timeout: u32) -> Result<Value, String> {
    let reply = run_code(language, code, timeout).await.map_err(|e| format!("sandbox: {e:?}"))?;
    reply.as_string().and_then(|s| serde_json::from_str(&s).ok()).ok_or_else(|| "sandbox: unreadable reply".to_string())
}

/// The tab's place to run a program ([`crate::core::code`]).
pub struct Sandbox;

impl Code for Sandbox {
    fn languages(&self) -> Vec<String> {
        vec!["js".into(), "python".into()]
    }
    fn run(&self, language: String, code: String, timeout_ms: u64) -> Fut<Result<Value, String>> {
        on_tab(run(language, code, timeout_ms as u32))
    }
}
