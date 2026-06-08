//! `run_in_sandbox` — run a command in the in-browser execution sandbox, with no
//! local bridge and no native runtime.
//!
//! This tool is the agent-facing entry point to the execution-capability seam
//! ([`crate::engine::exec_capability`]): the socket a general in-browser code
//! substrate (WASI, container2wasm, …) will plug into to eventually replace the
//! bridge's `run_command`. Today the seam's only backend is a worker stub, so
//! this tool returns a clear "not yet wired to a real substrate" result — the
//! point is that the full path (loop → tool → seam → worker) exists end to end.
//! The bridge `run_command` tool stays as the working fallback.

use crate::engine::exec_capability::{BrowserExecutor, ExecRequest, WorkerBackedExecStub};
use crate::state::{AppSnapshot, ToolSpec};
use serde_json::{Value, json};

use super::common::{integer_arg, string_arg};
use super::{ToolDescriptor, ToolFuture};

pub(crate) fn descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: spec(),
        handler,
    }
}

fn spec() -> ToolSpec {
    ToolSpec {
        name: "run_in_sandbox".to_string(),
        description: "Run a command in the in-browser execution sandbox (no local bridge, no native runtime). Mirrors run_command's contract — returns exit_code, ok, stdout, and stderr — but executes entirely inside the tab. NOTE: the sandbox is not yet wired to a real execution substrate, so calls currently return ok:false explaining that no binary was run; use run_command (via the local bridge) to actually run commands for now.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "command": { "type": "string", "description": "Command line to run, e.g. 'bun install' or 'cargo test'." },
                "cwd": { "type": "string", "description": "Optional working directory, relative to the sandbox run root." },
                "timeout_ms": { "type": "integer", "description": "Optional hard per-command timeout in milliseconds." }
            },
            "required": ["command"]
        }),
    }
}

fn handler<'a>(_snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let command = string_arg(args, "command")?;
        let cwd = args
            .get("cwd")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let timeout_ms = integer_arg(args, "timeout_ms")
            .filter(|value| *value > 0)
            .map(|value| value.clamp(1, u32::MAX as i64) as u32);

        let request = ExecRequest {
            command,
            cwd,
            timeout_ms,
        };
        // The seam returns a structured ExecResponse as untrusted DATA; we render
        // it to a transcript and map a non-zero exit onto a failed tool result.
        let response = WorkerBackedExecStub::new().run_command(request).await?;
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

    #[test]
    fn descriptor_advertises_run_in_sandbox_spec() {
        let descriptor = descriptor();
        assert_eq!(descriptor.spec.name, "run_in_sandbox");
        let required = descriptor.spec.input_schema["required"]
            .as_array()
            .expect("required array");
        assert!(required.iter().any(|value| value == "command"));
    }

    #[test]
    fn handler_returns_not_wired_failure_for_now() {
        let mut snapshot = AppSnapshot::default();
        let result =
            pollster::block_on(handler(&mut snapshot, &json!({ "command": "cargo test" })));
        // Until a real substrate is wired in, the seam reports a clear failure.
        let err = result.expect_err("stub should report a non-zero exit");
        assert!(err.contains("ok: false"));
        assert!(err.contains("not yet wired"));
        assert!(err.contains("cargo test"));
    }

    #[test]
    fn handler_rejects_missing_command() {
        let mut snapshot = AppSnapshot::default();
        let result = pollster::block_on(handler(&mut snapshot, &json!({})));
        assert!(result.is_err());
    }
}
