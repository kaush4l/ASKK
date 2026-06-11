//! `transcribe_audio` — turn an audio file in the OPFS workspace into text with
//! the in-browser Whisper runtime (transformers.js on WebGPU; no audio leaves
//! the machine). Task `"translate"` produces English regardless of the spoken
//! language. The first call downloads and caches the model. Executes on the
//! page via [`crate::worker::page_proxy`].

use crate::capabilities::page_ops::PageOp;
use crate::state::{AppSnapshot, ToolSpec};
use crate::worker::page_proxy::run_page_op;
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
        name: "transcribe_audio".to_string(),
        description: "Transcribe an audio file from the workspace filesystem entirely \
                      in-browser (local Whisper — audio never leaves the device). Use \
                      task 'translate' to get English text from any spoken language. \
                      Typically follows `mic_record`. First use downloads the model \
                      (~80 MB) and may take a while."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Workspace path of the audio file, e.g. captures/mic-ab12cd34.webm"
                },
                "task": {
                    "type": "string",
                    "enum": ["transcribe", "translate"],
                    "description": "transcribe = same language; translate = into English (default transcribe)."
                },
                "language": {
                    "type": "string",
                    "description": "Source language hint like 'en', 'hi', 'ja' (optional; auto-detected)."
                },
                "model": {
                    "type": "string",
                    "description": "Override the ASR model id (default onnx-community/whisper-base; use onnx-community/whisper-large-v3-turbo for quality)."
                }
            },
            "required": ["path"]
        }),
    }
}

fn handler<'a>(_snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let path = string_arg(args, "path")?;
        let task = optional_string_arg(args, "task").unwrap_or_else(|| "transcribe".to_string());
        if task != "transcribe" && task != "translate" {
            return Err(format!(
                "unknown task `{task}` — use \"transcribe\" or \"translate\""
            ));
        }
        let envelope = run_page_op(PageOp::Transcribe {
            path,
            task,
            language: optional_string_arg(args, "language"),
            model: optional_string_arg(args, "model"),
        })
        .await?;
        let parsed: Value = serde_json::from_str(&envelope)
            .map_err(|err| format!("transcription envelope was not JSON: {err}"))?;
        let text = parsed
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        if text.is_empty() {
            return Ok("(no speech detected)".to_string());
        }
        Ok(text)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_shape_is_stable() {
        let spec = spec();
        assert_eq!(spec.name, "transcribe_audio");
        assert_eq!(spec.input_schema["required"], json!(["path"]));
    }
}
