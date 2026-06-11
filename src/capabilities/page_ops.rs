//! Page-thread operations: the typed set of things only the page (window)
//! context can do — device capture, geolocation, clipboard, notifications,
//! speech, capability probing, and local-model calls.
//!
//! Agent runs execute inside a Web Worker where none of these APIs exist, so
//! tools never call the helpers directly. They go through
//! [`crate::worker::page_proxy::run_page_op`], which executes [`execute_page_op`]
//! in place when a window is present and otherwise round-trips the op to the
//! page over the worker's message channel. Results are small JSON envelopes;
//! captured bytes land in OPFS (shared across contexts) rather than crossing
//! the channel.

use serde::{Deserialize, Serialize};
#[cfg(target_arch = "wasm32")]
use serde_json::json;

#[cfg(target_arch = "wasm32")]
use super::{media, system};

/// One operation that must run on the page thread. Serializable because it may
/// cross the worker↔page message channel.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum PageOp {
    CameraFrame {
        max_width: u32,
    },
    ScreenFrame {
        max_width: u32,
    },
    MicRecord {
        seconds: f64,
    },
    Geolocate {
        timeout_ms: u32,
    },
    ClipboardRead,
    ClipboardWrite {
        text: String,
    },
    Notify {
        title: String,
        body: String,
    },
    Speak {
        text: String,
    },
    Probe,
    /// Transcribe (or translate to English) an audio file in the OPFS workspace
    /// with the in-browser Whisper runtime.
    Transcribe {
        path: String,
        task: String,
        language: Option<String>,
        model: Option<String>,
    },
    /// Generate text with the in-browser Gemma runtime.
    Generate {
        model: Option<String>,
        /// `[{role, content}]` chat transcript, already composed by the caller.
        messages: serde_json::Value,
        max_tokens: u32,
        temperature: f64,
    },
}

/// Execute an op in the current (page) context. Every arm returns a compact
/// JSON envelope so worker-proxied and in-place calls observe identical shapes.
#[cfg(target_arch = "wasm32")]
pub async fn execute_page_op(op: &PageOp) -> Result<String, String> {
    use crate::storage::opfs_vfs::OpfsVfs;

    match op {
        PageOp::CameraFrame { max_width } => {
            let image = media::capture_camera_frame(*max_width).await?;
            let path = format!("captures/cam-{}.png", short_id());
            OpfsVfs::new()
                .write_bytes(&path, &image.bytes)
                .await
                .map_err(|err| format!("captured frame could not be saved: {err}"))?;
            Ok(json!({
                "path": path,
                "width": image.width,
                "height": image.height,
                "kib": image.bytes.len() / 1024,
                "data_url": image.data_url,
            })
            .to_string())
        }
        PageOp::ScreenFrame { max_width } => {
            let image = media::capture_screen_frame(*max_width).await?;
            let path = format!("captures/screen-{}.png", short_id());
            OpfsVfs::new()
                .write_bytes(&path, &image.bytes)
                .await
                .map_err(|err| format!("captured frame could not be saved: {err}"))?;
            Ok(json!({
                "path": path,
                "width": image.width,
                "height": image.height,
                "kib": image.bytes.len() / 1024,
                "data_url": image.data_url,
            })
            .to_string())
        }
        PageOp::MicRecord { seconds } => {
            let clip = media::record_microphone(*seconds).await?;
            let extension = if clip.mime.contains("ogg") {
                "ogg"
            } else {
                "webm"
            };
            let path = format!("captures/mic-{}.{extension}", short_id());
            OpfsVfs::new()
                .write_bytes(&path, &clip.bytes)
                .await
                .map_err(|err| format!("recording could not be saved: {err}"))?;
            Ok(json!({
                "path": path,
                "mime": clip.mime,
                "seconds": clip.seconds,
                "kib": clip.bytes.len() / 1024,
            })
            .to_string())
        }
        PageOp::Geolocate { timeout_ms } => {
            let fix = system::current_position(*timeout_ms).await?;
            serde_json::to_string(&fix)
                .map_err(|err| format!("position serialization failed: {err}"))
        }
        PageOp::ClipboardRead => {
            let text = system::clipboard_read_text().await?;
            Ok(json!({ "text": text }).to_string())
        }
        PageOp::ClipboardWrite { text } => {
            system::clipboard_write_text(text).await?;
            Ok(json!({ "chars": text.len() }).to_string())
        }
        PageOp::Notify { title, body } => {
            system::show_notification(title, body).await?;
            Ok(json!({ "shown": true }).to_string())
        }
        PageOp::Speak { text } => {
            system::speak_text(text)?;
            Ok(json!({ "queued_chars": text.len() }).to_string())
        }
        PageOp::Probe => {
            let report = super::probe().await?;
            serde_json::to_string_pretty(&report)
                .map_err(|err| format!("capability report serialization failed: {err}"))
        }
        PageOp::Transcribe {
            path,
            task,
            language,
            model,
        } => super::local_ai::transcribe(path, task, language.as_deref(), model.as_deref()).await,
        PageOp::Generate {
            model,
            messages,
            max_tokens,
            temperature,
        } => super::local_ai::generate(model.as_deref(), messages, *max_tokens, *temperature).await,
    }
}

/// Host stub: page ops exist only in the browser build.
#[cfg(not(target_arch = "wasm32"))]
pub async fn execute_page_op(_op: &PageOp) -> Result<String, String> {
    Err("page operations require the browser build".to_string())
}

#[cfg(target_arch = "wasm32")]
fn short_id() -> String {
    uuid::Uuid::new_v4().to_string()[..8].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_ops_round_trip_through_json() {
        let ops = vec![
            PageOp::CameraFrame { max_width: 640 },
            PageOp::ClipboardWrite {
                text: "hi".to_string(),
            },
            PageOp::Transcribe {
                path: "captures/mic-1.webm".to_string(),
                task: "transcribe".to_string(),
                language: None,
                model: None,
            },
            PageOp::Generate {
                model: Some("gemma-4-e2b".to_string()),
                messages: serde_json::json!([{ "role": "user", "content": "hello" }]),
                max_tokens: 256,
                temperature: 0.7,
            },
        ];
        for op in ops {
            let encoded = serde_json::to_string(&op).unwrap();
            let decoded: PageOp = serde_json::from_str(&encoded).unwrap();
            assert_eq!(decoded, op);
        }
    }
}
