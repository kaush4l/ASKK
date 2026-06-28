//! WASI tiny-shim execution substrate — the first real backend for the
//! execution-capability seam ([`crate::engine::exec_capability`]).
//!
//! [`WasiShimExecutor`] runs a single `wasm32-wasip1` binary entirely inside the
//! tab: it parses the request's command line (first token = path to a `.wasm`
//! binary, rest = argv), ships the binary plus the workspace files to a
//! disposable Web Worker (`assets/wasi_runner_worker.js`, a bun-built bundle of
//! `@bjorn3/browser_wasi_shim` — pure JS, no COOP/COEP headers, gh-pages
//! friendly), and maps the worker's reply back into the seam's [`ExecResponse`].
//!
//! Copy-in/copy-out is the deliberate v1 design: workspace files are seeded into
//! the worker's in-memory `/workspace` before the run, and files the program
//! creates or changes are copied back into the project filesystem afterwards
//! (sync OPFS access handles only work inside dedicated workers, and the Rust
//! side owns the canonical store).
//!
//! The timeout is enforced by the harness: the worker's reply is raced against
//! `timeout_ms` and the worker is terminated either way, so a runaway guest can
//! never wedge the agent loop. Program output (stdout, stderr, written files)
//! is untrusted DATA fed back to the model, never instructions.

use crate::engine::exec_capability::{
    BinaryEnv, BinarySource, BrowserExecutor, ExecRequest, ExecResponse,
};
use crate::state::AppResult;
use serde::Deserialize;
use serde_json::Value;

/// Hard lower bound for a single run, mirroring the bridge `run_command` clamp.
pub const MIN_EXEC_TIMEOUT_MS: u32 = 1_000;
/// Hard upper bound for a single run, mirroring the bridge `run_command` clamp.
pub const MAX_EXEC_TIMEOUT_MS: u32 = 600_000;
/// stdout/stderr are clamped to this many characters each (bridge parity), so a
/// chatty guest cannot blow the model's context or the snapshot size.
pub const MAX_STREAM_CHARS: usize = 60_000;

/// The WASI tiny-shim implementation of the [`BrowserExecutor`] seam.
///
/// Runs one `wasm32-wasip1` binary per call in a disposable Web Worker. See the
/// module docs for the full request/reply lifecycle.
#[derive(Clone, Debug, Default)]
pub struct WasiShimExecutor;

impl WasiShimExecutor {
    /// Construct the executor.
    pub fn new() -> Self {
        Self
    }
}

#[async_trait::async_trait(?Send)]
impl BrowserExecutor for WasiShimExecutor {
    async fn run_command(&self, req: ExecRequest) -> AppResult<ExecResponse> {
        run_wasi_command(req).await
    }
}

/// A parsed sandbox command line: the `.wasm` path plus the full argv (the
/// first argv entry is the wasm path itself, mirroring process conventions).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WasmCommandLine {
    pub wasm_path: String,
    pub argv: Vec<String>,
}

/// Parse an [`ExecRequest::command`] into a [`WasmCommandLine`].
///
/// The command is split on whitespace; the first token must either name a
/// `.wasm` binary (a project-filesystem path or an http(s) URL) **or** match a
/// hosted binary in the [`binary_registry`] (e.g. `wc`). Anything else — a
/// shell command, an unknown native binary — is rejected with a clear error so
/// the model learns what this sandbox can and cannot run.
pub(crate) fn parse_wasm_command_line(command: &str) -> AppResult<WasmCommandLine> {
    let tokens: Vec<String> = command.split_whitespace().map(str::to_string).collect();
    let Some(first) = tokens.first() else {
        return Err(
            "the wasm sandbox needs a command line whose first token is a path to a \
             wasm32-wasip1 .wasm binary, or the name of a hosted binary; got an empty command."
                .to_string(),
        );
    };
    let is_wasm_path = first.to_ascii_lowercase().ends_with(".wasm");
    if !is_wasm_path && lookup_binary_env(first).is_none() {
        let hosted = hosted_binary_names();
        return Err(format!(
            "the wasm sandbox runs a single wasm32-wasip1 binary: the first token must be a \
             path or http(s) URL ending in .wasm, or one of the hosted binaries [{hosted}], \
             got `{first}`. Native commands (shells, package managers, non-wasm binaries) \
             cannot run in the in-browser sandbox; use run_command via the local bridge for those."
        ));
    }
    Ok(WasmCommandLine {
        wasm_path: first.clone(),
        argv: tokens,
    })
}

/// The registry of binaries this runner hosts by name. Adding a new hosted
/// binary is a new [`BinaryEnv`] entry here — declarative DATA — not a new
/// worker code path. The Python runtime is the proof this generalizes; it stays
/// on its own bespoke path for now, but its environment (a stdlib-zip mount,
/// `PYTHONHOME=/`, the ready protocol, the `askk-runtimes` cache) is exactly the
/// shape these descriptors express, so it could later be folded in here.
pub(crate) fn binary_registry() -> Vec<BinaryEnv> {
    vec![
        // `wc` — the 2nd hosted binary, proving the descriptor path beyond
        // Python. A tiny, self-contained util: no mounts, no env, no ready
        // protocol; cached cache-first like every hosted asset.
        BinaryEnv {
            name: "wc".to_string(),
            wasm: BinarySource::Asset(wc_asset_url()),
            mounts: Vec::new(),
            env: Vec::new(),
            ready_protocol: false,
            cache_key: Some(HOSTED_BINARY_CACHE.to_string()),
        },
    ]
}

/// Cache-Storage cache name shared by hosted-binary assets (mirrors the Python
/// runtime's `askk-runtimes`), so each hosted wasm downloads once per deploy.
pub(crate) const HOSTED_BINARY_CACHE: &str = "askk-runtimes";

/// Resolve the `wc.wasm` asset URL. In the browser this is the content-hashed
/// Dioxus asset URL; on the host it is the static asset path (used only by
/// descriptor tests, which never fetch).
fn wc_asset_url() -> String {
    #[cfg(target_arch = "wasm32")]
    {
        use dioxus::prelude::*;
        const WC_WASM: Asset = asset!("/assets/runtimes/coreutils/wc.wasm");
        WC_WASM.to_string()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        "/assets/runtimes/coreutils/wc.wasm".to_string()
    }
}

/// Look up a hosted binary by the command's first token (exact name match).
pub(crate) fn lookup_binary_env(name: &str) -> Option<BinaryEnv> {
    binary_registry().into_iter().find(|env| env.name == name)
}

/// A human-readable list of the hosted binary names, for error messages.
fn hosted_binary_names() -> String {
    binary_registry()
        .iter()
        .map(|env| env.name.clone())
        .collect::<Vec<_>>()
        .join(", ")
}

/// Clamp a requested timeout into the substrate's hard bounds.
pub(crate) fn clamp_timeout_ms(requested: u32) -> u32 {
    requested.clamp(MIN_EXEC_TIMEOUT_MS, MAX_EXEC_TIMEOUT_MS)
}

/// Budget for a hosted binary to fetch + compile its (possibly multi-MB) wasm
/// and post `{"phase":"ready"}` before the run timeout starts. Generous because
/// the very first visit downloads the asset; afterwards Cache Storage makes
/// readiness near-instant. Only consulted when a descriptor sets
/// [`BinaryEnv::ready_protocol`].
#[cfg(target_arch = "wasm32")]
const RUNTIME_READY_BUDGET_MS: u32 = 120_000;

/// Build the base WASI runner worker message (the JSON-friendly fields).
///
/// Always carries `argv`, `env`, `stdin`, and the seeded `files`. When a hosted
/// binary descriptor is given, its declarative fields (`name`, `mounts`, `env`,
/// `ready_protocol`, `cache_key`) are merged in so the worker can lay out the
/// environment from DATA. The wasm bytes / `wasm_url` and any VFS-mount bytes
/// are attached by the caller afterwards (they are not JSON-friendly). Pure, so
/// the protocol shape is locked down by host tests.
// Used by the wasm worker driver and host tests; the host build never drives a
// run, so it is dead there.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub(crate) fn build_message_base(
    argv: &[String],
    files: Vec<Value>,
    env: Option<&BinaryEnv>,
) -> Value {
    let mut message = serde_json::json!({
        "argv": argv,
        "env": {},
        "stdin": "",
        "files": files,
    });
    if let (Some(env), Some(map)) = (env, message.as_object_mut())
        && let Value::Object(fields) = env.to_message_fields()
    {
        for (key, value) in fields {
            map.insert(key, value);
        }
    }
    message
}

/// Whether the parsed command selects a hosted binary that opts into the
/// ready protocol (so the worker's reply may be preceded by `{"phase":"ready"}`).
// Consulted only by the wasm worker driver; the host build never drives a run.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
fn wants_ready_protocol(token: &str) -> bool {
    lookup_binary_env(token)
        .map(|env| env.ready_protocol)
        .unwrap_or(false)
}

/// Clamp a captured stream to [`MAX_STREAM_CHARS`] characters (char-boundary
/// safe). The worker already clamps; this is defense in depth on the
/// trust boundary, since the reply is untrusted data.
pub(crate) fn clamp_stream(text: String) -> String {
    match text.char_indices().nth(MAX_STREAM_CHARS) {
        Some((byte_index, _)) => text[..byte_index].to_string(),
        None => text,
    }
}

/// Normalize the request's optional `cwd` into a clean run-root-relative
/// prefix. Rejects `..` so the run can never escape the workspace root
/// (the same confinement the bridge enforces with `runPath`).
pub(crate) fn normalize_cwd(cwd: Option<&str>) -> AppResult<Option<String>> {
    let Some(raw) = cwd else { return Ok(None) };
    let mut parts = Vec::new();
    for part in raw.trim().split('/') {
        match part {
            "" | "." => continue,
            ".." => {
                return Err(format!(
                    "Sandbox cwd must stay inside the workspace run root; got `{raw}`."
                ));
            }
            other => parts.push(other),
        }
    }
    if parts.is_empty() {
        Ok(None)
    } else {
        Ok(Some(parts.join("/")))
    }
}

/// Normalize a workspace-relative file path. Rejects absolute paths, `..`
/// components, and NUL — used both for the `.wasm` lookup and to sanitize the
/// untrusted `files_out` paths the worker sends back before writing them.
// Called from the wasm runtime path; host builds reach it only from tests.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub(crate) fn normalize_rel_path(path: &str) -> AppResult<String> {
    if path.contains('\0') {
        return Err(format!("Invalid workspace path (contains NUL): {path:?}"));
    }
    let mut parts = Vec::new();
    for part in path.trim().split('/') {
        match part {
            "" | "." => continue,
            ".." => {
                return Err(format!(
                    "Workspace paths must stay inside the run root; got `{path}`."
                ));
            }
            other => parts.push(other),
        }
    }
    if parts.is_empty() {
        Err(format!("Invalid empty workspace path: `{path}`."))
    } else {
        Ok(parts.join("/"))
    }
}

/// Join the optional cwd prefix back onto a run-root-relative path.
// Called from the wasm runtime path; host builds reach it only from tests.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub(crate) fn join_cwd(cwd: Option<&str>, rel: &str) -> String {
    match cwd {
        Some(prefix) => format!("{prefix}/{rel}"),
        None => rel.to_string(),
    }
}

/// Decode standard base64 (with optional `=` padding and ignored line breaks).
///
/// The project's virtual filesystem stores text, so a `.wasm` binary lives
/// there as its base64 encoding; this decodes it without pulling in a crate.
// Called from the wasm runtime path; host builds reach it only from tests.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub(crate) fn decode_base64(input: &str) -> AppResult<Vec<u8>> {
    fn value_of(byte: u8) -> Option<u8> {
        match byte {
            b'A'..=b'Z' => Some(byte - b'A'),
            b'a'..=b'z' => Some(byte - b'a' + 26),
            b'0'..=b'9' => Some(byte - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let mut bytes = Vec::with_capacity(input.len() / 4 * 3);
    let mut buffer: u32 = 0;
    let mut bits: u32 = 0;
    let mut seen_padding = false;
    for ch in input.bytes() {
        if ch.is_ascii_whitespace() {
            continue;
        }
        if ch == b'=' {
            seen_padding = true;
            continue;
        }
        if seen_padding {
            return Err("Invalid base64 content: data after `=` padding.".to_string());
        }
        let Some(value) = value_of(ch) else {
            return Err(format!(
                "Invalid base64 content: unexpected character {:?}.",
                ch as char
            ));
        };
        buffer = (buffer << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            bytes.push((buffer >> bits) as u8);
        }
    }
    Ok(bytes)
}

/// One file the runner worker copied back out of `/workspace` after the run.
/// UTF-8 content travels as `text`; binary content as `base64`.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub(crate) struct RunnerFileOut {
    pub path: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub base64: Option<String>,
}

/// Parse the runner worker's reply into the seam's [`ExecResponse`] (via
/// [`ExecResponse::from_worker_json`], which validates the shared
/// `ok`/`exit_code`/`stdout`/`stderr` envelope) plus the copied-out files.
// Called from the wasm runtime path; host builds reach it only from tests.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub(crate) fn parse_runner_reply(value: &Value) -> AppResult<(ExecResponse, Vec<RunnerFileOut>)> {
    let mut response = ExecResponse::from_worker_json(value)?;
    response.stdout = clamp_stream(response.stdout);
    response.stderr = clamp_stream(response.stderr);
    let files = match value.get("files_out") {
        None | Some(Value::Null) => Vec::new(),
        Some(files) => serde_json::from_value(files.clone())
            .map_err(|err| format!("WASI runner returned malformed files_out: {err}"))?,
    };
    Ok((response, files))
}

/// The response for a run that hit the hard timeout: the worker was terminated,
/// so there is no real exit code — report the conventional `124` with a clear
/// explanation, never `ok`.
// Called from the wasm runtime path; host builds reach it only from tests.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub(crate) fn timeout_response(timeout_ms: u32, command: &str) -> ExecResponse {
    ExecResponse::failure(
        124,
        format!(
            "in-browser WASI execution timed out after {timeout_ms} ms and the sandbox \
             worker was terminated; no exit code or file changes were captured for: {command}"
        ),
    )
}

/// Run one wasm32-wasip1 binary in the WASI runner worker (browser runtime).
///
/// Mirrors the worker lifecycle of
/// [`browser_exec::run_js_in_browser`](crate::engine::browser_exec): one
/// disposable worker per call, the reply raced against a hard timeout, and the
/// worker terminated on either outcome.
#[cfg(target_arch = "wasm32")]
async fn run_wasi_command(req: ExecRequest) -> AppResult<ExecResponse> {
    use dioxus::prelude::*;
    use wasm_bindgen::{JsCast, JsValue, closure::Closure};

    const WASI_RUNNER_WORKER_JS: Asset = asset!("/assets/wasi_runner_worker.js");

    let command_line = parse_wasm_command_line(&req.command)?;
    let cwd = normalize_cwd(req.cwd.as_deref())?;
    let timeout_ms = clamp_timeout_ms(req.effective_timeout_ms());
    let command = req.command.clone();

    // A hosted binary (e.g. `wc`) brings a declarative environment descriptor;
    // a bare `.wasm` path/URL has none (the implicit "raw binary" descriptor).
    let descriptor = lookup_binary_env(&command_line.wasm_path);
    let reserved = descriptor
        .as_ref()
        .map(BinaryEnv::reserved_segments)
        .unwrap_or_default();

    let wasm_source = resolve_wasm_source(cwd.as_deref(), &command_line.wasm_path).await?;
    let vfs_wasm_path = match &wasm_source {
        WasmSource::VfsBytes { vfs_path, .. } => Some(vfs_path.clone()),
        WasmSource::Url(_) => None,
    };
    let files = load_workspace_files(cwd.as_deref(), vfs_wasm_path.as_deref(), &reserved).await?;

    // Build the worker message: the JSON-friendly parts (including any
    // descriptor mounts/env/cache_key) go through serde, the binary travels as a
    // transferable ArrayBuffer alongside them.
    let mut message_json = build_message_base(&command_line.argv, files, descriptor.as_ref());
    if let WasmSource::Url(url) = &wasm_source {
        message_json["wasm_url"] = serde_json::json!(url);
    }
    let message = js_sys::JSON::parse(&message_json.to_string())
        .map_err(|err| format!("Unable to build the WASI runner message: {err:?}"))?;
    let transfer = js_sys::Array::new();
    if let WasmSource::VfsBytes { bytes, .. } = &wasm_source {
        let array = js_sys::Uint8Array::from(bytes.as_slice());
        let buffer = array.buffer();
        js_sys::Reflect::set(&message, &JsValue::from_str("wasm_bytes"), &buffer)
            .map_err(|err| format!("Unable to attach the wasm binary to the message: {err:?}"))?;
        transfer.push(&buffer);
    }

    let script_url = WASI_RUNNER_WORKER_JS.to_string();
    let worker = web_sys::Worker::new(&script_url)
        .map_err(|err| format!("Unable to start the WASI runner worker: {err:?}"))?;

    // mpsc (not oneshot): a hosted binary with the ready protocol may post
    // `{"phase":"ready"}` before its result, so the driver receives 1–2 messages.
    let (tx, mut rx) = futures_channel::mpsc::unbounded::<AppResult<String>>();

    let tx_msg = tx.clone();
    let onmessage = Closure::<dyn FnMut(web_sys::MessageEvent)>::wrap(Box::new(
        move |event: web_sys::MessageEvent| {
            let text = event.data().as_string().unwrap_or_default();
            let _ = tx_msg.unbounded_send(Ok(text));
        },
    ));
    worker.set_onmessage(Some(onmessage.as_ref().unchecked_ref()));

    let tx_err = tx.clone();
    let onerror = Closure::<dyn FnMut(web_sys::ErrorEvent)>::wrap(Box::new(
        move |event: web_sys::ErrorEvent| {
            let _ = tx_err.unbounded_send(Err(format!(
                "WASI runner worker error: {}",
                event.message()
            )));
        },
    ));
    worker.set_onerror(Some(onerror.as_ref().unchecked_ref()));

    // Register with the process registry so the Workspace run panel can list
    // and kill this run. Idempotent per the registry contract: the channel send
    // is a no-op once the run resolved, and `terminate()` tolerates repeats.
    let tx_kill = tx.clone();
    let worker_kill = worker.clone();
    let process_id = crate::engine::process_registry::register(
        format!("run {}", command_line.wasm_path),
        "wasi",
        Box::new(move || {
            let _ = tx_kill.unbounded_send(Err("Process killed from the run panel.".to_string()));
            worker_kill.terminate();
        }),
    );
    drop(tx);

    let wants_ready = wants_ready_protocol(&command_line.wasm_path);
    let outcome = drive_run(
        &worker,
        &message,
        &transfer,
        &mut rx,
        timeout_ms,
        wants_ready,
        &command,
    )
    .await;

    worker.terminate();
    // Completion path: a no-op if the run panel already killed this process.
    crate::engine::process_registry::unregister(process_id);
    drop(onmessage);
    drop(onerror);

    match outcome? {
        Some(text) => {
            let value: Value = serde_json::from_str(&text)
                .map_err(|err| format!("WASI runner worker returned non-JSON output: {err}"))?;
            let (response, files_out) = parse_runner_reply(&value)?;
            store_workspace_files(cwd.as_deref(), &files_out).await?;
            Ok(response)
        }
        None => Ok(timeout_response(timeout_ms, &command)),
    }
}

/// Post the run request and wait for the worker's terminal reply, honoring the
/// optional ready protocol. Returns `Ok(Some(text))` with the result message,
/// `Ok(None)` when the run hit the hard timeout, or `Err` for spawn/transport
/// failures. A `{"phase":"ready"}` message (when `wants_ready`) is consumed and
/// the timeout clock is (re)started on the caller's `timeout_ms`; before ready
/// the more generous [`RUNTIME_READY_BUDGET_MS`] fetch+compile budget applies.
#[cfg(target_arch = "wasm32")]
#[allow(clippy::too_many_arguments)]
async fn drive_run(
    worker: &web_sys::Worker,
    message: &wasm_bindgen::JsValue,
    transfer: &js_sys::Array,
    rx: &mut futures_channel::mpsc::UnboundedReceiver<AppResult<String>>,
    timeout_ms: u32,
    wants_ready: bool,
    command: &str,
) -> AppResult<Option<String>> {
    use futures_util::StreamExt;

    worker
        .post_message_with_transfer(message, transfer)
        .map_err(|err| format!("Unable to send the run request to the WASI worker: {err:?}"))?;

    // Before a ready signal, allow the (possibly multi-MB) fetch+compile budget;
    // a binary with no ready protocol runs straight on `timeout_ms`.
    let mut deadline = if wants_ready {
        RUNTIME_READY_BUDGET_MS
    } else {
        timeout_ms
    };
    let mut ready = !wants_ready;
    loop {
        let timeout = gloo_timers::future::TimeoutFuture::new(deadline);
        match futures_util::future::select(rx.next(), timeout).await {
            futures_util::future::Either::Left((Some(Ok(text)), _)) => {
                if wants_ready && is_ready_phase(&text) {
                    ready = true;
                    deadline = timeout_ms;
                    continue;
                }
                return Ok(Some(text));
            }
            futures_util::future::Either::Left((Some(Err(message)), _)) => return Err(message),
            futures_util::future::Either::Left((None, _)) => {
                return Err("WASI runner worker closed without returning a result.".to_string());
            }
            futures_util::future::Either::Right(_) if ready => {
                return Ok(None); // run timeout (worker terminated by the caller)
            }
            futures_util::future::Either::Right(_) => {
                return Err(format!(
                    "Hosted binary failed to initialize within {RUNTIME_READY_BUDGET_MS} ms \
                     (fetching or compiling its wasm may have failed) for: {command}"
                ));
            }
        }
    }
}

/// Whether a worker message is the `{"phase":"ready"}` signal (best-effort: a
/// malformed message is treated as not-ready and falls through to result parse).
#[cfg(target_arch = "wasm32")]
fn is_ready_phase(text: &str) -> bool {
    serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|value| {
            value
                .get("phase")
                .and_then(Value::as_str)
                .map(|phase| phase == "ready")
        })
        .unwrap_or(false)
}

/// Host-build fallback: there is no browser worker outside wasm. The command
/// line is still parsed (so an invalid command gets the same clear, host-
/// testable error as in the browser); a valid one reports that the sandbox
/// needs the browser runtime.
#[cfg(not(target_arch = "wasm32"))]
async fn run_wasi_command(req: ExecRequest) -> AppResult<ExecResponse> {
    let command_line = parse_wasm_command_line(&req.command)?;
    let _cwd = normalize_cwd(req.cwd.as_deref())?;
    let _timeout_ms = clamp_timeout_ms(req.effective_timeout_ms());
    Err(format!(
        "The in-browser WASI sandbox is only available in the browser runtime; \
         no binary was run for `{}`.",
        command_line.wasm_path
    ))
}

/// Where the `.wasm` binary comes from: bytes loaded (and base64-decoded) out
/// of the project filesystem, or a URL the worker fetches itself.
#[cfg(target_arch = "wasm32")]
enum WasmSource {
    VfsBytes { vfs_path: String, bytes: Vec<u8> },
    Url(String),
}

/// Resolve the command's first token to a [`WasmSource`].
///
/// A hosted-binary name (a [`binary_registry`] entry) resolves via its
/// descriptor's [`BinarySource`] — an `Asset`/`Url` becomes a URL the worker
/// fetches (cache-first), a `VfsPath` is read here. Otherwise: http(s) URLs are
/// passed through for the worker to fetch, and anything else is looked up in the
/// project filesystem (first relative to `cwd`, then from the root), where the
/// binary must be stored as base64 text.
#[cfg(target_arch = "wasm32")]
async fn resolve_wasm_source(cwd: Option<&str>, token: &str) -> AppResult<WasmSource> {
    if let Some(env) = lookup_binary_env(token) {
        return resolve_binary_source(cwd, &env.wasm).await;
    }
    if token.starts_with("http://") || token.starts_with("https://") {
        return Ok(WasmSource::Url(token.to_string()));
    }
    let rel = normalize_rel_path(token)?;
    let mut candidates = Vec::new();
    if cwd.is_some() {
        candidates.push(join_cwd(cwd, &rel));
    }
    candidates.push(rel.clone());

    let vfs = crate::storage::opfs_vfs::OpfsVfs::new();
    for candidate in candidates {
        if let Some(bytes) = vfs.read_bytes(&candidate).await? {
            // A real binary in OPFS is used as-is; a text file holding the
            // binary as base64 (the agent-tool convention) is decoded.
            if bytes.starts_with(b"\0asm") {
                return Ok(WasmSource::VfsBytes {
                    vfs_path: candidate,
                    bytes,
                });
            }
            let text = String::from_utf8(bytes).map_err(|_| {
                format!(
                    "Found `{candidate}` in the workspace but it is neither a wasm \
                     binary nor base64 text. Store the wasm32-wasip1 binary (or its \
                     base64 text), or pass an http(s) URL to fetch it from."
                )
            })?;
            let bytes = decode_base64(text.trim()).map_err(|err| {
                format!(
                    "Found `{candidate}` in the workspace but it is not a \
                     base64-encoded wasm binary ({err}). Store the wasm32-wasip1 binary \
                     (or its base64 text), or pass an http(s) URL to fetch it from."
                )
            })?;
            return Ok(WasmSource::VfsBytes {
                vfs_path: candidate,
                bytes,
            });
        }
    }
    Err(format!(
        "No .wasm binary named `{rel}` exists in the workspace. Write the \
         wasm32-wasip1 binary (or its base64 text) there first, or pass an \
         http(s) URL as the first command token."
    ))
}

/// Resolve a descriptor's [`BinarySource`] to a [`WasmSource`]: bundled assets
/// and absolute URLs are fetched by the worker (so the wasm never round-trips
/// through the host as bytes — the worker caches it cache-first); a `VfsPath` is
/// read out of the project filesystem here.
#[cfg(target_arch = "wasm32")]
async fn resolve_binary_source(cwd: Option<&str>, source: &BinarySource) -> AppResult<WasmSource> {
    match source {
        BinarySource::Asset(url) | BinarySource::Url(url) => Ok(WasmSource::Url(url.clone())),
        BinarySource::VfsPath(path) => {
            let rel = normalize_rel_path(path)?;
            let candidate = join_cwd(cwd, &rel);
            let vfs = crate::storage::opfs_vfs::OpfsVfs::new();
            let Some(bytes) = vfs.read_bytes(&candidate).await? else {
                return Err(format!(
                    "Hosted binary expects `{candidate}` in the workspace, but it is missing."
                ));
            };
            Ok(WasmSource::VfsBytes {
                vfs_path: candidate,
                bytes,
            })
        }
    }
}

/// Load the workspace files to seed into the worker's `/workspace`, scoped to
/// `cwd` when given (paths are sent relative to it). The `.wasm` binary itself
/// is skipped — it is the program, not workspace data — as are files whose
/// top-level segment is one of the descriptor's `reserved` mount segments, so a
/// user file can never clobber the guest's environment (e.g. a stdlib mount).
#[cfg(target_arch = "wasm32")]
async fn load_workspace_files(
    cwd: Option<&str>,
    skip_path: Option<&str>,
    reserved: &[String],
) -> AppResult<Vec<Value>> {
    let vfs = crate::storage::opfs_vfs::OpfsVfs::new();
    let mut files = Vec::new();
    for entry in vfs.list_all().await? {
        if entry.is_dir {
            continue;
        }
        let path = entry.path;
        if Some(path.as_str()) == skip_path {
            continue;
        }
        let rel = match cwd {
            Some(prefix) => match path.strip_prefix(&format!("{prefix}/")) {
                Some(rel) => rel.to_string(),
                None => continue,
            },
            None => path.clone(),
        };
        if is_under_reserved_segment(&rel, reserved) {
            continue;
        }
        if let Some(content) = vfs.read_file(&path).await? {
            files.push(serde_json::json!({ "path": rel, "text": content }));
        }
    }
    Ok(files)
}

/// Whether a run-root-relative path's first real segment is one the descriptor
/// reserved for a mount (the generalization of Python's reserved `lib/`).
// Used by the wasm worker driver and host tests; the host build never drives a
// run, so it is dead there.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub(crate) fn is_under_reserved_segment(rel: &str, reserved: &[String]) -> bool {
    if reserved.is_empty() {
        return false;
    }
    let first = rel
        .split('/')
        .find(|segment| !segment.is_empty() && *segment != ".");
    matches!(first, Some(segment) if reserved.iter().any(|r| r == segment))
}

/// Write the files the program created or changed back into the project
/// filesystem under the run's `cwd`. The worker's paths are untrusted data:
/// anything absolute or escaping the run root is refused (skipped), and binary
/// content is stored as its base64 text (the same convention used for `.wasm`
/// binaries going in).
#[cfg(target_arch = "wasm32")]
async fn store_workspace_files(cwd: Option<&str>, files: &[RunnerFileOut]) -> AppResult<()> {
    let vfs = crate::storage::opfs_vfs::OpfsVfs::new();
    for file in files {
        let Ok(rel) = normalize_rel_path(&file.path) else {
            // Refuse hostile or malformed paths rather than trusting the worker.
            continue;
        };
        let dest = join_cwd(cwd, &rel);
        match (&file.text, &file.base64) {
            (Some(text), _) => vfs.write_file(&dest, text).await?,
            // OPFS stores real bytes, so binary output round-trips as binary.
            (None, Some(base64)) => match decode_base64(base64.trim()) {
                Ok(bytes) => vfs.write_bytes(&dest, &bytes).await?,
                Err(_) => vfs.write_file(&dest, base64).await?,
            },
            (None, None) => continue,
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // --- command-line parsing -------------------------------------------------

    #[test]
    fn parses_wasm_command_line_with_argv() {
        let parsed = parse_wasm_command_line("tools/demo.wasm --greet askk tier-1")
            .expect("valid command line");
        assert_eq!(parsed.wasm_path, "tools/demo.wasm");
        assert_eq!(
            parsed.argv,
            vec!["tools/demo.wasm", "--greet", "askk", "tier-1"]
        );
    }

    #[test]
    fn parses_bare_wasm_path_and_url() {
        let parsed = parse_wasm_command_line("demo.wasm").expect("bare path");
        assert_eq!(parsed.argv, vec!["demo.wasm"]);

        let parsed =
            parse_wasm_command_line("https://example.test/bin/tool.wasm input.txt").expect("url");
        assert_eq!(parsed.wasm_path, "https://example.test/bin/tool.wasm");
        assert_eq!(parsed.argv.len(), 2);
    }

    #[test]
    fn rejects_empty_and_non_wasm_command_lines() {
        let err = parse_wasm_command_line("   ").expect_err("empty command");
        assert!(err.contains(".wasm"));

        let err = parse_wasm_command_line("cargo test").expect_err("native command");
        assert!(err.contains("`cargo`"));
        assert!(err.contains(".wasm"));
        assert!(err.contains("run_command"));
        // The error advertises the hosted binaries so the model can discover them.
        assert!(err.contains("wc"));
    }

    // --- hosted-binary registry / descriptor path -------------------------------

    #[test]
    fn registry_hosts_wc_with_caching_and_no_mounts() {
        let env = lookup_binary_env("wc").expect("wc is registered");
        assert_eq!(env.name, "wc");
        assert!(env.mounts.is_empty(), "wc is self-contained");
        assert!(env.env.is_empty());
        assert!(!env.ready_protocol, "a tiny util needs no ready phase");
        assert_eq!(env.cache_key.as_deref(), Some(HOSTED_BINARY_CACHE));
        match &env.wasm {
            BinarySource::Asset(url) => assert!(url.contains("wc")),
            other => panic!("expected an asset source, got {other:?}"),
        }
        assert!(lookup_binary_env("definitely-not-hosted").is_none());
    }

    #[test]
    fn hosted_binary_name_parses_as_a_command_line() {
        // A registered name (not a `.wasm` path) is a valid first token.
        let parsed = parse_wasm_command_line("wc notes.txt").expect("hosted name");
        assert_eq!(parsed.wasm_path, "wc");
        assert_eq!(parsed.argv, vec!["wc", "notes.txt"]);
    }

    #[test]
    fn build_message_base_without_descriptor_is_the_raw_shape() {
        let files = vec![json!({ "path": "a.txt", "text": "x" })];
        let message = build_message_base(&["demo.wasm".to_string()], files, None);
        assert_eq!(message["argv"][0], "demo.wasm");
        assert_eq!(message["files"][0]["path"], "a.txt");
        // No descriptor → no hosted-binary fields leak into the message.
        assert!(message.get("name").is_none());
        assert!(message.get("mounts").is_none());
        assert!(message.get("cache_key").is_none());
    }

    #[test]
    fn build_message_base_merges_descriptor_fields() {
        let env = lookup_binary_env("wc").expect("wc");
        let message = build_message_base(&["wc".to_string()], Vec::new(), Some(&env));
        assert_eq!(message["argv"][0], "wc");
        assert_eq!(message["name"], "wc");
        assert_eq!(message["cache_key"], HOSTED_BINARY_CACHE);
        assert_eq!(message["ready_protocol"], false);
        assert!(
            message["mounts"]
                .as_array()
                .expect("mounts array")
                .is_empty()
        );
    }

    #[test]
    fn reserved_segments_guard_workspace_seeding() {
        // No reserved segments → nothing is skipped.
        assert!(!is_under_reserved_segment("lib/x.py", &[]));
        // A reserved `lib` segment matches files under it (Python's rule,
        // generalized), and only at the top level.
        let reserved = vec!["lib".to_string()];
        assert!(is_under_reserved_segment("lib/python314.zip", &reserved));
        assert!(is_under_reserved_segment("./lib/data", &reserved));
        assert!(!is_under_reserved_segment("src/lib/util.py", &reserved));
        assert!(!is_under_reserved_segment("main.py", &reserved));
    }

    // --- timeout clamping -------------------------------------------------------

    #[test]
    fn clamps_timeout_into_hard_bounds() {
        assert_eq!(clamp_timeout_ms(1), MIN_EXEC_TIMEOUT_MS);
        assert_eq!(clamp_timeout_ms(30_000), 30_000);
        assert_eq!(clamp_timeout_ms(u32::MAX), MAX_EXEC_TIMEOUT_MS);
    }

    #[test]
    fn timeout_response_is_a_clear_failure() {
        let resp = timeout_response(5_000, "demo.wasm --greet");
        assert!(!resp.ok);
        assert_eq!(resp.exit_code, 124);
        assert!(resp.stderr.contains("timed out after 5000 ms"));
        assert!(resp.stderr.contains("demo.wasm --greet"));
    }

    // --- envelope mapping --------------------------------------------------------

    #[test]
    fn parses_runner_reply_with_files_out() {
        let value = json!({
            "ok": true,
            "exit_code": 0,
            "stdout": "hello\n",
            "stderr": "",
            "files_out": [
                { "path": "out/result.txt", "text": "processed" },
                { "path": "blob.bin", "base64": "AAEC" }
            ]
        });
        let (response, files) = parse_runner_reply(&value).expect("valid reply");
        assert!(response.ok);
        assert_eq!(response.exit_code, 0);
        assert_eq!(response.stdout, "hello\n");
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "out/result.txt");
        assert_eq!(files[0].text.as_deref(), Some("processed"));
        assert_eq!(files[1].base64.as_deref(), Some("AAEC"));
    }

    #[test]
    fn parses_runner_reply_without_files_out() {
        let value = json!({ "ok": false, "exit_code": 7, "stdout": "", "stderr": "boom" });
        let (response, files) = parse_runner_reply(&value).expect("valid reply");
        assert!(!response.ok);
        assert_eq!(response.exit_code, 7);
        assert_eq!(response.stderr, "boom");
        assert!(files.is_empty());
    }

    #[test]
    fn rejects_malformed_runner_replies() {
        // Envelope missing exit_code → from_worker_json refuses it.
        assert!(parse_runner_reply(&json!({ "ok": true })).is_err());
        // files_out of the wrong shape → clear error.
        let value = json!({
            "ok": true, "exit_code": 0, "stdout": "", "stderr": "",
            "files_out": [{ "text": "no path" }]
        });
        let err = parse_runner_reply(&value).expect_err("malformed files_out");
        assert!(err.contains("files_out"));
    }

    #[test]
    fn clamps_oversized_streams_on_char_boundaries() {
        let oversized = "é".repeat(MAX_STREAM_CHARS + 10);
        let clamped = clamp_stream(oversized);
        assert_eq!(clamped.chars().count(), MAX_STREAM_CHARS);
        let exact = "x".repeat(MAX_STREAM_CHARS);
        assert_eq!(clamp_stream(exact.clone()), exact);
    }

    // --- path handling -----------------------------------------------------------

    #[test]
    fn normalizes_cwd_and_rejects_escapes() {
        assert_eq!(normalize_cwd(None).expect("none"), None);
        assert_eq!(normalize_cwd(Some("")).expect("empty"), None);
        assert_eq!(normalize_cwd(Some("./")).expect("dot"), None);
        assert_eq!(
            normalize_cwd(Some("/sub/dir/")).expect("subdir"),
            Some("sub/dir".to_string())
        );
        assert!(normalize_cwd(Some("../escape")).is_err());
    }

    #[test]
    fn normalizes_rel_paths_and_rejects_escapes() {
        assert_eq!(
            normalize_rel_path("./out/result.txt").expect("clean path"),
            "out/result.txt"
        );
        assert!(normalize_rel_path("../etc/passwd").is_err());
        assert!(normalize_rel_path("a/../../b").is_err());
        assert!(normalize_rel_path("").is_err());
        assert!(normalize_rel_path("nul\0byte").is_err());
    }

    #[test]
    fn joins_cwd_prefix_onto_relative_paths() {
        assert_eq!(join_cwd(None, "a.txt"), "a.txt");
        assert_eq!(join_cwd(Some("sub/dir"), "a.txt"), "sub/dir/a.txt");
    }

    // --- base64 -------------------------------------------------------------------

    #[test]
    fn decodes_standard_base64() {
        assert_eq!(decode_base64("aGVsbG8=").expect("decode"), b"hello");
        assert_eq!(decode_base64("AAEC").expect("decode"), vec![0, 1, 2]);
        // Whitespace/newlines are tolerated (large blobs are often wrapped).
        assert_eq!(decode_base64("aGVs\nbG8=").expect("decode"), b"hello");
        assert!(decode_base64("not base64!").is_err());
        assert!(decode_base64("aGVs=bG8=").is_err());
    }

    // --- the executor seam on the host ---------------------------------------------

    #[test]
    fn host_executor_rejects_non_wasm_commands_through_the_trait() {
        let executor = WasiShimExecutor::new();
        let err = pollster::block_on(executor.run_command(ExecRequest::new("cargo test")))
            .expect_err("non-wasm command");
        assert!(err.contains(".wasm"));
        assert!(err.contains("`cargo`"));
    }

    #[test]
    fn host_executor_reports_browser_only_for_valid_wasm_commands() {
        let executor = WasiShimExecutor::new();
        let err = pollster::block_on(executor.run_command(ExecRequest::new("demo.wasm --greet")))
            .expect_err("host build cannot run the sandbox");
        assert!(err.contains("browser runtime"));
        assert!(err.contains("demo.wasm"));
    }
}
