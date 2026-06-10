//! Runtime dispatch for non-builtin shell commands.
//!
//! The canonical contract between the shell and the in-browser runtimes:
//! [`run_runtime`] takes a [`RuntimeKind`], the full tokenized `argv`
//! (`argv[0]` is the command name), and a [`ShellExecCtx`], and returns an
//! [`ExecResponse`]. Sibling units own the real Python/WASM substrates; their
//! arms return clear "lands in a sibling unit" stubs that the coordinator
//! replaces at integration. The Js arm is wired to the existing sandboxed
//! Web Worker executor ([`run_js_in_browser`]).

use crate::engine::browser_exec::run_js_in_browser;
use crate::engine::exec_capability::{DEFAULT_EXEC_TIMEOUT_MS, ExecResponse};
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
        RuntimeKind::Python => not_wired_stub("Python", argv),
        RuntimeKind::Wasm => not_wired_stub("WASM", argv),
        RuntimeKind::Js => run_js_file(argv, ctx).await,
    }
}

/// The clean "this runtime is not wired yet" response for substrates that
/// land in sibling units. Exit code 127 matches the seam's "could not run"
/// convention (see [`ExecResponse::not_wired`]).
fn not_wired_stub(runtime: &str, argv: &[String]) -> ExecResponse {
    ExecResponse::failure(
        127,
        format!(
            "the {runtime} runtime is not wired yet — it lands in a sibling unit; \
             no program was run for: {}",
            argv.join(" ")
        ),
    )
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
    fn python_and_wasm_arms_return_clean_not_wired_stubs() {
        let ctx = ShellExecCtx::default();
        let resp = pollster::block_on(run_runtime(
            RuntimeKind::Python,
            &argv(&["python", "x.py"]),
            &ctx,
        ));
        assert!(!resp.ok);
        assert_eq!(resp.exit_code, 127);
        assert!(resp.stderr.contains("Python runtime is not wired yet"));
        assert!(resp.stderr.contains("sibling unit"));
        assert!(resp.stderr.contains("python x.py"));

        let resp = pollster::block_on(run_runtime(
            RuntimeKind::Wasm,
            &argv(&["run", "app.wasm", "--flag"]),
            &ctx,
        ));
        assert_eq!(resp.exit_code, 127);
        assert!(resp.stderr.contains("WASM runtime is not wired yet"));
        assert!(resp.stderr.contains("run app.wasm --flag"));
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
