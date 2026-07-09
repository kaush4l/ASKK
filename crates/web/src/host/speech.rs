//! Speech seam (RealtimeTTS/STT pattern, browser edition): the engine
//! contract is one call per direction — `transcribe(f32 mono 16k) -> text`
//! and `speak(text) -> playback` — and the HF model id is the module
//! switch, opaque to everything above the seam. Engines live in vendored
//! bun-built bundles (`assets/speech/askk-{stt,tts}.js`, rebuilt by
//! `scripts/speech/build.sh`) that lazy-load on first use, download models
//! from the HF hub, and cache them in the browser. Host builds get inert
//! stubs so tests compile without a DOM.

/// Speech model picks, persisted as the `speech` pref. Empty = bundle
/// defaults (whisper-tiny.en / Kokoro-82M — small, run-anywhere).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SpeechConfig {
    pub stt_model: String,
    pub tts_model: String,
    pub voice: String,
}

impl SpeechConfig {
    pub fn from_json(value: &serde_json::Value) -> Self {
        let text = |key: &str| {
            value
                .get(key)
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        Self {
            stt_model: text("stt_model"),
            tts_model: text("tts_model"),
            voice: text("voice"),
        }
    }

    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "stt_model": self.stt_model,
            "tts_model": self.tts_model,
            "voice": self.voice,
        })
    }
}

#[cfg(target_arch = "wasm32")]
mod imp {
    use dioxus::prelude::*;
    use js_sys::{Function, Promise, Reflect};
    use wasm_bindgen::{JsCast, JsValue};
    use wasm_bindgen_futures::JsFuture;

    const STT_JS: Asset = asset!("/assets/speech/askk-stt.js");
    const STT_ORT_MJS: Asset = asset!("/assets/speech/stt-ort.mjs");
    const STT_ORT_WASM: Asset = asset!("/assets/speech/stt-ort.wasm");
    const TTS_JS: Asset = asset!("/assets/speech/askk-tts.js");
    const TTS_ORT_MJS: Asset = asset!("/assets/speech/tts-ort.mjs");
    const TTS_ORT_WASM: Asset = asset!("/assets/speech/tts-ort.wasm");

    fn err(ctx: &str, e: JsValue) -> String {
        format!(
            "{ctx}: {}",
            e.as_string().unwrap_or_else(|| format!("{e:?}"))
        )
    }

    fn get(obj: &JsValue, name: &str) -> Result<JsValue, String> {
        Reflect::get(obj, &JsValue::from_str(name)).map_err(|e| err(name, e))
    }

    /// Call `obj.name(...args)`; if it returns a Promise, await it.
    async fn call(obj: &JsValue, name: &str, args: &[JsValue]) -> Result<JsValue, String> {
        let func: Function = get(obj, name)?
            .dyn_into()
            .map_err(|_| format!("{name} is not a function"))?;
        let array = js_sys::Array::new();
        for arg in args {
            array.push(arg);
        }
        let out = Reflect::apply(&func, obj, &array).map_err(|e| err(name, e))?;
        match out.dyn_into::<Promise>() {
            Ok(promise) => JsFuture::from(promise).await.map_err(|e| err(name, e)),
            Err(value) => Ok(value),
        }
    }

    /// Lazy-load a speech bundle (dynamic import of the hashed asset URL),
    /// then point its ONNX runtime at the staged wasm pair.
    async fn ensure(
        global: &str,
        bundle: Asset,
        mjs: Asset,
        wasm: Asset,
    ) -> Result<JsValue, String> {
        let window: JsValue = web_sys::window()
            .ok_or_else(|| "no window".to_string())?
            .into();
        let existing = get(&window, global)?;
        if !existing.is_undefined() {
            return Ok(existing);
        }
        let promise: Promise = js_sys::eval(&format!("import('{bundle}')"))
            .map_err(|e| err("import", e))?
            .dyn_into()
            .map_err(|_| "import() did not return a promise".to_string())?;
        JsFuture::from(promise)
            .await
            .map_err(|e| err("bundle load", e))?;
        let engine = get(&window, global)?;
        if engine.is_undefined() {
            return Err(format!("{global} missing after bundle load"));
        }
        call(
            &engine,
            "init",
            &[
                JsValue::from_str(&mjs.to_string()),
                JsValue::from_str(&wasm.to_string()),
            ],
        )
        .await?;
        Ok(engine)
    }

    fn model_arg(model: &str) -> JsValue {
        if model.trim().is_empty() {
            JsValue::NULL
        } else {
            JsValue::from_str(model.trim())
        }
    }

    async fn stt() -> Result<JsValue, String> {
        ensure("askkStt", STT_JS, STT_ORT_MJS, STT_ORT_WASM).await
    }

    async fn tts() -> Result<JsValue, String> {
        ensure("askkTts", TTS_JS, TTS_ORT_MJS, TTS_ORT_WASM).await
    }

    /// Start capturing the microphone (browser permission prompt on first use).
    pub async fn record_start() -> Result<(), String> {
        let engine = stt().await?;
        call(&engine, "recordStart", &[]).await.map(|_| ())
    }

    /// Stop capture and transcribe with the given HF model id ("" = default).
    pub async fn record_stop_transcribe(model: &str) -> Result<String, String> {
        let engine = stt().await?;
        let audio = call(&engine, "recordStop", &[]).await?;
        call(&engine, "load", &[model_arg(model), JsValue::NULL]).await?;
        let text = call(&engine, "transcribe", &[audio]).await?;
        Ok(text.as_string().unwrap_or_default().trim().to_string())
    }

    /// Speak text through the given HF model id ("" = default kokoro).
    pub async fn speak(text: &str, model: &str, voice: &str) -> Result<(), String> {
        let engine = tts().await?;
        call(&engine, "load", &[model_arg(model), JsValue::NULL]).await?;
        call(
            &engine,
            "speak",
            &[JsValue::from_str(text), model_arg(voice)],
        )
        .await
        .map(|_| ())
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod imp {
    pub async fn record_start() -> Result<(), String> {
        Err("speech is wasm-only".into())
    }

    pub async fn record_stop_transcribe(_model: &str) -> Result<String, String> {
        Err("speech is wasm-only".into())
    }

    pub async fn speak(_text: &str, _model: &str, _voice: &str) -> Result<(), String> {
        Err("speech is wasm-only".into())
    }
}

pub use imp::*;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn speech_config_round_trips_and_defaults_empty() {
        let config = SpeechConfig {
            stt_model: "onnx-community/whisper-small".into(),
            tts_model: "onnx-community/Kokoro-82M-v1.0-ONNX".into(),
            voice: "af_heart".into(),
        };
        assert_eq!(SpeechConfig::from_json(&config.to_json()), config);
        assert_eq!(SpeechConfig::from_json(&json!({})), SpeechConfig::default());
    }
}
