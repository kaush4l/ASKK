//! LLM lab: run a tiny in-browser LLM (WebGPU q4f16, wasm-cpu q4 fallback) via
//! the `askk_browser::local_llm` seam and optionally hand the chosen model id up
//! to `app.rs` as the active provider. A curated tiny-ONNX picker plus a custom
//! HF-id field, a prompt box, a max-tokens control, and streamed output. The
//! engine is untouched — this is a probe bench (ADR-041).

use dioxus::prelude::*;

use askk_browser::local_llm;

/// Curated tiny instruct models known to load in-browser: (HF id, short label).
const MODELS: &[(&str, &str)] = &[
    ("onnx-community/Qwen2.5-0.5B-Instruct", "Qwen2.5 0.5B"),
    ("HuggingFaceTB/SmolLM2-360M-Instruct", "SmolLM2 360M"),
    ("onnx-community/Llama-3.2-1B-Instruct", "Llama 3.2 1B"),
    ("onnx-community/gemma-4-E2B-it-ONNX", "Gemma-4 E2B"),
];

#[component]
pub fn LlmPanel(on_use_default: EventHandler<String>) -> Element {
    let mut model = use_signal(|| MODELS[0].0.to_string());
    let mut prompt = use_signal(|| "Write a one-sentence hello from the browser.".to_string());
    let mut max_str = use_signal(|| "256".to_string());
    let mut output = use_signal(String::new);
    let mut busy = use_signal(|| false);
    let mut err = use_signal(|| None::<String>);

    // A Signal is Copy, so it moves into both the spawn body and the on_delta
    // closure; the run streams straight into `output` for a live view.
    let run = move |_| {
        let m = model();
        if m.trim().is_empty() || busy() {
            return;
        }
        let p = prompt();
        let mx = max_str().trim().parse::<u32>().unwrap_or(256);
        spawn(async move {
            output.set(String::new());
            err.set(None);
            busy.set(true);
            let r = local_llm::generate_once(&m, &p, mx, move |c| {
                output.with_mut(|s| s.push_str(c));
            })
            .await;
            if let Err(e) = r {
                err.set(Some(e));
            }
            busy.set(false);
        });
    };

    let empty = move || model().trim().is_empty();

    rsx! {
        div { class: "feat-card",
            div { class: "feat-card-title", "In-browser LLM" }
            div { class: "feat-label", "model" }
            div { class: "feat-row",
                for &(id, label) in MODELS.iter() {
                    button {
                        class: if model() == id { "preset on" } else { "preset" },
                        onclick: move |_| model.set(id.to_string()),
                        "{label}"
                    }
                }
            }
            input {
                class: "field",
                value: "{model}",
                placeholder: "or a custom HF ONNX id, e.g. onnx-community/…",
                oninput: move |e| model.set(e.value()),
            }
            div { class: "feat-detail",
                "First run streams weights from the HF hub into the browser cache (WebGPU q4f16, wasm-cpu q4 fallback) — the first load can be a large download."
            }
        }

        div { class: "feat-card",
            div { class: "feat-card-title", "Prompt" }
            textarea {
                class: "field",
                rows: "3",
                value: "{prompt}",
                oninput: move |e| prompt.set(e.value()),
            }
            div { class: "feat-row",
                span { class: "feat-label", "max tokens" }
                input {
                    class: "feat-num",
                    r#type: "number",
                    min: "1",
                    value: "{max_str}",
                    oninput: move |e| max_str.set(e.value()),
                }
                button {
                    class: "save",
                    disabled: busy() || empty(),
                    onclick: run,
                    if busy() { "Running…" } else { "Run" }
                }
                button {
                    class: "preset",
                    disabled: empty(),
                    onclick: move |_| on_use_default.call(model()),
                    "Add as provider"
                }
            }
            if let Some(e) = err() {
                div { class: "feat-err", "{e}" }
            }
            if !output().is_empty() {
                div { class: "feat-out", "{output}" }
            }
            div { class: "feat-detail",
                "active model: {model} — \"Add as provider\" saves this as an additional \"in-browser\" provider profile alongside your external ones; it does not switch the active provider. Activate it in Settings when you want to use it."
            }
        }
    }
}
