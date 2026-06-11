//! `screen_capture` — grab one frame of a screen/window/tab the user picks.
//! Browsers require a fresh user gesture for `getDisplayMedia`, so this tool
//! works best right after the user clicks something; mid-run calls may be
//! rejected by the browser and surface that error to the model.

use crate::capabilities::media;
use crate::state::{AppSnapshot, ToolSpec};
use crate::storage::opfs_vfs::OpfsVfs;
use serde_json::{Value, json};
use uuid::Uuid;

use super::camera_capture::attach_image_artifact;
use super::{ToolDescriptor, ToolFuture};

pub(crate) fn descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: spec(),
        handler,
    }
}

fn spec() -> ToolSpec {
    ToolSpec {
        name: "screen_capture".to_string(),
        description: "Capture one still frame of a screen, window, or tab — the browser \
                      shows a picker and the user chooses what to share. May be rejected \
                      without a recent user gesture. Saves a PNG into the workspace \
                      filesystem and attaches it to the run as an image artifact."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "max_width": {
                    "type": "integer",
                    "description": "Downscale the frame to at most this many pixels wide (default 1600)."
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
            .unwrap_or(1600)
            .clamp(64, 4096) as u32;
        let image = media::capture_screen_frame(max_width).await?;

        let path = format!("captures/screen-{}.png", &Uuid::new_v4().to_string()[..8]);
        OpfsVfs::new()
            .write_bytes(&path, &image.bytes)
            .await
            .map_err(|err| format!("captured frame could not be saved: {err}"))?;

        attach_image_artifact(snapshot, "Screen capture", &image.data_url);
        Ok(format!(
            "Captured {}x{} screen frame, saved to {} ({} KiB).",
            image.width,
            image.height,
            path,
            image.bytes.len() / 1024
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_shape_is_stable() {
        assert_eq!(spec().name, "screen_capture");
    }
}
