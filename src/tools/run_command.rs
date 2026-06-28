//! `run_command` — run a shell command (bun, node, npm, git, …) inside the project
//! run root on the bridge machine. Requires the bridge started with `--allow-exec`.
//! This is how a runnable project is installed, built, run, and tested.

use crate::state::{AppSnapshot, ToolSpec};
use serde_json::{Value, json};

use super::bridge::{bridge_endpoint, bridge_tool_request};
use super::common::{integer_arg, merge_optional_string, string_arg};
use super::{ToolDescriptor, ToolFuture};

pub(crate) fn descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: spec(),
        handler,
    }
}

fn spec() -> ToolSpec {
    ToolSpec {
        name: "run_command".to_string(),
        description: "Run a shell command (bun, bunx, node, npm, npx, tsc, vitest, git, ls, cat, mkdir, …) inside the project run root on the bridge machine. Returns exit_code, ok, stdout, and stderr. Requires the bridge started with --allow-exec. This is how you install, build, run, and TEST a project: treat exit_code 0 (ok=true) as the only proof that a build or test step actually passed.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "command": { "type": "string", "description": "Command line to run, e.g. 'bun install' or 'bun test'." },
                "cwd": { "type": "string", "description": "Optional subdirectory of the run root to run in." },
                "timeout_ms": { "type": "integer", "description": "Optional per-command timeout in milliseconds." }
            },
            "required": ["command"]
        }),
    }
}

fn handler<'a>(snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let command = string_arg(args, "command")?;
        let mut body = json!({ "command": command });
        merge_optional_string(args, &mut body, "cwd", None);
        if let Some(timeout_ms) = integer_arg(args, "timeout_ms") {
            body["timeout_ms"] = json!(timeout_ms);
        }
        let endpoint = bridge_endpoint(&snapshot.tool_config.web_search, "run_command")?;
        bridge_tool_request("run_command", &endpoint, body).await
    })
}
