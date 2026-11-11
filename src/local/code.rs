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
use crate::core::{Fut, Tool, Toolbox};
use serde_json::{json, Value};
use std::sync::Arc;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(module = "/src/local/code.js")]
extern "C" {
    #[wasm_bindgen(catch)]
    async fn run_code(language: String, code: String, timeout: u32) -> Result<JsValue, JsValue>;
}

/// A run's limit when the caller sets none, and the most it may ask for.
const TIMEOUT_MS: u64 = 10_000;
const MAX_TIMEOUT_MS: u64 = 120_000;

async fn run(language: String, code: String, timeout: u32) -> Result<Value, String> {
    let reply = run_code(language, code, timeout).await.map_err(|e| format!("sandbox: {e:?}"))?;
    let v: Value = reply.as_string().and_then(|s| serde_json::from_str(&s).ok()).ok_or("sandbox: unreadable reply")?;
    let stdout = v["stdout"].as_str().unwrap_or_default();
    if v["ok"].as_bool() == Some(true) {
        return Ok(json!({"result": v["result"], "stdout": stdout}));
    }
    let error = v["error"].as_str().unwrap_or("failed");
    Err(if stdout.is_empty() { error.to_string() } else { format!("{error}\nstdout:\n{stdout}") })
}

pub struct RunCode;

impl Tool for RunCode {
    fn name(&self) -> String {
        "run_code".into()
    }
    fn description(&self) -> String {
        "run a program in the browser's sandbox (no files, no network); gives the value of its last expression and what it printed".into()
    }
    fn args(&self) -> Value {
        json!({"language": "js | python", "code": "text", "timeout_ms": "number, optional"})
    }
    fn invoke(&self, args: Value, _: Toolbox) -> Fut<Result<Value, String>> {
        let language = args["language"].as_str().unwrap_or("js").to_string();
        let code = args["code"].as_str().unwrap_or_default().to_string();
        let timeout = args["timeout_ms"].as_u64().unwrap_or(TIMEOUT_MS).clamp(1, MAX_TIMEOUT_MS) as u32;
        if code.trim().is_empty() {
            return Box::pin(async { Err("no code".into()) });
        }
        on_tab(run(language, code, timeout))
    }
}

/// The tools only a tab can offer.
pub fn tools() -> Vec<Arc<dyn Tool>> {
    vec![Arc::new(RunCode)]
}
