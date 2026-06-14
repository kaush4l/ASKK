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
//! The default implementation is
//! [`WasiShimExecutor`](crate::engine::wasi_exec::WasiShimExecutor), which runs
//! a single `wasm32-wasip1` binary in a disposable Web Worker under a tiny WASI
//! shim. Adding another substrate (container2wasm, the bridge as a fallback) is
//! one new `impl BrowserExecutor`, never a loop edit.
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
    // Seam API: the constructor a substrate uses to report a clean run. Runtime
    // replies arrive via `from_worker_json`, so this has no in-tree caller beyond
    // tests; kept as public seam API.
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
/// [`run_command`](BrowserExecutor::run_command); the workspace shell's
/// `run <file.wasm>` built-in and the `run_python` runtime depend only on this
/// trait, so swapping substrates is one new `impl`, never a change to the loop.
///
/// Implementations must honor [`ExecRequest::effective_timeout_ms`] as a hard
/// limit and must treat the command's output strictly as returned DATA.
#[async_trait::async_trait(?Send)]
pub trait BrowserExecutor {
    /// Run one command and return its structured result. Transport/spawn failures
    /// are `Err`; a command that ran but exited non-zero is `Ok` with `ok: false`.
    async fn run_command(&self, req: ExecRequest) -> AppResult<ExecResponse>;
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
        // The envelope shape every backend worker posts back.
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
    fn transcript_includes_exit_code_and_streams() {
        let resp = ExecResponse::success("out", "warn");
        let text = resp.to_transcript();
        assert!(text.contains("exit_code: 0"));
        assert!(text.contains("ok: true"));
        assert!(text.contains("stdout:\nout"));
        assert!(text.contains("stderr:\nwarn"));
    }
}
