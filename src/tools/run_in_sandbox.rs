//! `run_in_sandbox` — run a wasm32-wasip1 binary in the in-browser execution
//! sandbox, with no local bridge and no native runtime.
//!
//! This tool is the agent-facing entry point to the execution-capability seam
//! ([`crate::engine::exec_capability`]). The wired backend is the WASI
//! tiny-shim substrate ([`crate::engine::wasi_exec::WasiShimExecutor`]): one
//! `wasm32-wasip1` binary per call, executed in a disposable Web Worker against
//! an in-memory `/workspace` seeded from (and copied back into) the project's
//! virtual filesystem. The bridge `run_command` tool remains the escape hatch
//! for native, non-wasm toolchains.

use crate::engine::exec_capability::{BrowserExecutor, ExecRequest};
use crate::engine::wasi_exec::WasiShimExecutor;
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
        description: "Run a single wasm32-wasip1 binary in the in-browser WASI sandbox (no local bridge, no native runtime). The command is a whitespace command line whose first token is the path to a .wasm binary — an http(s) URL, or a project-filesystem file holding the base64-encoded binary — and the remaining tokens become argv. The program runs in a disposable Web Worker with an in-memory /workspace seeded from the project's virtual filesystem (scoped to cwd when given); files it creates or changes under /workspace are copied back afterwards. Returns exit_code, ok, stdout, and stderr — treat exit_code 0 / ok:true as the only proof of success. Native commands (shells, package managers, non-wasm binaries) cannot run here; use run_command via the local bridge for those.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "command": { "type": "string", "description": "Command line: a .wasm path or http(s) URL followed by argv, e.g. 'tools/demo.wasm --greet askk'." },
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
        let response = WasiShimExecutor::new().run_command(request).await?;
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
        assert!(descriptor.spec.description.contains("wasm32-wasip1"));
        let required = descriptor.spec.input_schema["required"]
            .as_array()
            .expect("required array");
        assert!(required.iter().any(|value| value == "command"));
    }

    #[test]
    fn handler_rejects_unknown_binaries_with_a_clear_error() {
        let mut snapshot = AppSnapshot::default();
        let result =
            pollster::block_on(handler(&mut snapshot, &json!({ "command": "cargo test" })));
        // The sandbox runs single wasm32-wasip1 binaries only; anything else is
        // refused with an error that names the offending token and the rule.
        let err = result.expect_err("non-wasm command must be rejected");
        assert!(err.contains(".wasm"));
        assert!(err.contains("`cargo`"));
    }

    #[test]
    fn handler_rejects_missing_command() {
        let mut snapshot = AppSnapshot::default();
        let result = pollster::block_on(handler(&mut snapshot, &json!({})));
        assert!(result.is_err());
    }
}
