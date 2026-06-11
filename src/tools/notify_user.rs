//! `notify_user` — surface a system notification so the assistant can get the
//! user's attention even when this tab is in the background. Permission is the
//! browser's standard notification prompt.

use crate::capabilities::system;
use crate::state::{AppSnapshot, ToolSpec};
use serde_json::{Value, json};

use super::common::{optional_string_arg, string_arg};
use super::{ToolDescriptor, ToolFuture};

pub(crate) fn descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: spec(),
        handler,
    }
}

fn spec() -> ToolSpec {
    ToolSpec {
        name: "notify_user".to_string(),
        description: "Show a system notification to the user (the browser asks for \
                      notification permission on first use). Use for important, \
                      user-relevant moments — completions, reminders, things needing \
                      attention — not routine progress."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "title": { "type": "string" },
                "body": { "type": "string" }
            },
            "required": ["title"]
        }),
    }
}

fn handler<'a>(_snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let title = string_arg(args, "title")?;
        let body = optional_string_arg(args, "body").unwrap_or_default();
        system::show_notification(&title, &body).await?;
        Ok("Notification shown.".to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_shape_is_stable() {
        let spec = spec();
        assert_eq!(spec.name, "notify_user");
        assert_eq!(spec.input_schema["required"], json!(["title"]));
    }
}
