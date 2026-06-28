//! `run_js` — run JavaScript natively in the browser inside a sandboxed Web Worker,
//! with no bridge or network setup. This is the in-browser execute-and-test backend.

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
        name: "run_js".to_string(),
        description: "Run JavaScript natively in the browser, in a sandboxed Web Worker with no bridge or network setup required. The snippet is the body of an async function, so top-level `await` and `return` work; `console.log(...)` output is captured. Returns ok, stdout, stderr, result, and error. Use this to execute and TEST code in-browser: treat ok:true with the expected output as your verification that the code works.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "code": { "type": "string", "description": "JavaScript to run. Log with console.log; `return value` becomes the result." },
                "timeout_ms": { "type": "integer", "description": "Hard timeout in milliseconds (100-60000, default 10000)." }
            },
            "required": ["code"]
        }),
    }
}

fn handler<'a>(_snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let code = string_arg(args, "code")?;
        let timeout_ms = integer_arg(args, "timeout_ms")
            .unwrap_or(10_000)
            .clamp(100, 60_000) as u32;
        let value = crate::engine::browser_exec::run_js_in_browser(&code, timeout_ms).await?;
        let (ok, text) = crate::engine::browser_exec::format_run_js(&value);
        if ok { Ok(text) } else { Err(text) }
    })
}
