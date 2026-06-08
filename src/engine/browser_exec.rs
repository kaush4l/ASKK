//! In-browser code execution capability.
//!
//! Runs JavaScript natively in the browser inside a dedicated, disposable Web
//! Worker (`assets/exec_worker.js`) — no local bridge, no native runtime. This is
//! the browser-native replacement for shelling out to `bun`/`node`: the agent's
//! `run_js` tool and the Workspace "Run" button both call
//! [`run_js_in_browser`]. The coordinator enforces a hard timeout by terminating
//! the worker, which also isolates the executed code from the agent's own scope.

use crate::state::AppResult;
use serde_json::Value;

/// Run a snippet of JavaScript in a sandboxed browser Web Worker and return the
/// structured `{ ok, result, stdout, stderr, error }` result. `timeout_ms` is a
/// hard limit: when it elapses the worker is terminated and a timeout error is
/// returned, so a runaway script can never wedge the agent loop.
#[cfg(target_arch = "wasm32")]
pub async fn run_js_in_browser(code: &str, timeout_ms: u32) -> AppResult<Value> {
    use dioxus::prelude::*;
    use futures_channel::oneshot;
    use std::cell::RefCell;
    use std::rc::Rc;
    use wasm_bindgen::{JsCast, JsValue, closure::Closure};

    const EXEC_WORKER_JS: Asset = asset!("/assets/exec_worker.js");

    let script_url = EXEC_WORKER_JS.to_string();
    let worker = web_sys::Worker::new(&script_url)
        .map_err(|err| format!("Unable to start the in-browser exec worker: {err:?}"))?;

    let (tx, rx) = oneshot::channel::<AppResult<String>>();
    let tx_cell = Rc::new(RefCell::new(Some(tx)));

    let tx_msg = Rc::clone(&tx_cell);
    let onmessage = Closure::<dyn FnMut(web_sys::MessageEvent)>::wrap(Box::new(
        move |event: web_sys::MessageEvent| {
            let text = event.data().as_string().unwrap_or_default();
            if let Some(tx) = tx_msg.borrow_mut().take() {
                let _ = tx.send(Ok(text));
            }
        },
    ));
    worker.set_onmessage(Some(onmessage.as_ref().unchecked_ref()));

    let tx_err = Rc::clone(&tx_cell);
    let onerror = Closure::<dyn FnMut(web_sys::ErrorEvent)>::wrap(Box::new(
        move |event: web_sys::ErrorEvent| {
            if let Some(tx) = tx_err.borrow_mut().take() {
                let _ = tx.send(Err(format!("Exec worker error: {}", event.message())));
            }
        },
    ));
    worker.set_onerror(Some(onerror.as_ref().unchecked_ref()));

    let payload = serde_json::json!({ "code": code }).to_string();
    worker
        .post_message(&JsValue::from_str(&payload))
        .map_err(|err| format!("Unable to send code to the exec worker: {err:?}"))?;

    // Race the worker's reply against the timeout. Either outcome terminates the
    // worker; the closures stay alive on the stack until after the await.
    let timeout = gloo_timers::future::TimeoutFuture::new(timeout_ms);
    let outcome = futures_util::future::select(rx, timeout).await;
    worker.terminate();
    // Keep the event handlers alive until the worker is done with them.
    drop(onmessage);
    drop(onerror);

    match outcome {
        futures_util::future::Either::Left((Ok(Ok(text)), _)) => {
            serde_json::from_str::<Value>(&text)
                .map_err(|err| format!("Exec worker returned non-JSON output: {err}"))
        }
        futures_util::future::Either::Left((Ok(Err(message)), _)) => Err(message),
        futures_util::future::Either::Left((Err(_), _)) => {
            Err("Exec worker closed without returning a result.".to_string())
        }
        futures_util::future::Either::Right(_) => Err(format!(
            "In-browser execution timed out after {timeout_ms} ms."
        )),
    }
}

/// Host-build fallback: there is no browser worker outside wasm.
#[cfg(not(target_arch = "wasm32"))]
pub async fn run_js_in_browser(_code: &str, _timeout_ms: u32) -> AppResult<Value> {
    Err("In-browser JavaScript execution is only available in the browser runtime.".to_string())
}

/// Render a `run_js` result value into a compact, human/agent-readable transcript.
/// Returns `(ok, text)` so callers can map a failed run onto a failed tool result.
pub fn format_run_js(value: &Value) -> (bool, String) {
    let ok = value.get("ok").and_then(Value::as_bool).unwrap_or(false);
    let stdout = value.get("stdout").and_then(Value::as_str).unwrap_or("");
    let stderr = value.get("stderr").and_then(Value::as_str).unwrap_or("");
    let error = value.get("error").and_then(Value::as_str).unwrap_or("");
    let result = value.get("result");

    let mut out = String::new();
    out.push_str(if ok { "ok: true\n" } else { "ok: false\n" });
    if !stdout.is_empty() {
        out.push_str("stdout:\n");
        out.push_str(stdout);
        out.push('\n');
    }
    if !stderr.is_empty() {
        out.push_str("stderr:\n");
        out.push_str(stderr);
        out.push('\n');
    }
    match result {
        Some(Value::Null) | None => {}
        Some(Value::String(text)) => {
            out.push_str("result: ");
            out.push_str(text);
            out.push('\n');
        }
        Some(other) => {
            out.push_str("result: ");
            out.push_str(&other.to_string());
            out.push('\n');
        }
    }
    if !error.is_empty() {
        out.push_str("error:\n");
        out.push_str(error);
        out.push('\n');
    }
    (ok, out.trim_end().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_successful_run_with_stdout_and_result() {
        let value = serde_json::json!({
            "ok": true,
            "stdout": "hello",
            "stderr": "",
            "result": 5,
            "error": ""
        });
        let (ok, text) = format_run_js(&value);
        assert!(ok);
        assert!(text.contains("ok: true"));
        assert!(text.contains("stdout:\nhello"));
        assert!(text.contains("result: 5"));
    }

    #[test]
    fn formats_failed_run_with_error() {
        let value = serde_json::json!({
            "ok": false,
            "stdout": "",
            "stderr": "warn line",
            "result": null,
            "error": "ReferenceError: x is not defined"
        });
        let (ok, text) = format_run_js(&value);
        assert!(!ok);
        assert!(text.contains("ok: false"));
        assert!(text.contains("error:\nReferenceError"));
    }
}
