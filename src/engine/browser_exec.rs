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

    // Register the live worker with the process registry so the Workspace run
    // panel can list and kill it. The on_kill closure is idempotent (per the
    // registry contract): the oneshot sender fires at most once and
    // `Worker::terminate()` tolerates an already-terminated worker. Killing
    // resolves the race below immediately with a clear "killed" error.
    let tx_kill = Rc::clone(&tx_cell);
    let worker_kill = worker.clone();
    let process_id = crate::engine::process_registry::register(
        run_js_label(code),
        "js",
        Box::new(move || {
            if let Some(tx) = tx_kill.borrow_mut().take() {
                let _ = tx.send(Err("Process killed from the run panel.".to_string()));
            }
            worker_kill.terminate();
        }),
    );

    // Race the worker's reply against the timeout. Either outcome terminates the
    // worker; the closures stay alive on the stack until after the await.
    let timeout = gloo_timers::future::TimeoutFuture::new(timeout_ms);
    let outcome = futures_util::future::select(rx, timeout).await;
    worker.terminate();
    // Completion path: a no-op if the run panel already killed this process.
    crate::engine::process_registry::unregister(process_id);
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

/// Process-registry label for a `run_js` invocation: the first non-empty line
/// of the code, truncated, or a generic fallback for blank snippets.
// Used by the wasm registration path above; kept target-neutral so the host
// unit tests cover it.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
fn run_js_label(code: &str) -> String {
    const MAX_LABEL_CHARS: usize = 48;
    let line = code
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("run_js snippet");
    if line.chars().count() > MAX_LABEL_CHARS {
        let truncated: String = line.chars().take(MAX_LABEL_CHARS).collect();
        format!("{truncated}…")
    } else {
        line.to_string()
    }
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
    fn run_js_label_uses_first_nonempty_line_and_truncates() {
        assert_eq!(run_js_label("\n  console.log(1);\nmore"), "console.log(1);");
        assert_eq!(run_js_label("   \n\t\n"), "run_js snippet");
        let long = "x".repeat(80);
        let label = run_js_label(&long);
        assert!(label.ends_with('…'));
        assert_eq!(label.chars().count(), 49);
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
