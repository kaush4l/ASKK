//! Speech lab panel: STT (record → transcribe) and TTS (text → speak) testers
//! with curated tiny model + voice pickers over a custom-id escape hatch.
//! Backed by `askk_browser::speech::{record_start, record_stop_transcribe,
//! speak}` — all async, wasm-only at runtime (host stubs return Err). Each card
//! owns its own signals; nothing here touches the agent engine (ADR-041).

use askk_browser::speech;
use dioxus::prelude::*;

/// Curated Whisper picks; "" = the bundle default (whisper-tiny.en).
const STT_MODELS: &[(&str, &str)] = &[
    ("", "whisper-tiny.en (default)"),
    ("onnx-community/whisper-base", "whisper-base"),
    ("onnx-community/moonshine-tiny-ONNX", "Moonshine tiny"),
];

/// Curated Kokoro picks; "" = the bundle default (Kokoro-82M).
const TTS_MODELS: &[(&str, &str)] = &[("", "Kokoro-82M (default)")];

/// Kokoro voice ids offered as chips; the seam default is `af_heart`.
const VOICES: &[&str] = &["af_heart", "af_bella", "am_michael", "bf_emma"];

#[component]
pub fn SpeechPanel() -> Element {
    rsx! {
        SttCard {}
        TtsCard {}
    }
}

/// STT: model picker + custom id, one record/stop-transcribe toggle button, and
/// the transcript. A `busy` signal swallows double-clicks across the async gap.
#[component]
fn SttCard() -> Element {
    let mut model = use_signal(String::new);
    let mut recording = use_signal(|| false);
    let mut busy = use_signal(|| false);
    let mut transcript = use_signal(String::new);
    let mut err = use_signal(String::new);

    let toggle = move |_| {
        if busy() {
            return;
        }
        err.set(String::new());
        busy.set(true);
        if recording() {
            let m = model();
            spawn(async move {
                match speech::record_stop_transcribe(&m).await {
                    Ok(text) => transcript.set(text),
                    Err(e) => err.set(e),
                }
                recording.set(false);
                busy.set(false);
            });
        } else {
            spawn(async move {
                match speech::record_start().await {
                    Ok(()) => recording.set(true),
                    Err(e) => err.set(e),
                }
                busy.set(false);
            });
        }
    };

    rsx! {
        div { class: "feat-card",
            div { class: "feat-card-title", "Speech-to-text · Whisper" }
            div { class: "feat-row",
                span { class: "feat-label", "model" }
                for (id, label) in STT_MODELS.iter().copied() {
                    button {
                        class: if model() == id { "preset on" } else { "preset" },
                        onclick: move |_| model.set(id.to_string()),
                        "{label}"
                    }
                }
            }
            input {
                class: "field",
                placeholder: "custom HF model id (e.g. onnx-community/whisper-small)",
                value: "{model}",
                oninput: move |e| model.set(e.value()),
            }
            div { class: "feat-row",
                button {
                    class: if recording() { "preset on" } else { "preset" },
                    disabled: busy(),
                    onclick: toggle,
                    if recording() { "■ Stop & transcribe" } else { "● Record" }
                }
                if recording() {
                    span { class: "feat-detail", "● recording…" }
                }
            }
            if !transcript().is_empty() {
                div { class: "feat-out", "{transcript}" }
            }
            if !err().is_empty() {
                div { class: "feat-err", "{err}" }
            }
            div { class: "feat-detail",
                "Whisper defaults to fp32 encoder + q4 decoder (small, runs on wasm-cpu); models stream from the HF hub on first use."
            }
        }
    }
}

/// TTS: text box + model/voice pickers + a Speak button. `speaking` guards the
/// async speak call and drives the button label.
#[component]
fn TtsCard() -> Element {
    let mut text = use_signal(String::new);
    let mut model = use_signal(String::new);
    let mut voice = use_signal(|| "af_heart".to_string());
    let mut speaking = use_signal(|| false);
    let mut err = use_signal(String::new);

    let speak = move |_| {
        if speaking() || text().trim().is_empty() {
            return;
        }
        err.set(String::new());
        speaking.set(true);
        let (t, m, v) = (text(), model(), voice());
        spawn(async move {
            if let Err(e) = speech::speak(&t, &m, &v).await {
                err.set(e);
            }
            speaking.set(false);
        });
    };

    rsx! {
        div { class: "feat-card",
            div { class: "feat-card-title", "Text-to-speech · Kokoro" }
            textarea {
                class: "field",
                rows: "2",
                placeholder: "text to speak…",
                value: "{text}",
                oninput: move |e| text.set(e.value()),
            }
            div { class: "feat-row",
                span { class: "feat-label", "model" }
                for (id, label) in TTS_MODELS.iter().copied() {
                    button {
                        class: if model() == id { "preset on" } else { "preset" },
                        onclick: move |_| model.set(id.to_string()),
                        "{label}"
                    }
                }
            }
            input {
                class: "field",
                placeholder: "custom HF model id",
                value: "{model}",
                oninput: move |e| model.set(e.value()),
            }
            div { class: "feat-row",
                span { class: "feat-label", "voice" }
                for v in VOICES.iter().copied() {
                    button {
                        class: if voice() == v { "preset on" } else { "preset" },
                        onclick: move |_| voice.set(v.to_string()),
                        "{v}"
                    }
                }
            }
            div { class: "feat-row",
                button {
                    class: "preset",
                    disabled: speaking() || text().trim().is_empty(),
                    onclick: speak,
                    if speaking() { "Speaking…" } else { "Speak" }
                }
            }
            if !err().is_empty() {
                div { class: "feat-err", "{err}" }
            }
        }
    }
}
