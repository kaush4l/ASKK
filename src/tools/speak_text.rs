//! `speak_text` — voice output via the browser's built-in speech synthesis.
//! Queues the utterance and returns immediately; nothing blocks the run while
//! the browser speaks. Executes on the page via [`crate::worker::page_proxy`].

use crate::capabilities::page_ops::PageOp;
use crate::state::{AppSnapshot, ToolSpec};
use crate::worker::page_proxy::run_page_op;
use serde_json::{Value, json};

use super::common::string_arg;
use super::{ToolDescriptor, ToolFuture};

pub(crate) fn descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: spec(),
        handler,
    }
}

fn spec() -> ToolSpec {
    ToolSpec {
        name: "speak_text".to_string(),
        description: "Speak the given text aloud through the device's speakers using the \
                      browser's built-in text-to-speech. Returns as soon as speech is \
                      queued."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "text": { "type": "string" }
            },
            "required": ["text"]
        }),
    }
}

fn handler<'a>(_snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let text = string_arg(args, "text")?;
        let chars = text.len();
        run_page_op(PageOp::Speak { text }).await?;
        Ok(format!("Speaking {chars} characters aloud."))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_shape_is_stable() {
        let spec = spec();
        assert_eq!(spec.name, "speak_text");
        assert_eq!(spec.input_schema["required"], json!(["text"]));
    }
}
