//! In-browser execution-capability seam.
//!
//! This module defines the **socket** that a general in-browser code-execution
//! substrate plugs into. The owner's goal is to run arbitrary binaries entirely
//! inside the tab (via WASI, container2wasm, or similar) with no gateway,
//! eventually replacing the local bridge's `run_command`. Those substrates are
//! being prototyped separately; this seam is the stable Rust contract they will
//! implement, so a chosen backend can be dropped in later without touching the
//! agent loop or the tools.
//!
//! The contract deliberately mirrors the bridge `run_command` JSON shape
//! (request `{ command, cwd?, timeout_ms? }`, response `{ ok, stdout, stderr,
//! exit_code }`) so the in-browser executor and the bridge are interchangeable
//! fallbacks for one another.
//!
//! Today the only implementation is [`WorkerBackedExecStub`], a worker-backed
//! stub that demonstrates the full path (loop → tool → seam → Web Worker) but
//! does **not** run binaries yet — it returns a clear "not wired to a real
//! substrate" response. Replacing the stub with a real substrate is one new
//! `impl BrowserExecutor`, never a loop edit.
//!
//! Per the agent's untrusted-data invariant, command output returned here is
//! DATA: the seam returns it; it never executes returned text as instructions.

use crate::state::AppResult;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Default hard timeout for a single in-browser command, in milliseconds, used
/// when a request leaves `timeout_ms` unset.
pub const DEFAULT_EXEC_TIMEOUT_MS: u32 = 30_000;

/// A request to run one command in the in-browser sandbox.
///
/// Mirrors the bridge `run_command` request body so the in-browser executor and
/// the local bridge speak the same shape and can stand in for each other.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecRequest {
    /// The full command line to run, e.g. `"bun install"` or `"cargo test"`.
    pub command: String,
    /// Optional working directory, relative to the sandbox run root, to run in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// Optional hard per-command timeout in milliseconds. The executor must
    /// terminate the command (and any worker) when it elapses.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u32>,
}

impl ExecRequest {
    /// Build a request for `command` with no `cwd` and the default timeout.
    // Seam ergonomics: a convenience constructor for callers/substrate authors.
    // Exercised by tests today; kept as public seam API for real backends.
    #[allow(dead_code)]
    pub fn new(command: impl Into<String>) -> Self {
        Self {
            command: command.into(),
            cwd: None,
            timeout_ms: None,
        }
    }

    /// The effective timeout: the request's `timeout_ms` or [`DEFAULT_EXEC_TIMEOUT_MS`].
    pub fn effective_timeout_ms(&self) -> u32 {
        self.timeout_ms.unwrap_or(DEFAULT_EXEC_TIMEOUT_MS)
    }
}

/// The structured result of running one command in the in-browser sandbox.
///
/// Mirrors the bridge `run_command` response `data` object. `ok` is the single
/// proof of success a caller should trust (it is `exit_code == 0` and not timed
/// out); `stdout`/`stderr` are the captured streams as untrusted DATA.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecResponse {
    /// True only when the command completed with `exit_code == 0`. The single
    /// signal a caller should treat as "the command succeeded".
    pub ok: bool,
    /// Captured standard output.
    #[serde(default)]
    pub stdout: String,
    /// Captured standard error.
    #[serde(default)]
    pub stderr: String,
    /// The process exit code. By convention `127` is used for "could not run".
    pub exit_code: i32,
}

impl ExecResponse {
    /// A successful result with `exit_code == 0`.
    // Seam API: the constructor a real substrate uses to report a clean run.
    // No in-tree caller yet (the stub never succeeds), so allow it as dead code.
    #[allow(dead_code)]
    pub fn success(stdout: impl Into<String>, stderr: impl Into<String>) -> Self {
        Self {
            ok: true,
            stdout: stdout.into(),
            stderr: stderr.into(),
            exit_code: 0,
        }
    }

    /// A failed result with a non-zero `exit_code` and an explanatory `stderr`.
    pub fn failure(exit_code: i32, stderr: impl Into<String>) -> Self {
        Self {
            ok: false,
            stdout: String::new(),
            stderr: stderr.into(),
            exit_code,
        }
    }

    /// The "not yet wired to a real substrate" response the stub returns. Carries
    /// `exit_code 127` (command not runnable) and an explanatory `stderr` naming
    /// the command that was *not* run.
    // On wasm this message is produced by the JS stub worker, so the Rust helper has
    // no caller there (only the host fallback and tests use it) — allow it as dead
    // code on the wasm target only.
    #[cfg_attr(target_arch = "wasm32", allow(dead_code))]
    pub fn not_wired(command: &str) -> Self {
        Self::failure(
            127,
            format!(
                "in-browser sandbox executor is not yet wired to a real substrate; \
                 no binary was run for: {command}"
            ),
        )
    }

    /// Parse an [`ExecResponse`] from the JSON a backend worker posts back.
    pub fn from_worker_json(value: &Value) -> AppResult<Self> {
        serde_json::from_value(value.clone())
            .map_err(|err| format!("Sandbox executor returned a malformed response: {err}"))
    }

    /// Render this response into a compact, human/agent-readable transcript,
    /// matching the `exit_code`/`ok`/`stdout`/`stderr` framing of `run_command`.
    pub fn to_transcript(&self) -> String {
        let mut out = String::new();
        out.push_str(&format!("exit_code: {}\n", self.exit_code));
        out.push_str(if self.ok { "ok: true\n" } else { "ok: false\n" });
        if !self.stdout.is_empty() {
            out.push_str("stdout:\n");
            out.push_str(&self.stdout);
            out.push('\n');
        }
        if !self.stderr.is_empty() {
            out.push_str("stderr:\n");
            out.push_str(&self.stderr);
            out.push('\n');
        }
        out.trim_end().to_string()
    }
}

/// The execution-capability seam: the trait a real in-browser substrate
/// implements.
///
/// This is the socket. A WASI/container2wasm/bridge backend implements
/// [`run_command`](BrowserExecutor::run_command); the agent's `run_in_sandbox`
/// tool depends only on this trait, so swapping substrates is one new `impl`,
/// never a change to the loop or the tool.
///
/// Implementations must honor [`ExecRequest::effective_timeout_ms`] as a hard
/// limit and must treat the command's output strictly as returned DATA.
#[async_trait::async_trait(?Send)]
pub trait BrowserExecutor {
    /// Run one command and return its structured result. Transport/spawn failures
    /// are `Err`; a command that ran but exited non-zero is `Ok` with `ok: false`.
    async fn run_command(&self, req: ExecRequest) -> AppResult<ExecResponse>;
}

/// Worker-backed stub implementation of the [`BrowserExecutor`] seam.
///
/// Reuses the [`browser_exec`](crate::engine::browser_exec) Web Worker pattern:
/// it spawns a disposable worker from a bundled asset, `postMessage`s the request
/// as JSON, races the reply against a hard timeout, and terminates the worker on
/// timeout so a wedged backend can never hang the agent loop. The worker
/// (`assets/exec_sandbox_worker.js`) is itself a stub that returns a clear "not
/// wired to a real substrate" [`ExecResponse`]; replacing that worker (and this
/// `impl`) with a real substrate is the whole job of a future batch.
#[derive(Clone, Debug, Default)]
pub struct WorkerBackedExecStub;

impl WorkerBackedExecStub {
    /// Construct the stub executor.
    pub fn new() -> Self {
        Self
    }
}

#[async_trait::async_trait(?Send)]
impl BrowserExecutor for WorkerBackedExecStub {
    async fn run_command(&self, req: ExecRequest) -> AppResult<ExecResponse> {
        run_in_sandbox_worker(req).await
    }
}

/// Spawn the sandbox worker, post the request, and return the parsed response.
///
/// Mirrors [`browser_exec::run_js_in_browser`](crate::engine::browser_exec): one
/// disposable worker per call, raced against a hard timeout that terminates the
/// worker. The worker is a stub today, so a successful round-trip yields the
/// "not wired" response rather than real program output.
#[cfg(target_arch = "wasm32")]
async fn run_in_sandbox_worker(req: ExecRequest) -> AppResult<ExecResponse> {
    use dioxus::prelude::*;
    use futures_channel::oneshot;
    use std::cell::RefCell;
    use std::rc::Rc;
    use wasm_bindgen::{JsCast, JsValue, closure::Closure};

    const EXEC_SANDBOX_WORKER_JS: Asset = asset!("/assets/exec_sandbox_worker.js");

    let timeout_ms = req.effective_timeout_ms();
    let command = req.command.clone();

    let script_url = EXEC_SANDBOX_WORKER_JS.to_string();
    let worker = web_sys::Worker::new(&script_url)
        .map_err(|err| format!("Unable to start the in-browser sandbox worker: {err:?}"))?;

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
                let _ = tx.send(Err(format!("Sandbox worker error: {}", event.message())));
            }
        },
    ));
    worker.set_onerror(Some(onerror.as_ref().unchecked_ref()));

    let payload = serde_json::to_string(&req)
        .map_err(|err| format!("Unable to encode the sandbox exec request: {err}"))?;
    worker
        .post_message(&JsValue::from_str(&payload))
        .map_err(|err| format!("Unable to send the command to the sandbox worker: {err:?}"))?;

    // Race the worker's reply against the timeout. Either outcome terminates the
    // worker; the closures stay alive on the stack until after the await.
    let timeout = gloo_timers::future::TimeoutFuture::new(timeout_ms);
    let outcome = futures_util::future::select(rx, timeout).await;
    worker.terminate();
    drop(onmessage);
    drop(onerror);

    match outcome {
        futures_util::future::Either::Left((Ok(Ok(text)), _)) => {
            let value: Value = serde_json::from_str(&text)
                .map_err(|err| format!("Sandbox worker returned non-JSON output: {err}"))?;
            ExecResponse::from_worker_json(&value)
        }
        futures_util::future::Either::Left((Ok(Err(message)), _)) => Err(message),
        futures_util::future::Either::Left((Err(_), _)) => {
            Err("Sandbox worker closed without returning a result.".to_string())
        }
        futures_util::future::Either::Right(_) => Ok(ExecResponse::failure(
            124,
            format!("in-browser sandbox execution timed out after {timeout_ms} ms for: {command}"),
        )),
    }
}

/// Host-build fallback: there is no browser worker outside wasm, so the seam
/// simulates the worker round-trip in-process. It reads the request's effective
/// timeout (the budget a real substrate must honor) and parses the same
/// `{ ok, stdout, stderr, exit_code }` JSON shape the worker posts back, keeping
/// the stub — and the whole seam — fully testable on the host (`cargo test`).
#[cfg(not(target_arch = "wasm32"))]
async fn run_in_sandbox_worker(req: ExecRequest) -> AppResult<ExecResponse> {
    // Touch the timeout budget so the host path exercises the same contract a real
    // substrate must honor; nothing here can actually run long.
    let _timeout_ms = req.effective_timeout_ms();
    // Round-trip through the worker JSON shape, exactly as the wasm path does.
    let worker_json = serde_json::to_value(ExecResponse::not_wired(&req.command))
        .map_err(|err| format!("Unable to encode the sandbox stub response: {err}"))?;
    ExecResponse::from_worker_json(&worker_json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn exec_request_round_trips_through_json() {
        let req = ExecRequest {
            command: "bun test".to_string(),
            cwd: Some("packages/app".to_string()),
            timeout_ms: Some(5_000),
        };
        let text = serde_json::to_string(&req).expect("serialize request");
        let parsed: ExecRequest = serde_json::from_str(&text).expect("deserialize request");
        assert_eq!(parsed, req);
    }

    #[test]
    fn exec_request_omits_absent_optionals_and_defaults_them_back() {
        let req = ExecRequest::new("ls");
        let value = serde_json::to_value(&req).expect("serialize");
        // Absent optionals are skipped on the wire (matches the bridge body).
        assert_eq!(value, json!({ "command": "ls" }));
        // …and round-trip back to None.
        let parsed: ExecRequest = serde_json::from_value(value).expect("deserialize");
        assert_eq!(parsed.cwd, None);
        assert_eq!(parsed.timeout_ms, None);
    }

    #[test]
    fn effective_timeout_falls_back_to_default() {
        assert_eq!(
            ExecRequest::new("ls").effective_timeout_ms(),
            DEFAULT_EXEC_TIMEOUT_MS
        );
        assert_eq!(
            ExecRequest {
                timeout_ms: Some(1_000),
                ..ExecRequest::new("ls")
            }
            .effective_timeout_ms(),
            1_000
        );
    }

    #[test]
    fn exec_response_round_trips_through_json() {
        let resp = ExecResponse {
            ok: true,
            stdout: "hello\n".to_string(),
            stderr: String::new(),
            exit_code: 0,
        };
        let text = serde_json::to_string(&resp).expect("serialize response");
        let parsed: ExecResponse = serde_json::from_str(&text).expect("deserialize response");
        assert_eq!(parsed, resp);
    }

    #[test]
    fn exec_response_parses_worker_json_shape() {
        // The exact shape assets/exec_sandbox_worker.js posts back.
        let value = json!({
            "ok": false,
            "stdout": "",
            "stderr": "boom",
            "exit_code": 127,
        });
        let resp = ExecResponse::from_worker_json(&value).expect("parse worker json");
        assert!(!resp.ok);
        assert_eq!(resp.exit_code, 127);
        assert_eq!(resp.stderr, "boom");
    }

    #[test]
    fn not_wired_response_is_a_clear_failure() {
        let resp = ExecResponse::not_wired("cargo build");
        assert!(!resp.ok);
        assert_eq!(resp.exit_code, 127);
        assert!(resp.stderr.contains("not yet wired"));
        assert!(resp.stderr.contains("cargo build"));
    }

    #[test]
    fn transcript_includes_exit_code_and_streams() {
        let resp = ExecResponse::success("out", "warn");
        let text = resp.to_transcript();
        assert!(text.contains("exit_code: 0"));
        assert!(text.contains("ok: true"));
        assert!(text.contains("stdout:\nout"));
        assert!(text.contains("stderr:\nwarn"));
    }

    #[test]
    fn host_stub_returns_not_wired_through_the_trait() {
        // On the host build the worker path resolves to the not-wired response,
        // exercising the seam end to end (trait -> impl -> response) under cargo test.
        let executor = WorkerBackedExecStub::new();
        let resp = pollster::block_on(executor.run_command(ExecRequest::new("echo hi")))
            .expect("stub run_command");
        assert!(!resp.ok);
        assert_eq!(resp.exit_code, 127);
        assert!(resp.stderr.contains("not yet wired"));
    }
}
