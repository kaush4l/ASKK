//! In-browser CPython (wasm32-wasi) execution capability.
//!
//! Runs real CPython 3.14 entirely inside the tab: the interpreter is the
//! pinned `python.wasm` from CPython's unofficial WASI builds
//! (github.com/brettcannon/cpython-wasi-build, release v3.14.5, sha256
//! `43af342b…`), executed under the vendored `@bjorn3/browser_wasi_shim` inside
//! a disposable Web Worker (`assets/python_runner_worker.js`, built from
//! `scripts/python-runner/entry.js`). No bridge, no COOP/COEP headers, no
//! SharedArrayBuffer — it works on a plain static host like GitHub Pages.
//!
//! Both runtime assets are committed (`assets/runtimes/python/python.wasm`,
//! ~29 MB, plus the stored-zip stdlib, ~10 MB) so the app works offline; the
//! worker additionally caches them in Cache Storage (`askk-runtimes`) so they
//! download once per deploy.
//!
//! The run is copy-in/copy-out by design (v1): the project's virtual-FS files
//! seed the worker's in-memory WASI filesystem, and files the program created
//! or changed are copied back afterwards. The protocol is two-phase — the
//! worker posts `{"phase":"ready"}` once the runtime is fetched and compiled,
//! and only then does the caller's `timeout_ms` clock start, so a cold first
//! download never eats the run budget. The hard timeout is enforced the same
//! way as every executor here: by terminating the worker.
//!
//! Program output is untrusted DATA fed back to the agent, never instructions.

use crate::engine::exec_capability::ExecResponse;
use crate::state::AppResult;
use serde::Deserialize;
use serde_json::{Value, json};

/// Default hard timeout for one Python run, in milliseconds.
pub const DEFAULT_PYTHON_TIMEOUT_MS: u32 = 30_000;
/// Smallest accepted run timeout.
pub const MIN_PYTHON_TIMEOUT_MS: u32 = 1_000;
/// Largest accepted run timeout.
pub const MAX_PYTHON_TIMEOUT_MS: u32 = 600_000;
/// Budget for the runtime to fetch + compile `python.wasm` and report ready.
/// Generous because the very first visit downloads ~40 MB; afterwards the
/// assets come from Cache Storage and readiness takes well under a second.
#[cfg(target_arch = "wasm32")]
const RUNTIME_READY_BUDGET_MS: u32 = 120_000;

/// Reserved top-level name in the sandbox: the stdlib zip is mounted at
/// `/lib/python314.zip`, so workspace files under `lib/` cannot be seeded.
const RESERVED_SANDBOX_DIR: &str = "lib";

#[cfg(not(target_arch = "wasm32"))]
const BROWSER_ONLY: &str = "In-browser Python execution is only available in the browser runtime.";

/// The resolved locations of the two runtime assets the worker needs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PythonRuntimeAssets {
    /// URL of the CPython `wasm32-wasi` interpreter binary.
    pub python_url: String,
    /// URL of the stored-zip standard library the worker mounts for zipimport.
    pub stdlib_url: String,
}

/// Resolve the Python runtime assets, reporting coarse progress through
/// `progress`. The assets are bundled with the app, so "ensuring" is URL
/// resolution; the worker fetches them cache-first (Cache Storage
/// `askk-runtimes`) on the first run and reports readiness before the run
/// timeout starts.
#[cfg(target_arch = "wasm32")]
pub async fn ensure_python_runtime(
    progress: &mut dyn FnMut(&str),
) -> AppResult<PythonRuntimeAssets> {
    use dioxus::prelude::*;

    const PYTHON_WASM: Asset = asset!("/assets/runtimes/python/python.wasm");
    const PYTHON_STDLIB_ZIP: Asset = asset!("/assets/runtimes/python/python-stdlib.zip");

    progress("Resolving the in-browser Python runtime (CPython 3.14, wasm32-wasi)…");
    let assets = PythonRuntimeAssets {
        python_url: PYTHON_WASM.to_string(),
        stdlib_url: PYTHON_STDLIB_ZIP.to_string(),
    };
    progress("Python runtime resolved; it is downloaded and cached on first use.");
    Ok(assets)
}

/// Host-build fallback: the runtime exists only in the browser.
#[cfg(not(target_arch = "wasm32"))]
pub async fn ensure_python_runtime(
    _progress: &mut dyn FnMut(&str),
) -> AppResult<PythonRuntimeAssets> {
    Err(BROWSER_ONLY.to_string())
}

/// Run a workspace file as the entry script: `python <path> <args…>`, with the
/// project's virtual filesystem seeded into the sandbox. Returns the structured
/// result; `ok` is true only for exit code 0.
pub async fn run_python_file(
    path: &str,
    args: &[String],
    timeout_ms: u32,
) -> AppResult<ExecResponse> {
    run_python(RunMode::File(path), args, timeout_ms).await
}

/// Run a snippet as if by `python -c <code>`, with the project's virtual
/// filesystem seeded into the sandbox.
pub async fn run_python_code(code: &str, timeout_ms: u32) -> AppResult<ExecResponse> {
    run_python(RunMode::Code(code), &[], timeout_ms).await
}

/// What to execute: a workspace entry script or an inline snippet.
#[derive(Clone, Copy, Debug)]
enum RunMode<'a> {
    File(&'a str),
    Code(&'a str),
}

async fn run_python(
    mode: RunMode<'_>,
    args: &[String],
    timeout_ms: u32,
) -> AppResult<ExecResponse> {
    let timeout_ms = timeout_ms.clamp(MIN_PYTHON_TIMEOUT_MS, MAX_PYTHON_TIMEOUT_MS);
    let mut progress = |_message: &str| {};
    let assets = ensure_python_runtime(&mut progress).await?;

    let all_files = load_workspace_seed().await?;
    let (files, skipped_seed) = partition_workspace_seed(all_files);
    let message = build_run_message(&assets, mode, args, &files);

    let Some(done) = drive_python_worker(message.to_string(), timeout_ms).await? else {
        return Ok(ExecResponse::failure(
            124,
            format!(
                "python run timed out after {timeout_ms} ms; the sandbox worker was terminated"
            ),
        ));
    };

    let (written, skipped_binary) = store_workspace_outputs(&done.files_out).await?;

    let mut response = ExecResponse {
        ok: done.exit_code == 0,
        stdout: done.stdout,
        stderr: done.stderr,
        exit_code: done.exit_code,
    };
    append_harness_notes(&mut response, &written, &skipped_binary, &skipped_seed);
    Ok(response)
}

/// Load the workspace seed for the sandbox: every file in the project VFS.
// COORDINATOR: swap to OpfsVfs once src/storage/opfs_vfs.rs lands; this is the
// single load seam for that change.
async fn load_workspace_seed() -> AppResult<Vec<(String, String)>> {
    use crate::storage::vfs::ProjectVfs;
    let vfs = ProjectVfs::new();
    let paths = vfs
        .list_files()
        .await
        .map_err(|err| format!("Unable to list workspace files for the Python sandbox: {err}"))?;
    let mut files = Vec::with_capacity(paths.len());
    for path in paths {
        let content = vfs
            .read_file(&path)
            .await
            .map_err(|err| format!("Unable to read workspace file `{path}`: {err}"))?
            .unwrap_or_default();
        files.push((path, content));
    }
    Ok(files)
}

/// Write changed sandbox files back to the workspace. Text files are stored;
/// binary files (non-UTF-8) are skipped because the VFS is text-only. Returns
/// the stored paths and the skipped binary paths.
// COORDINATOR: swap to OpfsVfs once src/storage/opfs_vfs.rs lands; this is the
// single store seam for that change.
async fn store_workspace_outputs(
    files_out: &[WorkerFileOut],
) -> AppResult<(Vec<String>, Vec<String>)> {
    use crate::storage::vfs::ProjectVfs;
    let vfs = ProjectVfs::new();
    let mut written = Vec::new();
    let mut skipped_binary = Vec::new();
    for file in files_out {
        if let Some(text) = &file.text {
            vfs.write_file(&file.path, text).await.map_err(|err| {
                format!(
                    "Python run finished but writing `{}` back to the workspace failed: {err}",
                    file.path
                )
            })?;
            written.push(file.path.clone());
        } else {
            skipped_binary.push(file.path.clone());
        }
    }
    Ok((written, skipped_binary))
}

/// Split the seed into files the sandbox can take and files under the reserved
/// `lib/` mount (where the stdlib zip lives), which must be skipped.
fn partition_workspace_seed(files: Vec<(String, String)>) -> (Vec<(String, String)>, Vec<String>) {
    let mut kept = Vec::new();
    let mut skipped = Vec::new();
    for (path, content) in files {
        let first_segment = path
            .split('/')
            .find(|segment| !segment.is_empty() && *segment != ".");
        if first_segment == Some(RESERVED_SANDBOX_DIR) {
            skipped.push(path);
        } else {
            kept.push((path, content));
        }
    }
    (kept, skipped)
}

/// Build the JSON request the python-runner worker consumes. Pure, so the
/// protocol shape is locked down by host tests.
fn build_run_message(
    assets: &PythonRuntimeAssets,
    mode: RunMode<'_>,
    args: &[String],
    files: &[(String, String)],
) -> Value {
    let files_json: Vec<Value> = files
        .iter()
        .map(|(path, text)| json!({ "path": path, "text": text }))
        .collect();
    let mut message = json!({
        "python_url": assets.python_url,
        "stdlib_url": assets.stdlib_url,
        "args": args,
        "stdin": "",
        "files": files_json,
    });
    match mode {
        RunMode::Code(code) => {
            message["mode"] = Value::String("code".to_string());
            message["code"] = Value::String(code.to_string());
        }
        RunMode::File(entry) => {
            message["mode"] = Value::String("file".to_string());
            message["entry"] = Value::String(entry.to_string());
        }
    }
    message
}

/// One changed file copied out of the sandbox: UTF-8 content arrives as
/// `text`, anything else as base64 `bytes_b64`.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
struct WorkerFileOut {
    path: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    bytes_b64: Option<String>,
}

/// The worker's final "run finished" payload.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
struct WorkerDone {
    exit_code: i32,
    #[serde(default)]
    stdout: String,
    #[serde(default)]
    stderr: String,
    #[serde(default)]
    files_out: Vec<WorkerFileOut>,
}

/// A parsed message from the python-runner worker.
// Consumed by the wasm worker driver; on the host build only the unit tests use
// it (the host driver fails before parsing), so allow it as dead code there.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
#[derive(Clone, Debug, PartialEq, Eq)]
enum WorkerReply {
    /// Runtime fetched + compiled; the run is starting and the timeout applies.
    Ready,
    /// The run finished (any exit code).
    Done(Box<WorkerDone>),
    /// The harness itself failed (bad fetch, malformed request, …).
    Failed(String),
}

/// Parse one worker message. Pure, host-tested.
// Called by the wasm worker driver and the unit tests; dead on the host's
// non-test build for the same reason as [`WorkerReply`].
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
fn parse_worker_reply(text: &str) -> AppResult<WorkerReply> {
    let value: Value = serde_json::from_str(text)
        .map_err(|err| format!("Python runner worker returned non-JSON output: {err}"))?;
    if value.get("phase").and_then(Value::as_str) == Some("ready") {
        return Ok(WorkerReply::Ready);
    }
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return Ok(WorkerReply::Failed(error.to_string()));
    }
    let done: WorkerDone = serde_json::from_value(value)
        .map_err(|err| format!("Python runner worker returned a malformed result: {err}"))?;
    Ok(WorkerReply::Done(Box::new(done)))
}

/// Append clearly-tagged harness notes (workspace write-backs, skipped files)
/// to the response so the transcript reports them alongside program output.
fn append_harness_notes(
    response: &mut ExecResponse,
    written: &[String],
    skipped_binary: &[String],
    skipped_seed: &[String],
) {
    if !written.is_empty() {
        response.stdout.push_str(&format!(
            "\n[python-runner] updated workspace files: {}",
            written.join(", ")
        ));
    }
    if !skipped_binary.is_empty() {
        response.stderr.push_str(&format!(
            "\n[python-runner] skipped non-text output files (workspace is text-only): {}",
            skipped_binary.join(", ")
        ));
    }
    if !skipped_seed.is_empty() {
        response.stderr.push_str(&format!(
            "\n[python-runner] workspace files under the reserved `lib/` path were not \
             seeded into the sandbox: {}",
            skipped_seed.join(", ")
        ));
    }
}

/// Spawn the python-runner worker, post `message_json`, and wait through the
/// two-phase protocol: first `ready` (on the runtime budget), then the result
/// (on `timeout_ms`). Returns `Ok(None)` when the run timed out and the worker
/// was terminated. Mirrors the disposable-worker lifecycle of
/// [`browser_exec::run_js_in_browser`](crate::engine::browser_exec).
#[cfg(target_arch = "wasm32")]
async fn drive_python_worker(
    message_json: String,
    timeout_ms: u32,
) -> AppResult<Option<WorkerDone>> {
    use dioxus::prelude::*;
    use futures_util::StreamExt;
    use wasm_bindgen::{JsCast, JsValue, closure::Closure};

    const PYTHON_RUNNER_WORKER_JS: Asset = asset!("/assets/python_runner_worker.js");

    let script_url = PYTHON_RUNNER_WORKER_JS.to_string();
    let worker = web_sys::Worker::new(&script_url)
        .map_err(|err| format!("Unable to start the Python runner worker: {err:?}"))?;

    let (tx, mut rx) = futures_channel::mpsc::unbounded::<AppResult<String>>();

    let tx_msg = tx.clone();
    let onmessage = Closure::<dyn FnMut(web_sys::MessageEvent)>::wrap(Box::new(
        move |event: web_sys::MessageEvent| {
            let text = event.data().as_string().unwrap_or_default();
            let _ = tx_msg.unbounded_send(Ok(text));
        },
    ));
    worker.set_onmessage(Some(onmessage.as_ref().unchecked_ref()));

    let tx_err = tx;
    let onerror = Closure::<dyn FnMut(web_sys::ErrorEvent)>::wrap(Box::new(
        move |event: web_sys::ErrorEvent| {
            let _ = tx_err.unbounded_send(Err(format!(
                "Python runner worker error: {}",
                event.message()
            )));
        },
    ));
    worker.set_onerror(Some(onerror.as_ref().unchecked_ref()));

    let outcome = async {
        worker
            .post_message(&JsValue::from_str(&message_json))
            .map_err(|err| {
                format!("Unable to send the run request to the Python worker: {err:?}")
            })?;

        // Phase 1: wait for readiness (runtime fetch + compile) on its own budget.
        let mut deadline = RUNTIME_READY_BUDGET_MS;
        let mut ready = false;
        loop {
            let timeout = gloo_timers::future::TimeoutFuture::new(deadline);
            match futures_util::future::select(rx.next(), timeout).await {
                futures_util::future::Either::Left((Some(Ok(text)), _)) => {
                    match parse_worker_reply(&text)? {
                        WorkerReply::Ready => {
                            // Phase 2: the run itself, on the caller's timeout.
                            ready = true;
                            deadline = timeout_ms;
                        }
                        WorkerReply::Done(done) => return Ok(Some(*done)),
                        WorkerReply::Failed(message) => {
                            return Err(format!("Python runner failed: {message}"));
                        }
                    }
                }
                futures_util::future::Either::Left((Some(Err(message)), _)) => {
                    return Err(message);
                }
                futures_util::future::Either::Left((None, _)) => {
                    return Err(
                        "Python runner worker closed without returning a result.".to_string()
                    );
                }
                futures_util::future::Either::Right(_) if ready => return Ok(None), // run timeout
                futures_util::future::Either::Right(_) => {
                    return Err(format!(
                        "Python runtime failed to initialize within {RUNTIME_READY_BUDGET_MS} ms \
                         (downloading or compiling python.wasm may have failed)."
                    ));
                }
            }
        }
    }
    .await;

    // Always terminate: success, failure, or timeout — a disposable worker per run.
    worker.terminate();
    drop(onmessage);
    drop(onerror);
    outcome
}

/// Host-build fallback: there is no browser worker outside wasm.
#[cfg(not(target_arch = "wasm32"))]
async fn drive_python_worker(
    _message_json: String,
    _timeout_ms: u32,
) -> AppResult<Option<WorkerDone>> {
    Err(BROWSER_ONLY.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assets() -> PythonRuntimeAssets {
        PythonRuntimeAssets {
            python_url: "/assets/runtimes/python/python.wasm".to_string(),
            stdlib_url: "/assets/runtimes/python/python-stdlib.zip".to_string(),
        }
    }

    #[test]
    fn build_run_message_for_code_mode_matches_worker_protocol() {
        let message = build_run_message(
            &assets(),
            RunMode::Code("print('hi')"),
            &[],
            &[("notes.txt".to_string(), "n".to_string())],
        );
        assert_eq!(message["mode"], "code");
        assert_eq!(message["code"], "print('hi')");
        assert_eq!(message["python_url"], "/assets/runtimes/python/python.wasm");
        assert_eq!(
            message["stdlib_url"],
            "/assets/runtimes/python/python-stdlib.zip"
        );
        assert_eq!(message["files"][0]["path"], "notes.txt");
        assert_eq!(message["files"][0]["text"], "n");
        assert!(message.get("entry").is_none());
    }

    #[test]
    fn build_run_message_for_file_mode_carries_entry_and_args() {
        let message = build_run_message(
            &assets(),
            RunMode::File("main.py"),
            &["--fast".to_string(), "in.csv".to_string()],
            &[],
        );
        assert_eq!(message["mode"], "file");
        assert_eq!(message["entry"], "main.py");
        assert_eq!(message["args"][0], "--fast");
        assert_eq!(message["args"][1], "in.csv");
        assert!(message.get("code").is_none());
    }

    #[test]
    fn parse_worker_reply_distinguishes_ready_done_and_failed() {
        assert_eq!(
            parse_worker_reply(r#"{"phase":"ready"}"#).expect("parse ready"),
            WorkerReply::Ready
        );
        match parse_worker_reply(
            r#"{"exit_code":3,"stdout":"o","stderr":"e","files_out":[{"path":"a.txt","text":"x"}]}"#,
        )
        .expect("parse done")
        {
            WorkerReply::Done(done) => {
                assert_eq!(done.exit_code, 3);
                assert_eq!(done.stdout, "o");
                assert_eq!(done.stderr, "e");
                assert_eq!(done.files_out[0].path, "a.txt");
                assert_eq!(done.files_out[0].text.as_deref(), Some("x"));
            }
            other => panic!("expected Done, got {other:?}"),
        }
        assert_eq!(
            parse_worker_reply(r#"{"error":"python-runner: boom"}"#).expect("parse failed"),
            WorkerReply::Failed("python-runner: boom".to_string())
        );
        assert!(parse_worker_reply("not json").is_err());
        assert!(parse_worker_reply(r#"{"unexpected":true}"#).is_err());
    }

    #[test]
    fn partition_workspace_seed_reserves_the_lib_mount() {
        let (kept, skipped) = partition_workspace_seed(vec![
            ("main.py".to_string(), "print(1)".to_string()),
            ("lib/helper.py".to_string(), "x = 1".to_string()),
            ("pkg/lib.py".to_string(), "y = 2".to_string()),
        ]);
        assert_eq!(kept.len(), 2);
        assert!(kept.iter().any(|(path, _)| path == "main.py"));
        assert!(kept.iter().any(|(path, _)| path == "pkg/lib.py"));
        assert_eq!(skipped, vec!["lib/helper.py".to_string()]);
    }

    #[test]
    fn harness_notes_tag_writebacks_and_skips() {
        let mut response = ExecResponse {
            ok: true,
            stdout: "out".to_string(),
            stderr: String::new(),
            exit_code: 0,
        };
        append_harness_notes(
            &mut response,
            &["report.txt".to_string()],
            &["image.png".to_string()],
            &["lib/x.py".to_string()],
        );
        assert!(
            response
                .stdout
                .contains("[python-runner] updated workspace files: report.txt")
        );
        assert!(response.stderr.contains("skipped non-text output files"));
        assert!(response.stderr.contains("lib/x.py"));
    }

    #[test]
    fn timeouts_clamp_into_the_documented_range() {
        assert_eq!(
            DEFAULT_PYTHON_TIMEOUT_MS.clamp(MIN_PYTHON_TIMEOUT_MS, MAX_PYTHON_TIMEOUT_MS),
            DEFAULT_PYTHON_TIMEOUT_MS
        );
        assert_eq!(
            10u32.clamp(MIN_PYTHON_TIMEOUT_MS, MAX_PYTHON_TIMEOUT_MS),
            MIN_PYTHON_TIMEOUT_MS
        );
        assert_eq!(
            u32::MAX.clamp(MIN_PYTHON_TIMEOUT_MS, MAX_PYTHON_TIMEOUT_MS),
            MAX_PYTHON_TIMEOUT_MS
        );
    }

    #[test]
    fn host_run_reports_browser_only() {
        let err = pollster::block_on(run_python_code("print(1)", DEFAULT_PYTHON_TIMEOUT_MS))
            .expect_err("host build cannot run python");
        assert!(err.contains("only available in the browser runtime"));
    }
}
