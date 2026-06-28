//! Camera, microphone, and screen capture (wasm-only; host builds get stubs).
//!
//! Each helper opens the device, captures once, and releases every track before
//! returning — no stream outlives its call. The Capabilities page also opens
//! longer-lived preview streams itself; these helpers are the one-shot path the
//! capability tools share with the page's "capture" buttons.

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::{JsCast, JsValue, closure::Closure};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_futures::JsFuture;
#[cfg(target_arch = "wasm32")]
use web_sys::{
    Blob, BlobEvent, CanvasRenderingContext2d, HtmlCanvasElement, HtmlVideoElement, MediaDevices,
    MediaRecorder, MediaStream, MediaStreamConstraints, MediaStreamTrack,
};

/// One captured still frame, both as raw PNG bytes (for the OPFS workspace) and
/// as a `data:` URL (for chat artifacts).
#[derive(Debug, Clone)]
pub struct CapturedImage {
    pub data_url: String,
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// One captured audio clip (typically `audio/webm;codecs=opus`).
#[derive(Debug, Clone)]
pub struct CapturedAudio {
    pub bytes: Vec<u8>,
    pub mime: String,
    pub seconds: f64,
}

/// Capture a single webcam frame, downscaled to at most `max_width` px wide.
#[cfg(target_arch = "wasm32")]
pub async fn capture_camera_frame(max_width: u32) -> Result<CapturedImage, String> {
    let constraints = MediaStreamConstraints::new();
    constraints.set_video(&JsValue::TRUE);
    let stream = open_stream(&constraints).await?;
    let result = frame_from_stream(&stream, max_width).await;
    stop_all_tracks(&stream);
    result
}

/// Capture a single frame of a user-chosen screen/window/tab. The browser only
/// honors this with a fresh user gesture, so it can fail mid-run with
/// `NotAllowedError` when invoked as a tool — that error is surfaced as-is.
#[cfg(target_arch = "wasm32")]
pub async fn capture_screen_frame(max_width: u32) -> Result<CapturedImage, String> {
    let devices = media_devices()?;
    let promise = devices
        .get_display_media()
        .map_err(|err| format!("getDisplayMedia unavailable: {err:?}"))?;
    let stream: MediaStream = JsFuture::from(promise)
        .await
        .map_err(|err| format!("screen capture denied: {err:?}"))?
        .dyn_into()
        .map_err(|_| "getDisplayMedia returned a non-MediaStream".to_string())?;
    let result = frame_from_stream(&stream, max_width).await;
    stop_all_tracks(&stream);
    result
}

/// Record `seconds` of microphone audio via [`MediaRecorder`].
#[cfg(target_arch = "wasm32")]
pub async fn record_microphone(seconds: f64) -> Result<CapturedAudio, String> {
    use std::cell::RefCell;
    use std::rc::Rc;

    let seconds = seconds.clamp(0.5, 60.0);
    let constraints = MediaStreamConstraints::new();
    constraints.set_audio(&JsValue::TRUE);
    let stream = open_stream(&constraints).await?;

    let recorder = match MediaRecorder::new_with_media_stream(&stream) {
        Ok(recorder) => recorder,
        Err(err) => {
            stop_all_tracks(&stream);
            return Err(format!("MediaRecorder failed to start: {err:?}"));
        }
    };

    let chunks: Rc<RefCell<Vec<Blob>>> = Rc::new(RefCell::new(Vec::new()));
    let chunks_sink = Rc::clone(&chunks);
    let on_data = Closure::<dyn FnMut(BlobEvent)>::new(move |event: BlobEvent| {
        if let Some(blob) = event.data() {
            chunks_sink.borrow_mut().push(blob);
        }
    });
    recorder.set_ondataavailable(Some(on_data.as_ref().unchecked_ref()));

    let (stopped_tx, stopped_rx) = futures_channel::oneshot::channel::<()>();
    let mut stopped_tx = Some(stopped_tx);
    let on_stop = Closure::<dyn FnMut()>::new(move || {
        if let Some(tx) = stopped_tx.take() {
            let _ = tx.send(());
        }
    });
    recorder.set_onstop(Some(on_stop.as_ref().unchecked_ref()));

    let outcome = async {
        recorder
            .start()
            .map_err(|err| format!("recording failed to start: {err:?}"))?;
        gloo_timers::future::TimeoutFuture::new((seconds * 1000.0) as u32).await;
        recorder
            .stop()
            .map_err(|err| format!("recording failed to stop: {err:?}"))?;
        stopped_rx
            .await
            .map_err(|_| "recorder never reported stop".to_string())?;

        let mime = recorder.mime_type();
        let parts = js_sys::Array::new();
        for blob in chunks.borrow().iter() {
            parts.push(blob);
        }
        let combined = Blob::new_with_blob_sequence(&parts)
            .map_err(|err| format!("could not assemble recording: {err:?}"))?;
        let buffer = JsFuture::from(combined.array_buffer())
            .await
            .map_err(|err| format!("could not read recording: {err:?}"))?;
        let bytes = js_sys::Uint8Array::new(&buffer).to_vec();
        Ok(CapturedAudio {
            bytes,
            mime: if mime.is_empty() {
                "audio/webm".to_string()
            } else {
                mime
            },
            seconds,
        })
    }
    .await;

    recorder.set_ondataavailable(None);
    recorder.set_onstop(None);
    stop_all_tracks(&stream);
    outcome
}

#[cfg(target_arch = "wasm32")]
fn media_devices() -> Result<MediaDevices, String> {
    web_sys::window()
        .ok_or_else(|| "no window: media capture must run on the page thread".to_string())?
        .navigator()
        .media_devices()
        .map_err(|err| format!("mediaDevices unavailable: {err:?}"))
}

#[cfg(target_arch = "wasm32")]
async fn open_stream(constraints: &MediaStreamConstraints) -> Result<MediaStream, String> {
    let devices = media_devices()?;
    let promise = devices
        .get_user_media_with_constraints(constraints)
        .map_err(|err| format!("getUserMedia unavailable: {err:?}"))?;
    JsFuture::from(promise)
        .await
        .map_err(|err| format!("media access denied: {err:?}"))?
        .dyn_into()
        .map_err(|_| "getUserMedia returned a non-MediaStream".to_string())
}

/// Draw the first decoded frame of `stream` onto a canvas and encode as PNG.
#[cfg(target_arch = "wasm32")]
async fn frame_from_stream(stream: &MediaStream, max_width: u32) -> Result<CapturedImage, String> {
    let document = web_sys::window()
        .and_then(|win| win.document())
        .ok_or_else(|| "no document available".to_string())?;
    let video: HtmlVideoElement = document
        .create_element("video")
        .map_err(|err| format!("could not create video element: {err:?}"))?
        .dyn_into()
        .map_err(|_| "video element cast failed".to_string())?;
    video.set_autoplay(true);
    video.set_muted(true);
    video.set_src_object(Some(stream));
    if let Ok(promise) = video.play() {
        let _ = JsFuture::from(promise).await;
    }
    // Wait for real frame dimensions; cameras often need a few hundred ms to warm up.
    let mut tries = 0u32;
    while video.video_width() == 0 && tries < 50 {
        gloo_timers::future::TimeoutFuture::new(100).await;
        tries += 1;
    }
    let (src_w, src_h) = (video.video_width(), video.video_height());
    if src_w == 0 || src_h == 0 {
        return Err("camera produced no frames within 5s".to_string());
    }
    let scale = f64::from(max_width.max(64)).min(f64::from(src_w)) / f64::from(src_w);
    let (out_w, out_h) = (
        (f64::from(src_w) * scale) as u32,
        (f64::from(src_h) * scale) as u32,
    );

    let canvas: HtmlCanvasElement = document
        .create_element("canvas")
        .map_err(|err| format!("could not create canvas: {err:?}"))?
        .dyn_into()
        .map_err(|_| "canvas element cast failed".to_string())?;
    canvas.set_width(out_w);
    canvas.set_height(out_h);
    let context: CanvasRenderingContext2d = canvas
        .get_context("2d")
        .map_err(|err| format!("2d context unavailable: {err:?}"))?
        .ok_or_else(|| "2d context missing".to_string())?
        .dyn_into()
        .map_err(|_| "2d context cast failed".to_string())?;
    context
        .draw_image_with_html_video_element_and_dw_and_dh(
            &video,
            0.0,
            0.0,
            f64::from(out_w),
            f64::from(out_h),
        )
        .map_err(|err| format!("frame draw failed: {err:?}"))?;

    let data_url = canvas
        .to_data_url()
        .map_err(|err| format!("PNG encode failed: {err:?}"))?;
    let bytes = data_url_bytes(&data_url)?;
    Ok(CapturedImage {
        data_url,
        bytes,
        width: out_w,
        height: out_h,
    })
}

/// Decode the base64 payload of a `data:` URL into raw bytes using the
/// browser's own decoder (avoids a base64 crate dependency).
#[cfg(target_arch = "wasm32")]
fn data_url_bytes(data_url: &str) -> Result<Vec<u8>, String> {
    let payload = data_url
        .split_once(";base64,")
        .map(|(_, b64)| b64)
        .ok_or_else(|| "unexpected data URL shape".to_string())?;
    let window = web_sys::window().ok_or_else(|| "no window".to_string())?;
    let binary = window
        .atob(payload)
        .map_err(|err| format!("base64 decode failed: {err:?}"))?;
    // atob yields a latin-1 "binary string": one byte per char.
    Ok(binary.chars().map(|ch| ch as u8).collect())
}

/// Encode raw bytes as a `data:` URL (e.g. to feed a captured clip into an
/// `<audio>` element) using the browser's own encoder.
#[cfg(target_arch = "wasm32")]
pub fn bytes_to_data_url(bytes: &[u8], mime: &str) -> Result<String, String> {
    let binary: String = bytes.iter().map(|&byte| byte as char).collect();
    let window = web_sys::window().ok_or_else(|| "no window".to_string())?;
    let b64 = window
        .btoa(&binary)
        .map_err(|err| format!("base64 encode failed: {err:?}"))?;
    Ok(format!("data:{mime};base64,{b64}"))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn bytes_to_data_url(_bytes: &[u8], _mime: &str) -> Result<String, String> {
    Err("data URLs require the browser build".to_string())
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn stop_all_tracks(stream: &MediaStream) {
    for track in stream.get_tracks().iter() {
        track.unchecked_into::<MediaStreamTrack>().stop();
    }
}

// ── Host stubs: keep `cargo test` compiling without a browser. ─────────────

#[cfg(not(target_arch = "wasm32"))]
pub async fn capture_camera_frame(_max_width: u32) -> Result<CapturedImage, String> {
    Err("camera capture requires the browser build".to_string())
}

#[cfg(not(target_arch = "wasm32"))]
pub async fn capture_screen_frame(_max_width: u32) -> Result<CapturedImage, String> {
    Err("screen capture requires the browser build".to_string())
}

#[cfg(not(target_arch = "wasm32"))]
pub async fn record_microphone(_seconds: f64) -> Result<CapturedAudio, String> {
    Err("microphone capture requires the browser build".to_string())
}
