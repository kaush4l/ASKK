//! `mic_record` — record a short microphone clip. The browser's permission
//! prompt gates device access; the clip is saved into the OPFS workspace where
//! the local transcriber (or the user) can pick it up.

use crate::capabilities::media;
use crate::state::{AppSnapshot, ToolSpec};
use crate::storage::opfs_vfs::OpfsVfs;
use serde_json::{Value, json};
use uuid::Uuid;

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
        let clip = media::record_microphone(seconds).await?;

        let extension = if clip.mime.contains("ogg") {
            "ogg"
        } else {
            "webm"
        };
        let path = format!(
            "captures/mic-{}.{extension}",
            &Uuid::new_v4().to_string()[..8]
        );
        OpfsVfs::new()
            .write_bytes(&path, &clip.bytes)
            .await
            .map_err(|err| format!("recording could not be saved: {err}"))?;

        Ok(format!(
            "Recorded {:.1}s of audio ({}, {} KiB), saved to {}.",
            clip.seconds,
            clip.mime,
            clip.bytes.len() / 1024,
            path
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
