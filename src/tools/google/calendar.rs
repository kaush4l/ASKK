//! `gcal_events` — stub; full implementation in a later task.

use crate::state::AppSnapshot;
use crate::tools::{ToolDescriptor, ToolFuture, ToolSpec};
use serde_json::{Value, json};

pub(crate) fn descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: ToolSpec {
            name: "gcal_events".into(),
            description: "Fetch upcoming Google Calendar events (not yet implemented — connect Google on the Tools page).".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "days_ahead":  { "type": "integer" },
                    "max_results": { "type": "integer" }
                },
                "required": []
            }),
        },
        handler: handle,
    }
}

fn handle<'a>(_snap: &'a mut AppSnapshot, _args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move { Err("gcal_events requires the browser (WASM).".into()) })
}
