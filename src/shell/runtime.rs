//! Canonical runtime-dispatch contract for in-browser execution.
//!
//! One function, [`run_runtime`], routes a `(kind, argv, ctx)` request to the
//! matching in-browser runtime and returns the bridge-shaped
//! [`ExecResponse`]. The terminal, the Workspace Run button, and future shell
//! builtins all dispatch through this seam, so plugging in a real runtime is
//! one arm edit here — never a UI or loop change.
//!
//! Today only the JS arm executes for real (via the sandboxed exec Web
//! Worker). The Python and WASI arms return clear "not wired yet" stub
//! responses; their runtimes land in sibling units and will replace those
//! arms. Output is untrusted DATA throughout — never instructions.

#[cfg(target_arch = "wasm32")]
use crate::engine::browser_exec::{format_run_js, run_js_in_browser};
use crate::engine::exec_capability::ExecResponse;

/// Which in-browser runtime should execute the request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeKind {
    /// Python (Pyodide/WASI-style runtime — lands in a sibling unit).
    Python,
    /// A compiled `.wasm` module run on a WASI harness (sibling unit).
    Wasm,
    /// JavaScript in the sandboxed exec Web Worker (available today).
    // The Workspace Run button executes the open JS buffer directly (it may be
    // unsaved); this arm is dispatched by the shell terminal (sibling unit), so
    // allow it as dead code until that lands.
    #[allow(dead_code)]
    Js,
}

/// Execution context for one shell-dispatched run.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ShellExecCtx {
    /// Working directory, relative to the workspace filesystem root.
    pub cwd: String,
}

/// Resolve `path` against the context's working directory.
fn resolve_path(ctx: &ShellExecCtx, path: &str) -> String {
    let cwd = ctx.cwd.trim_matches('/');
    if cwd.is_empty() || path.starts_with('/') {
        path.trim_start_matches('/').to_string()
    } else {
        format!("{cwd}/{path}")
    }
}

/// A "this runtime lands in a sibling unit" stub response, mirroring
/// [`ExecResponse::not_wired`]'s `exit_code 127` convention.
fn not_wired_yet(runtime: &str, program: &str) -> ExecResponse {
    ExecResponse::failure(
        127,
        format!(
            "{runtime} runtime is not wired yet (it lands in a sibling unit); \
             nothing was run for: {program}"
        ),
    )
}

/// Run `argv` (program path first) on the runtime selected by `kind`,
/// returning the structured result. Stub arms never execute anything; the JS
/// arm reads `argv[0]` from the in-browser project filesystem and executes it
/// in the sandboxed exec Web Worker.
pub async fn run_runtime(kind: RuntimeKind, argv: &[String], ctx: &ShellExecCtx) -> ExecResponse {
    let Some(program) = argv.first().map(String::as_str) else {
        return ExecResponse::failure(127, "no program given (argv was empty)");
    };
    match kind {
        RuntimeKind::Python => not_wired_yet("python", program),
        RuntimeKind::Wasm => not_wired_yet("wasi", program),
        RuntimeKind::Js => run_js_file(&resolve_path(ctx, program)).await,
    }
}

/// JS arm: load the script from the project VFS and run it in the sandboxed
/// worker, mapping the `{ ok, stdout, stderr, … }` result onto [`ExecResponse`].
#[cfg(target_arch = "wasm32")]
async fn run_js_file(path: &str) -> ExecResponse {
    let code = match crate::storage::vfs::ProjectVfs::new().read_file(path).await {
        Ok(Some(code)) => code,
        Ok(None) => return ExecResponse::failure(127, format!("no such file: {path}")),
        Err(err) => return ExecResponse::failure(127, format!("could not read {path}: {err}")),
    };
    match run_js_in_browser(&code, 30_000).await {
        Ok(value) => {
            let (ok, text) = format_run_js(&value);
            if ok {
                ExecResponse::success(text, String::new())
            } else {
                ExecResponse::failure(1, text)
            }
        }
        Err(err) => ExecResponse::failure(127, err),
    }
}

/// Host-build fallback: there is no browser VFS or exec worker outside wasm
/// (the IndexedDB bindings would abort at runtime), so the arm reports a
/// clean, structured failure instead.
#[cfg(not(target_arch = "wasm32"))]
async fn run_js_file(path: &str) -> ExecResponse {
    ExecResponse::failure(
        127,
        format!(
            "could not run {path}: in-browser JavaScript execution is only \
             available in the browser runtime."
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(cwd: &str) -> ShellExecCtx {
        ShellExecCtx {
            cwd: cwd.to_string(),
        }
    }

    #[test]
    fn python_and_wasm_arms_return_clear_stub_failures() {
        for (kind, name) in [(RuntimeKind::Python, "python"), (RuntimeKind::Wasm, "wasi")] {
            let response =
                pollster::block_on(run_runtime(kind, &["main.py".to_string()], &ctx("")));
            assert!(!response.ok);
            assert_eq!(response.exit_code, 127);
            assert!(response.stderr.contains(name));
            assert!(response.stderr.contains("sibling unit"));
            assert!(response.stderr.contains("main.py"));
        }
    }

    #[test]
    fn empty_argv_is_a_clear_failure() {
        let response = pollster::block_on(run_runtime(RuntimeKind::Js, &[], &ctx("")));
        assert!(!response.ok);
        assert_eq!(response.exit_code, 127);
        assert!(response.stderr.contains("argv was empty"));
    }

    #[test]
    fn js_arm_fails_cleanly_on_the_host() {
        // No browser VFS or worker on the host: the arm must come back as a
        // structured failure, never a panic.
        let response = pollster::block_on(run_runtime(
            RuntimeKind::Js,
            &["app.js".to_string()],
            &ctx(""),
        ));
        assert!(!response.ok);
        assert_eq!(response.exit_code, 127);
    }

    #[test]
    fn resolve_path_joins_cwd_and_respects_absolute_paths() {
        assert_eq!(resolve_path(&ctx(""), "app.js"), "app.js");
        assert_eq!(resolve_path(&ctx("src"), "app.js"), "src/app.js");
        assert_eq!(resolve_path(&ctx("src/"), "/lib/app.js"), "lib/app.js");
    }
}
