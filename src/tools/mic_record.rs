//! `mic_record` — record a short microphone clip. The browser's permission
//! prompt gates device access; the clip is saved into the OPFS workspace where
//! the local transcriber (or the user) can pick it up. Recording executes on
//! the page via [`crate::worker::page_proxy`].

use crate::capabilities::page_ops::PageOp;
use crate::state::{AppSnapshot, ToolSpec};
use crate::worker::page_proxy::run_page_op;
use serde_json::{Value, json};

use super::{ToolDescriptor, ToolFuture};

pub(crate) fn descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: spec(),
        handler,
    }
}

fn spec() -> ToolSpec {
    ToolSpec {
        name: "mic_record".to_string(),
        description: "Record audio from the user's microphone for a few seconds (the \
                      browser asks the user for permission). Saves the clip into the \
                      workspace filesystem and returns its path, duration, and format. \
                      Pair with `transcribe_audio` to turn the clip into text."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "seconds": {
                    "type": "number",
                    "description": "Recording length in seconds, 0.5–60 (default 5)."
                }
            }
        }),
    }
}

fn handler<'a>(_snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let seconds = args.get("seconds").and_then(Value::as_f64).unwrap_or(5.0);
        let envelope = run_page_op(PageOp::MicRecord { seconds }).await?;
        let clip: Value = serde_json::from_str(&envelope)
            .map_err(|err| format!("recording envelope was not JSON: {err}"))?;

        Ok(format!(
            "Recorded {:.1}s of audio ({}, {} KiB), saved to {}.",
            clip.get("seconds").and_then(Value::as_f64).unwrap_or(0.0),
            clip.get("mime").and_then(Value::as_str).unwrap_or("?"),
            clip.get("kib").and_then(Value::as_u64).unwrap_or(0),
            clip.get("path").and_then(Value::as_str).unwrap_or("?"),
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_shape_is_stable() {
        let spec = spec();
        assert_eq!(spec.name, "mic_record");
        assert!(spec.input_schema["properties"]["seconds"].is_object());
    }
}
