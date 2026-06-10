//! `gmail_search` — stub; full implementation in a later task.

use crate::state::AppSnapshot;
use crate::tools::{ToolDescriptor, ToolFuture, ToolSpec};
use serde_json::{Value, json};

pub(crate) fn descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: ToolSpec {
            name: "gmail_search".into(),
            description:
                "Search Gmail messages (not yet implemented — connect Google on the Tools page)."
                    .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query":       { "type": "string" },
                    "max_results": { "type": "integer" }
                },
                "required": []
            }),
        },
        handler: handle,
    }
}

fn handle<'a>(_snap: &'a mut AppSnapshot, _args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move { Err("gmail_search requires the browser (WASM).".into()) })
}
