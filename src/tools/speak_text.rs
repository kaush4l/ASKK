//! `speak_text` — voice output via the browser's built-in speech synthesis.
//! Queues the utterance and returns immediately; nothing blocks the run while
//! the browser speaks.

use crate::capabilities::system;
use crate::state::{AppSnapshot, ToolSpec};
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
        system::speak_text(&text)?;
        Ok(format!("Speaking {} characters aloud.", text.len()))
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
