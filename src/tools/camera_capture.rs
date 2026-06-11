//! `camera_capture` — grab one webcam frame. The browser's own permission
//! prompt is the user's approval gate for device access; the saved PNG lands in
//! the OPFS workspace and the frame is attached to the run as an image artifact
//! so the user sees exactly what the agent saw.

use crate::capabilities::media;
use crate::state::{AppSnapshot, ArtifactKind, RunArtifact, ToolSpec};
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
        name: "camera_capture".to_string(),
        description: "Capture one still frame from the user's webcam (the browser asks the \
                      user for permission). Saves a PNG into the workspace filesystem and \
                      attaches it to the run as an image artifact. Returns the saved path \
                      and dimensions."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "max_width": {
                    "type": "integer",
                    "description": "Downscale the frame to at most this many pixels wide (default 1280)."
                }
            }
        }),
    }
}

fn handler<'a>(snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let max_width = args
            .get("max_width")
            .and_then(Value::as_u64)
            .unwrap_or(1280)
            .clamp(64, 4096) as u32;
        let image = media::capture_camera_frame(max_width).await?;

        let path = format!("captures/cam-{}.png", short_id());
        OpfsVfs::new()
            .write_bytes(&path, &image.bytes)
            .await
            .map_err(|err| format!("captured frame could not be saved: {err}"))?;

        attach_image_artifact(snapshot, "Webcam capture", &image.data_url);
        Ok(format!(
            "Captured {}x{} webcam frame, saved to {} ({} KiB).",
            image.width,
            image.height,
            path,
            image.bytes.len() / 1024
        ))
    })
}

fn short_id() -> String {
    Uuid::new_v4().to_string()[..8].to_string()
}

/// Attach a captured image to the live run so the chat renders it.
pub(crate) fn attach_image_artifact(snapshot: &mut AppSnapshot, name: &str, data_url: &str) {
    if let Some(run) = snapshot.current_run.as_mut() {
        run.scratchpad.artifacts.push(RunArtifact {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            artifact_type: ArtifactKind::Image,
            content: data_url.to_string(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_shape_is_stable() {
        let spec = spec();
        assert_eq!(spec.name, "camera_capture");
        assert!(spec.input_schema["properties"]["max_width"].is_object());
    }
}
