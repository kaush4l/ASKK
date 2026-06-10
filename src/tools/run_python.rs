//! `run_python` — run real CPython (3.14, wasm32-wasi) natively in the browser
//! inside a sandboxed Web Worker. No install, no bridge, no special headers; the
//! interpreter is a committed asset cached after first load. The workspace VFS is
//! copied in before the run and changed files are copied back after (v1 design).

use crate::engine::python_runtime::{
    DEFAULT_PYTHON_TIMEOUT_MS, MAX_PYTHON_TIMEOUT_MS, MIN_PYTHON_TIMEOUT_MS, run_python_code,
    run_python_file,
};
use crate::state::{AppResult, AppSnapshot, ToolSpec};
use serde_json::{Value, json};

use super::common::{integer_arg, optional_string_arg};
use super::{ToolDescriptor, ToolFuture};

pub(crate) fn descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: spec(),
        handler,
    }
}

fn spec() -> ToolSpec {
    ToolSpec {
        name: "run_python".to_string(),
        description: "Run Python (real CPython 3.14 compiled to WebAssembly) natively in the \
            browser, in a sandboxed Web Worker — no install or bridge required. Provide exactly \
            one of `code` (run like `python -c`) or `file` (a workspace file path to run as the \
            entry script). Workspace files are copied into the sandbox working directory before \
            the run; files the program creates or changes are written back to the workspace and \
            listed in the output. stdout and stderr are captured separately (truncated at 60000 \
            chars). exit_code 0 is the ONLY proof of success: treat any non-zero exit_code or \
            ok:false as failure, no matter what the program printed. The sandbox has no network \
            and no subprocesses; `lib/` is reserved for the runtime. The first run may take \
            longer while the ~40 MB Python runtime downloads (cached afterwards)."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "code": { "type": "string", "description": "Python source to run as if by `python -c`. Mutually exclusive with `file`." },
                "file": { "type": "string", "description": "Workspace path of the entry script, e.g. `main.py`. Mutually exclusive with `code`." },
                "args": { "type": "array", "items": { "type": "string" }, "description": "Extra command-line arguments (sys.argv[1:])." },
                "timeout_ms": { "type": "integer", "description": "Hard run timeout in milliseconds (1000-600000, default 30000). Runtime download/compile time does not count against it." }
            }
        }),
    }
}

/// Read the optional `args` array as strings (scalars are stringified, since
/// models sometimes emit numbers).
fn args_arg(args: &Value) -> AppResult<Vec<String>> {
    match args.get("args") {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| match item {
                Value::String(text) => Ok(text.clone()),
                Value::Number(number) => Ok(number.to_string()),
                Value::Bool(flag) => Ok(flag.to_string()),
                other => Err(format!("`args` entries must be strings, got: {other}")),
            })
            .collect(),
        Some(other) => Err(format!("`args` must be an array of strings, got: {other}")),
    }
}

fn handler<'a>(_snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let code = optional_string_arg(args, "code");
        let file = optional_string_arg(args, "file");
        let extra_args = args_arg(args)?;
        let timeout_ms = integer_arg(args, "timeout_ms")
            .unwrap_or(i64::from(DEFAULT_PYTHON_TIMEOUT_MS))
            .clamp(
                i64::from(MIN_PYTHON_TIMEOUT_MS),
                i64::from(MAX_PYTHON_TIMEOUT_MS),
            ) as u32;

        let response = match (code, file) {
            (Some(code), None) => run_python_code(&code, timeout_ms).await?,
            (None, Some(file)) => run_python_file(&file, &extra_args, timeout_ms).await?,
            (Some(_), Some(_)) => {
                return Err(
                    "Provide exactly one of `code` or `file` to run_python, not both.".to_string(),
                );
            }
            (None, None) => {
                return Err(
                    "run_python needs exactly one of `code` (inline source) or `file` \
                     (workspace entry script)."
                        .to_string(),
                );
            }
        };

        let transcript = response.to_transcript();
        if response.ok {
            Ok(transcript)
        } else {
            Err(transcript)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::ToolRegistry;

    fn execute(arguments: Value) -> crate::state::ToolResult {
        let registry = ToolRegistry::new();
        let mut snapshot = AppSnapshot::default();
        pollster::block_on(registry.execute(
            &mut snapshot,
            "call-py".to_string(),
            "run_python",
            arguments,
        ))
    }

    #[test]
    fn spec_requires_exactly_one_input_and_warns_about_exit_codes() {
        let spec = spec();
        assert_eq!(spec.name, "run_python");
        assert!(spec.description.contains("exactly one"));
        assert!(
            spec.description
                .contains("exit_code 0 is the ONLY proof of success")
        );
        let properties = &spec.input_schema["properties"];
        for key in ["code", "file", "args", "timeout_ms"] {
            assert!(properties.get(key).is_some(), "missing property {key}");
        }
    }

    #[test]
    fn rejects_both_code_and_file() {
        let result = execute(json!({ "code": "print(1)", "file": "main.py" }));
        assert!(!result.ok);
        assert!(result.content.contains("not both"));
    }

    #[test]
    fn rejects_neither_code_nor_file() {
        let result = execute(json!({}));
        assert!(!result.ok);
        assert!(result.content.contains("exactly one"));
    }

    #[test]
    fn rejects_non_string_args_entries() {
        let result = execute(json!({ "file": "main.py", "args": [{ "bad": true }] }));
        assert!(!result.ok);
        assert!(result.content.contains("`args` entries must be strings"));
    }

    #[test]
    fn args_accept_scalars_and_stringify_them() {
        let parsed = args_arg(&json!({ "args": ["x", 5, true] })).expect("parse args");
        assert_eq!(
            parsed,
            vec!["x".to_string(), "5".to_string(), "true".to_string()]
        );
        assert_eq!(
            args_arg(&json!({})).expect("absent args"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn host_execution_reports_browser_only() {
        // On the host build the runtime is unavailable; the tool must surface that
        // as a clear failed result rather than a panic or a fake success.
        let result = execute(json!({ "code": "print(1)" }));
        assert!(!result.ok);
        assert!(
            result
                .content
                .contains("only available in the browser runtime")
        );
    }
}
