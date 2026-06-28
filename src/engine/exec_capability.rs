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

// === Hosted-binary environment descriptor ===================================
//
// A WASI binary is compiled *to an environment*: it expects a particular
// filesystem layout (e.g. a stdlib zip at a fixed mount), environment
// variables, and possibly a slow first-fetch of a multi-MB runtime. The Python
// runtime today hand-builds all of that as bespoke code. [`BinaryEnv`] lifts it
// into declarative DATA so adding a new hosted binary is a descriptor, never a
// new worker code path: the WASI runner reads the descriptor, fetches the wasm
// (cache-first), lays out the mounts, sets the env, and honors the ready
// protocol — all from these fields.

/// Where a hosted binary's `.wasm` (or a mounted asset) comes from.
///
/// `Asset`/`Url` are fetched by the worker (cache-first when a `cache_key` is
/// set on the owning [`BinaryEnv`]); `VfsPath` is read out of the project
/// filesystem by the host and shipped to the worker as bytes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind", content = "value")]
pub enum BinarySource {
    /// A bundled app asset URL (e.g. `/assets/runtimes/coreutils/wc.wasm`). The
    /// content-hashed URL is fetched by the worker, cache-first.
    Asset(String),
    /// An absolute http(s) URL the worker fetches at run time.
    Url(String),
    /// A path inside the project virtual filesystem; the host reads the bytes.
    VfsPath(String),
}

/// One extra file or directory to mount into the sandbox filesystem before the
/// run — the declarative form of Python's "mount the stdlib zip at
/// `/lib/python314.zip`" step. The `at` path is sandbox-absolute (leading `/`
/// optional); intermediate directories are created. The top-level segment of
/// `at` is reserved: workspace seed files under it are skipped so the guest's
/// environment is never clobbered by user data.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BinaryMount {
    /// Sandbox-absolute destination path for the mounted file (e.g.
    /// `lib/python314.zip`).
    pub at: String,
    /// Where the mounted bytes come from.
    pub source: BinarySource,
}

impl BinaryMount {
    /// The reserved top-level sandbox segment this mount occupies (e.g. `lib`
    /// for `lib/python314.zip`). Workspace seed files under it are skipped.
    // Used by the wasm worker driver (via `reserved_segments`) and host tests;
    // the host build never drives a run, so it is dead there.
    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    pub fn reserved_segment(&self) -> Option<&str> {
        self.at
            .split('/')
            .find(|segment| !segment.is_empty() && *segment != ".")
    }
}

/// A declarative description of the environment a hosted WASI binary needs.
///
/// This is the data the WASI runner consumes to host a binary generally:
/// `{ name, wasm source, mounts, env, ready protocol, cache key }`. Adding a
/// second hosted binary is one of these, not new bespoke worker code. The
/// Python runtime is the proof-of-concept this generalizes (a `python` binary
/// with a stdlib-zip mount, `PYTHONHOME=/`, the ready protocol, and an
/// `askk-runtimes` cache key); the runner ships a separate hosted util to show
/// the path is not Python-specific.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BinaryEnv {
    /// The command name that selects this binary (e.g. `wc`), and `argv[0]`.
    pub name: String,
    /// Where the binary itself comes from.
    pub wasm: BinarySource,
    /// Extra files/dirs mounted into the sandbox before the run (stdlib zips,
    /// data files, …). Empty for a self-contained binary.
    #[serde(default)]
    pub mounts: Vec<BinaryMount>,
    /// Environment variables to export to the guest, as `(key, value)` pairs.
    #[serde(default)]
    pub env: Vec<(String, String)>,
    /// When true, the worker posts `{"phase":"ready"}` after the (possibly slow)
    /// fetch + compile and before running, so a cold first download does not eat
    /// the run timeout. Set this for multi-MB runtimes; leave false for small,
    /// already-bundled utilities.
    #[serde(default)]
    pub ready_protocol: bool,
    /// Cache-Storage cache name for the hosted wasm + mounted assets. `Some`
    /// turns on cache-first fetching (download once per deploy); `None` fetches
    /// fresh every run (fine for tiny binaries). Mirrors `askk-runtimes`.
    #[serde(default)]
    pub cache_key: Option<String>,
}

impl BinaryEnv {
    /// The reserved top-level sandbox segments this environment occupies via its
    /// mounts. Workspace seed files under any of these are skipped so they never
    /// clobber the guest's environment (the generalization of Python's reserved
    /// `lib/` rule).
    // Used by the wasm worker driver and host tests; dead on the host build.
    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    pub fn reserved_segments(&self) -> Vec<String> {
        self.mounts
            .iter()
            .filter_map(|mount| mount.reserved_segment().map(str::to_string))
            .collect()
    }

    /// The JSON message fields a hosted-binary run adds to the WASI runner
    /// request: the descriptor's mounts, env, ready flag, and cache key. The
    /// wasm source itself is attached by the host (bytes for a VFS binary, or a
    /// `wasm_url`), so it is not duplicated here. Pure, so the protocol shape is
    /// locked down by host tests.
    // Used by the wasm worker driver (via `build_message_base`) and host tests;
    // dead on the host build.
    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    pub fn to_message_fields(&self) -> Value {
        let mounts: Vec<Value> = self
            .mounts
            .iter()
            .map(|mount| {
                let mut entry = serde_json::json!({ "at": mount.at });
                attach_source(&mut entry, "mount", &mount.source);
                entry
            })
            .collect();
        let env: Vec<Value> = self
            .env
            .iter()
            .map(|(key, value)| serde_json::json!({ "key": key, "value": value }))
            .collect();
        serde_json::json!({
            "name": self.name,
            "mounts": mounts,
            "env": env,
            "ready_protocol": self.ready_protocol,
            "cache_key": self.cache_key,
        })
    }
}

/// Attach a [`BinarySource`] onto a worker-message object as a `<prefix>_url`
/// (for `Asset`/`Url`, which the worker fetches) — `VfsPath` sources carry no
/// URL because the host has already read and attached their bytes.
// Used by the wasm worker driver (via `to_message_fields`) and host tests; dead
// on the host build.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
fn attach_source(entry: &mut Value, prefix: &str, source: &BinarySource) {
    let url = match source {
        BinarySource::Asset(url) | BinarySource::Url(url) => Some(url.clone()),
        BinarySource::VfsPath(_) => None,
    };
    if let (Some(url), Some(map)) = (url, entry.as_object_mut()) {
        map.insert(format!("{prefix}_url"), Value::String(url));
    }
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

    // --- BinaryEnv descriptor ---------------------------------------------------

    fn python_like_env() -> BinaryEnv {
        // The Python runtime modeled as a descriptor: the proof that BinaryEnv
        // generalizes the bespoke setup. (Python itself is not migrated.)
        BinaryEnv {
            name: "python".to_string(),
            wasm: BinarySource::Asset("/assets/runtimes/python/python.wasm".to_string()),
            mounts: vec![BinaryMount {
                at: "lib/python314.zip".to_string(),
                source: BinarySource::Asset(
                    "/assets/runtimes/python/python-stdlib.zip".to_string(),
                ),
            }],
            env: vec![("PYTHONHOME".to_string(), "/".to_string())],
            ready_protocol: true,
            cache_key: Some("askk-runtimes".to_string()),
        }
    }

    #[test]
    fn binary_env_round_trips_through_json() {
        let env = python_like_env();
        let text = serde_json::to_string(&env).expect("serialize descriptor");
        let parsed: BinaryEnv = serde_json::from_str(&text).expect("deserialize descriptor");
        assert_eq!(parsed, env);
    }

    #[test]
    fn binary_source_tag_shape_is_stable() {
        // The (de)serialized shape is part of the descriptor contract.
        let value = serde_json::to_value(BinarySource::Asset("/a/b.wasm".to_string()))
            .expect("serialize source");
        assert_eq!(value, json!({ "kind": "asset", "value": "/a/b.wasm" }));
        let vfs = serde_json::to_value(BinarySource::VfsPath("tool.wasm".to_string()))
            .expect("serialize vfs");
        assert_eq!(vfs, json!({ "kind": "vfs_path", "value": "tool.wasm" }));
    }

    #[test]
    fn reserved_segments_mirror_pythons_lib_rule() {
        let env = python_like_env();
        assert_eq!(env.reserved_segments(), vec!["lib".to_string()]);
        // A self-contained binary reserves nothing.
        let bare = BinaryEnv {
            name: "wc".to_string(),
            wasm: BinarySource::Asset("/assets/wc.wasm".to_string()),
            mounts: vec![],
            env: vec![],
            ready_protocol: false,
            cache_key: None,
        };
        assert!(bare.reserved_segments().is_empty());
    }

    #[test]
    fn to_message_fields_carries_mounts_env_and_flags() {
        let fields = python_like_env().to_message_fields();
        assert_eq!(fields["name"], "python");
        assert_eq!(fields["ready_protocol"], true);
        assert_eq!(fields["cache_key"], "askk-runtimes");
        // The mount is a fetchable asset → a mount_url, plus its target path.
        assert_eq!(fields["mounts"][0]["at"], "lib/python314.zip");
        assert_eq!(
            fields["mounts"][0]["mount_url"],
            "/assets/runtimes/python/python-stdlib.zip"
        );
        assert_eq!(fields["env"][0]["key"], "PYTHONHOME");
        assert_eq!(fields["env"][0]["value"], "/");
    }

    #[test]
    fn to_message_fields_omits_url_for_vfs_mounts() {
        // A VFS-sourced mount carries no URL: the host attaches its bytes.
        let env = BinaryEnv {
            name: "tool".to_string(),
            wasm: BinarySource::Asset("/assets/tool.wasm".to_string()),
            mounts: vec![BinaryMount {
                at: "data/seed.bin".to_string(),
                source: BinarySource::VfsPath("seed.bin".to_string()),
            }],
            env: vec![],
            ready_protocol: false,
            cache_key: None,
        };
        let fields = env.to_message_fields();
        assert_eq!(fields["mounts"][0]["at"], "data/seed.bin");
        assert!(fields["mounts"][0].get("mount_url").is_none());
        assert_eq!(fields["cache_key"], Value::Null);
    }
}
