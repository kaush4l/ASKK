//! Page-side bridge to the vendored local-AI runtime (`assets/local_ai.js` +
//! its Web Worker, built from `scripts/local-ai/`): Whisper transcription and
//! Gemma 4 generation running entirely in this browser via transformers.js on
//! WebGPU. Model weights download from the Hugging Face Hub on first use (or
//! from the same-origin `models/` directory when staged — see
//! `scripts/models/`) and cache locally.
//!
//! Page-thread only (the bundle owns an `AudioContext` and a worker); callers
//! in worker contexts reach it through
//! [`crate::worker::page_proxy::run_page_op`].

// Glob import: the `asset!` macro expands to `manganis` items that only the
// full prelude brings into scope (same pattern as `worker::client`).
#[cfg(target_arch = "wasm32")]
use dioxus::prelude::*;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::{JsCast, JsValue};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_futures::JsFuture;

#[cfg(target_arch = "wasm32")]
const LOCAL_AI_JS: Asset = asset!("/assets/local_ai.js");
#[cfg(target_arch = "wasm32")]
const LOCAL_AI_WORKER_JS: Asset = asset!("/assets/local_ai_worker.js");

/// Default in-browser ASR model (77 MB-class download, fast on WebGPU).
pub const DEFAULT_ASR_MODEL: &str = "onnx-community/whisper-base";
/// Default in-browser LLM: Gemma 4 E2B instruction-tuned, ONNX q4f16
/// (~3.4 GB download; text + image + audio capable).
pub const DEFAULT_LLM_MODEL: &str = "onnx-community/gemma-4-E2B-it-ONNX";

/// Inject the bundle (idempotent) and initialize its worker. Resolves once
/// `window.AskkLocalAI` is ready.
#[cfg(target_arch = "wasm32")]
async fn ensure_loaded() -> Result<js_sys::Object, String> {
    let window = web_sys::window()
        .ok_or_else(|| "no window: the local-AI bridge must run on the page thread".to_string())?;

    let existing = js_sys::Reflect::get(&window, &JsValue::from_str("AskkLocalAI"))
        .ok()
        .filter(|value| value.is_object());
    if existing.is_none() {
        // Load the IIFE once by appending a script tag and awaiting onload, then
        // initialize with the hashed worker-bundle URL and the same-origin model
        // base (`models/` next to the deployed page, used when weights are staged).
        let glue = format!(
            r#"(async () => {{
                if (!window.AskkLocalAI) {{
                    await new Promise((resolve, reject) => {{
                        const tag = document.createElement("script");
                        tag.src = "{src}";
                        tag.onload = resolve;
                        tag.onerror = () => reject(new Error("local_ai.js failed to load"));
                        document.head.appendChild(tag);
                    }});
                }}
                await window.AskkLocalAI.init({{
                    workerUrl: "{worker}",
                    modelBase: new URL("models/", document.baseURI).href,
                }});
                return "ok";
            }})()"#,
            src = LOCAL_AI_JS,
            worker = LOCAL_AI_WORKER_JS,
        );
        let promise = js_sys::eval(&glue)
            .map_err(|err| format!("local-AI bootstrap failed to start: {err:?}"))?;
        JsFuture::from(js_sys::Promise::from(promise))
            .await
            .map_err(|err| format!("local-AI bootstrap failed: {}", js_error_text(&err)))?;
    }

    js_sys::Reflect::get(&window, &JsValue::from_str("AskkLocalAI"))
        .ok()
        .and_then(|value| value.dyn_into::<js_sys::Object>().ok())
        .ok_or_else(|| "AskkLocalAI did not appear after bootstrap".to_string())
}

/// Call an async method on `window.AskkLocalAI` with one options object.
#[cfg(target_arch = "wasm32")]
async fn call_bridge(method: &str, options: &JsValue) -> Result<JsValue, String> {
    let bridge = ensure_loaded().await?;
    let function = js_sys::Reflect::get(&bridge, &JsValue::from_str(method))
        .ok()
        .and_then(|value| value.dyn_into::<js_sys::Function>().ok())
        .ok_or_else(|| format!("AskkLocalAI.{method} is not a function"))?;
    let promise = function
        .call1(&bridge, options)
        .map_err(|err| format!("AskkLocalAI.{method} threw: {}", js_error_text(&err)))?;
    JsFuture::from(js_sys::Promise::from(promise))
        .await
        .map_err(|err| format!("AskkLocalAI.{method} failed: {}", js_error_text(&err)))
}

/// Transcribe (task `"transcribe"`) or translate to English (task
/// `"translate"`) an audio file stored in the OPFS workspace. Returns
/// `{"text", "model"}` JSON.
#[cfg(target_arch = "wasm32")]
pub async fn transcribe(
    path: &str,
    task: &str,
    language: Option<&str>,
    model: Option<&str>,
) -> Result<String, String> {
    use crate::storage::opfs_vfs::OpfsVfs;

    let bytes = OpfsVfs::new()
        .read_bytes(path)
        .await
        .map_err(|err| format!("audio read error: {err}"))?
        .ok_or_else(|| format!("no audio file at {path}"))?;
    let mime = mime_for_path(path);

    let options = js_sys::Object::new();
    let array = js_sys::Uint8Array::from(bytes.as_slice());
    set(&options, "bytes", array.into())?;
    set(&options, "mime", JsValue::from_str(mime))?;
    set(&options, "task", JsValue::from_str(task))?;
    if let Some(language) = language {
        set(&options, "language", JsValue::from_str(language))?;
    }
    set(
        &options,
        "model",
        JsValue::from_str(model.unwrap_or(DEFAULT_ASR_MODEL)),
    )?;

    let result = call_bridge("transcribe", &options.into()).await?;
    js_result_to_json(&result)
}

/// Generate text from a `[{role, content}]` transcript with the in-browser
/// Gemma model. Returns `{"text", "model"}` JSON.
#[cfg(target_arch = "wasm32")]
pub async fn generate(
    model: Option<&str>,
    messages: &serde_json::Value,
    max_tokens: u32,
    temperature: f64,
) -> Result<String, String> {
    let options = js_sys::Object::new();
    set(
        &options,
        "model",
        JsValue::from_str(model.unwrap_or(DEFAULT_LLM_MODEL)),
    )?;
    let parsed = js_sys::JSON::parse(&messages.to_string())
        .map_err(|err| format!("messages did not parse as JSON: {err:?}"))?;
    set(&options, "messages", parsed)?;
    set(
        &options,
        "maxTokens",
        JsValue::from_f64(f64::from(max_tokens)),
    )?;
    set(&options, "temperature", JsValue::from_f64(temperature))?;

    let result = call_bridge("generate", &options.into()).await?;
    js_result_to_json(&result)
}

#[cfg(target_arch = "wasm32")]
fn set(target: &js_sys::Object, key: &str, value: JsValue) -> Result<(), String> {
    js_sys::Reflect::set(target, &JsValue::from_str(key), &value)
        .map(|_| ())
        .map_err(|err| format!("could not build bridge options: {err:?}"))
}

/// Stringify a bridge result object (`{text, model, ...}`) to a JSON envelope.
#[cfg(target_arch = "wasm32")]
fn js_result_to_json(value: &JsValue) -> Result<String, String> {
    js_sys::JSON::stringify(value)
        .ok()
        .and_then(|text| text.as_string())
        .ok_or_else(|| "local-AI bridge returned a non-JSON value".to_string())
}

#[cfg(target_arch = "wasm32")]
fn js_error_text(err: &JsValue) -> String {
    err.as_string()
        .or_else(|| {
            js_sys::Reflect::get(err, &JsValue::from_str("message"))
                .ok()
                .and_then(|message| message.as_string())
        })
        .unwrap_or_else(|| format!("{err:?}"))
}

/// Best-effort MIME from a capture path's extension (the decoder sniffs the
/// container anyway; this is advisory).
pub fn mime_for_path(path: &str) -> &'static str {
    let lowered = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match lowered.as_str() {
        "ogg" | "oga" => "audio/ogg",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "m4a" | "mp4" => "audio/mp4",
        "flac" => "audio/flac",
        _ => "audio/webm",
    }
}

// ── Host stubs ──────────────────────────────────────────────────────────────

#[cfg(not(target_arch = "wasm32"))]
pub async fn transcribe(
    _path: &str,
    _task: &str,
    _language: Option<&str>,
    _model: Option<&str>,
) -> Result<String, String> {
    Err("in-browser transcription requires the browser build".to_string())
}

#[cfg(not(target_arch = "wasm32"))]
pub async fn generate(
    _model: Option<&str>,
    _messages: &serde_json::Value,
    _max_tokens: u32,
    _temperature: f64,
) -> Result<String, String> {
    Err("in-browser generation requires the browser build".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mime_lookup_covers_capture_formats() {
        assert_eq!(mime_for_path("captures/mic-1.webm"), "audio/webm");
        assert_eq!(mime_for_path("a/b/c.OGG"), "audio/ogg");
        assert_eq!(mime_for_path("x.wav"), "audio/wav");
        assert_eq!(mime_for_path("noext"), "audio/webm");
    }
}
