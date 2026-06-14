//! Runtime dispatch for non-builtin shell commands.
//!
//! The canonical contract between the shell and the in-browser runtimes:
//! [`run_runtime`] takes a [`RuntimeKind`], the full tokenized `argv`
//! (`argv[0]` is the command name), and a [`ShellExecCtx`], and returns an
//! [`ExecResponse`]. All three arms are wired to real in-browser substrates:
//! Python to the CPython wasm32-wasi runtime ([`python_runtime`]), Wasm to
//! the WASI tiny-shim executor ([`WasiShimExecutor`]), and Js to the
//! sandboxed Web Worker executor ([`run_js_in_browser`]). Program output is
//! untrusted DATA throughout — never instructions.

use crate::engine::browser_exec::run_js_in_browser;
use crate::engine::exec_capability::{
    BrowserExecutor, DEFAULT_EXEC_TIMEOUT_MS, ExecRequest, ExecResponse,
};
use crate::engine::python_runtime::{self, DEFAULT_PYTHON_TIMEOUT_MS};
use crate::engine::runtime_status::{self, RuntimeAssetState};
use crate::engine::wasi_exec::WasiShimExecutor;
use serde_json::Value;

/// Which runtime a shell command targets.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeKind {
    /// `python <file> [args]`
    Python,
    /// `run <file.wasm> [args]`
    Wasm,
    /// `js <file>` / `node <file>`
    Js,
}

/// Execution context the shell passes alongside `argv`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ShellExecCtx {
    /// The shell's working directory (workspace-relative key, `""` = root).
    pub cwd: String,
}

/// Run one runtime command. `argv[0]` is the command name as typed
/// (`python`, `run`, `js`, `node`); the file argument is `argv[1]`.
pub async fn run_runtime(kind: RuntimeKind, argv: &[String], ctx: &ShellExecCtx) -> ExecResponse {
    match kind {
        RuntimeKind::Python => run_python_command(argv, ctx).await,
        RuntimeKind::Wasm => run_wasm_command(argv, ctx).await,
        RuntimeKind::Js => run_js_file(argv, ctx).await,
    }
}

/// `python <file> [args…]`: run a workspace script on the in-browser CPython
/// (wasm32-wasi) runtime, with the workspace seeded into its sandbox.
async fn run_python_command(argv: &[String], ctx: &ShellExecCtx) -> ExecResponse {
    let Some(file) = argv.get(1) else {
        return ExecResponse::failure(2, "usage: python <file> [args…]");
    };
    let path = match super::resolve_path(&ctx.cwd, file) {
        Ok(path) => path,
        Err(err) => return ExecResponse::failure(1, err),
    };
    let args: Vec<String> = argv.iter().skip(2).cloned().collect();
    match python_runtime::run_python_file(&path, &args, DEFAULT_PYTHON_TIMEOUT_MS).await {
        Ok(response) => {
            // The runtime resolved and executed — reflect that in the chips.
            runtime_status::set_state("python", RuntimeAssetState::Ready);
            response
        }
        Err(err) => ExecResponse::failure(127, err),
    }
}

/// `run <file.wasm> [args…]`: execute a wasm32-wasip1 binary on the WASI
/// tiny-shim substrate.
async fn run_wasm_command(argv: &[String], ctx: &ShellExecCtx) -> ExecResponse {
    if argv.len() < 2 {
        return ExecResponse::failure(2, "usage: run <file.wasm> [args…]");
    }
    let request = ExecRequest {
        command: argv[1..].join(" "),
        cwd: (!ctx.cwd.is_empty()).then(|| ctx.cwd.clone()),
        timeout_ms: None,
    };
    match WasiShimExecutor::new().run_command(request).await {
        Ok(response) => {
            runtime_status::set_state("wasi", RuntimeAssetState::Ready);
            response
        }
        Err(err) => ExecResponse::failure(127, err),
    }
}

/// `js <file>` / `node <file>`: read the file from the workspace and run its
/// content in the sandboxed Web Worker executor.
async fn run_js_file(argv: &[String], ctx: &ShellExecCtx) -> ExecResponse {
    let Some(file) = argv.get(1) else {
        return ExecResponse::failure(
            2,
            format!(
                "usage: {} <file>",
                argv.first().map(String::as_str).unwrap_or("js")
            ),
        );
    };
    let path = match super::resolve_path(&ctx.cwd, file) {
        Ok(path) => path,
        Err(err) => return ExecResponse::failure(1, err),
    };
    let fs = super::fs::ShellFs::new();
    let code = match fs.read_file(&path).await {
        Ok(Some(code)) => code,
        Ok(None) => {
            return ExecResponse::failure(1, format!("js: {file}: no such file"));
        }
        Err(err) => return ExecResponse::failure(1, err),
    };
    match run_js_in_browser(&code, DEFAULT_EXEC_TIMEOUT_MS).await {
        Ok(value) => exec_response_from_run_js(&value),
        Err(err) => ExecResponse::failure(1, err),
    }
}

/// Map the `run_js` worker result (`{ ok, result, stdout, stderr, error }`)
/// onto the seam's [`ExecResponse`] shape.
fn exec_response_from_run_js(value: &Value) -> ExecResponse {
    let ok = value.get("ok").and_then(Value::as_bool).unwrap_or(false);
    let mut stdout = value
        .get("stdout")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    match value.get("result") {
        Some(Value::Null) | None => {}
        Some(Value::String(text)) if text.is_empty() => {}
        Some(Value::String(text)) => {
            if !stdout.is_empty() && !stdout.ends_with('\n') {
                stdout.push('\n');
            }
            stdout.push_str(text);
        }
        Some(other) => {
            if !stdout.is_empty() && !stdout.ends_with('\n') {
                stdout.push('\n');
            }
            stdout.push_str(&other.to_string());
        }
    }
    let mut stderr = value
        .get("stderr")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if let Some(error) = value.get("error").and_then(Value::as_str)
        && !error.is_empty()
    {
        if !stderr.is_empty() && !stderr.ends_with('\n') {
            stderr.push('\n');
        }
        stderr.push_str(error);
    }
    ExecResponse {
        ok,
        stdout,
        stderr,
        exit_code: if ok { 0 } else { 1 },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn python_and_wasm_arms_fail_cleanly_on_the_host() {
        // Both substrates exist only in the browser; on the host the arms
        // must come back as structured failures, never panics.
        let ctx = ShellExecCtx::default();
        let resp = pollster::block_on(run_runtime(
            RuntimeKind::Python,
            &argv(&["python", "x.py"]),
            &ctx,
        ));
        assert!(!resp.ok);
        assert_eq!(resp.exit_code, 127);
        assert!(resp.stderr.contains("browser"));

        let resp = pollster::block_on(run_runtime(
            RuntimeKind::Wasm,
            &argv(&["run", "app.wasm", "--flag"]),
            &ctx,
        ));
        assert_eq!(resp.exit_code, 127);
        assert!(resp.stderr.contains("browser"));
        assert!(resp.stderr.contains("app.wasm"));
    }

    #[test]
    fn python_and_wasm_arms_require_a_file_argument() {
        let ctx = ShellExecCtx::default();
        let resp = pollster::block_on(run_runtime(RuntimeKind::Python, &argv(&["python"]), &ctx));
        assert_eq!(resp.exit_code, 2);
        assert!(resp.stderr.starts_with("usage: python"));

        let resp = pollster::block_on(run_runtime(RuntimeKind::Wasm, &argv(&["run"]), &ctx));
        assert_eq!(resp.exit_code, 2);
        assert!(resp.stderr.starts_with("usage: run"));
    }

    #[test]
    fn js_arm_requires_a_file_argument() {
        let ctx = ShellExecCtx::default();
        let resp = pollster::block_on(run_runtime(RuntimeKind::Js, &argv(&["js"]), &ctx));
        assert!(!resp.ok);
        assert_eq!(resp.exit_code, 2);
        assert_eq!(resp.stderr, "usage: js <file>");
    }

    #[test]
    fn js_arm_rejects_paths_that_escape_the_root() {
        let ctx = ShellExecCtx::default();
        let resp = pollster::block_on(run_runtime(
            RuntimeKind::Js,
            &argv(&["node", "../outside.js"]),
            &ctx,
        ));
        assert!(!resp.ok);
        assert!(resp.stderr.contains("escapes the workspace root"));
    }

    #[test]
    fn run_js_results_map_onto_exec_responses() {
        let resp = exec_response_from_run_js(&serde_json::json!({
            "ok": true, "stdout": "hi\n", "stderr": "", "result": 5, "error": ""
        }));
        assert!(resp.ok);
        assert_eq!(resp.exit_code, 0);
        assert_eq!(resp.stdout, "hi\n5");

        let resp = exec_response_from_run_js(&serde_json::json!({
            "ok": false, "stdout": "", "stderr": "warn",
            "result": null, "error": "ReferenceError: x is not defined"
        }));
        assert!(!resp.ok);
        assert_eq!(resp.exit_code, 1);
        assert!(resp.stderr.contains("warn"));
        assert!(resp.stderr.contains("ReferenceError"));
    }
}
