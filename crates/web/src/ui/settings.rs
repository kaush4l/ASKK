//! Settings stage (kiln `settingsStage`): theme picker chips, saved provider
//! profiles (select / add / delete), endpoint preset buttons, the profile
//! form, and the primary Save. Theme applies immediately through the
//! parent's handler; profile commands hand the whole profile back to the
//! facade. The parent keys this component on the active profile name, so
//! selecting a profile remounts the form with its values.

use dioxus::prelude::*;

use crate::host::boot::{NamedProfile, ProfileSet, ProviderProfileForm};
use crate::host::speech::SpeechConfig;

/// Mirrors the `[data-theme]` blocks in `main.css` — adding a theme = one
/// CSS block + one row here.
pub const THEMES: &[(&str, &str)] = &[
    ("paper", "Warm Paper"),
    ("calm", "Calm"),
    ("brutal", "Brutalist"),
    ("phosphor", "CRT Phosphor"),
    ("amber", "Amber CRT"),
    ("blueprint", "Blueprint"),
    ("aurora", "Aurora Glass"),
];

/// Endpoint presets (kiln's list, trimmed to transports this shell has):
/// one click fills the base URL; key/model stay yours.
const PRESETS: &[(&str, &str)] = &[
    ("omlx (local)", "http://127.0.0.1:8873/v1"),
    ("LM Studio (local)", "http://localhost:1234/v1"),
    ("Ollama (local)", "http://localhost:11434/v1"),
    ("OpenRouter", "https://openrouter.ai/api/v1"),
    ("Anthropic", "https://api.anthropic.com/v1"),
];

#[component]
#[allow(clippy::too_many_arguments)] // ponytail: the stage's full data surface
pub fn SettingsStage(
    profiles: ProfileSet,
    theme: String,
    speech: SpeechConfig,
    searxng: String,
    mcp_servers: String,
    on_save: EventHandler<NamedProfile>,
    on_select: EventHandler<String>,
    on_delete: EventHandler<String>,
    on_theme: EventHandler<String>,
    on_speech: EventHandler<SpeechConfig>,
    on_searxng: EventHandler<String>,
    on_mcp_servers: EventHandler<String>,
) -> Element {
    let active = profiles.active_form();
    let mut name = use_signal(|| {
        if profiles.active.is_empty() {
            "default".to_string()
        } else {
            profiles.active.clone()
        }
    });
    let mut base_url = use_signal(|| active.base_url.clone());
    let mut model = use_signal(|| active.model.clone());
    let mut api_key = use_signal(|| active.api_key.clone());
    let mut temperature = use_signal(|| {
        active
            .temperature
            .map(|t| t.to_string())
            .unwrap_or_default()
    });
    let mut max_tokens =
        use_signal(|| active.max_tokens.map(|t| t.to_string()).unwrap_or_default());
    let mut saved = use_signal(|| false);
    let deletable = profiles.get(&name()).is_some();

    rsx! {
        div { class: "settings-wrap",
            div { class: "settings-title", "Theme" }
            div { class: "presets",
                for (id, label) in THEMES {
                    button {
                        key: "{id}",
                        class: if theme == *id { "preset on" } else { "preset" },
                        onclick: move |_| on_theme.call(id.to_string()),
                        "{label}"
                    }
                }
            }
            div { class: "settings-title", "Provider profiles" }
            div { class: "presets",
                for p in profiles.profiles.iter() {
                    button {
                        key: "{p.name}",
                        class: if profiles.active == p.name { "preset on" } else { "preset" },
                        onclick: {
                            let name = p.name.clone();
                            move |_| on_select.call(name.clone())
                        },
                        "{p.name}"
                    }
                }
                button {
                    class: "preset",
                    onclick: move |_| {
                        name.set(String::new());
                        base_url.set(String::new());
                        model.set(String::new());
                        api_key.set(String::new());
                        temperature.set(String::new());
                        saved.set(false);
                    },
                    "＋ new profile"
                }
            }
            div { class: "settings-title", "Model endpoint" }
            div { class: "presets",
                for (label, url) in PRESETS {
                    button {
                        key: "{label}",
                        class: "preset",
                        onclick: move |_| {
                            base_url.set(url.to_string());
                            saved.set(false);
                        },
                        "{label}"
                    }
                }
            }
            label { class: "settings-row",
                span { class: "settings-label", "Profile name" }
                input {
                    class: "field",
                    placeholder: "local-gemma",
                    value: "{name}",
                    oninput: move |e| { name.set(e.value()); saved.set(false); },
                }
            }
            label { class: "settings-row",
                span { class: "settings-label", "Base URL" }
                input {
                    class: "field",
                    placeholder: "http://localhost:1234/v1",
                    value: "{base_url}",
                    oninput: move |e| { base_url.set(e.value()); saved.set(false); },
                }
            }
            label { class: "settings-row",
                span { class: "settings-label", "Model" }
                input {
                    class: "field",
                    placeholder: "llama3.2",
                    value: "{model}",
                    oninput: move |e| { model.set(e.value()); saved.set(false); },
                }
            }
            label { class: "settings-row",
                span { class: "settings-label", "API key" }
                input {
                    class: "field",
                    r#type: "password",
                    placeholder: "local",
                    value: "{api_key}",
                    oninput: move |e| { api_key.set(e.value()); saved.set(false); },
                }
            }
            label { class: "settings-row",
                span { class: "settings-label", "Temperature (blank = provider default)" }
                input {
                    class: "field",
                    placeholder: "0.7",
                    value: "{temperature}",
                    oninput: move |e| { temperature.set(e.value()); saved.set(false); },
                }
            }
            label { class: "settings-row",
                span { class: "settings-label", "Max tokens (blank = 2048)" }
                input {
                    class: "field",
                    placeholder: "2048",
                    value: "{max_tokens}",
                    oninput: move |e| { max_tokens.set(e.value()); saved.set(false); },
                }
            }
            div { class: "presets",
                button {
                    class: "save",
                    onclick: move |_| {
                        saved.set(true);
                        on_save.call(NamedProfile {
                            name: name().trim().to_string(),
                            form: ProviderProfileForm {
                                base_url: base_url().trim().to_string(),
                                model: model().trim().to_string(),
                                api_key: api_key().trim().to_string(),
                                temperature: temperature().trim().parse::<f32>().ok(),
                                max_tokens: max_tokens().trim().parse::<u32>().ok(),
                            },
                        });
                    },
                    if saved() { "Saved ✓" } else { "Save profile" }
                }
                if deletable {
                    button {
                        class: "preset",
                        onclick: move |_| on_delete.call(name().trim().to_string()),
                        "Delete"
                    }
                }
            }
            p { class: "hint",
                "Bring your own key: profiles stay in this browser's private storage (OPFS) and each key is sent only to its base URL. The highlighted profile is the one runs use. Remote servers must allow this origin via CORS."
            }
            p { class: "hint",
                "No server at all? Set base URL to `local` and model to a HuggingFace ONNX id (e.g. onnx-community/gemma-4-E2B-it-ONNX) to run fully in-browser — WebGPU when available, wasm fallback, no key. First use downloads the weights into the browser cache."
            }
            div { class: "settings-title", "Web search" }
            label { class: "settings-row",
                span { class: "settings-label", "SearXNG instance (blank = DuckDuckGo/Wikipedia only)" }
                input {
                    class: "field",
                    placeholder: "https://search.rhscz.eu",
                    value: "{searxng}",
                    oninput: move |e: Event<FormData>| on_searxng.call(e.value()),
                }
            }
            p { class: "hint",
                "SearXNG is the primary engine when set; failures fall back to DuckDuckGo → Wikipedia. Public instances rarely allow JSON+CORS and rate-limit hard — self-host for reliability. The instance sees your queries."
            }
            div { class: "settings-title", "MCP servers" }
            label { class: "settings-row",
                span { class: "settings-label", "Streamable-HTTP MCP server URLs (one per line, blank = none)" }
                textarea {
                    class: "field",
                    rows: "3",
                    placeholder: "https://mcp.example.com/mcp",
                    value: "{mcp_servers}",
                    oninput: move |e: Event<FormData>| on_mcp_servers.call(e.value()),
                }
            }
            p { class: "hint",
                "Each server's tools join the registry as mcp_<server>_<tool> after a reload. Servers must speak Streamable HTTP and allow this origin via CORS."
            }
            div { class: "settings-title", "Speech (HF model ids, blank = default)" }
            label { class: "settings-row",
                span { class: "settings-label", "STT model (default onnx-community/whisper-tiny.en)" }
                input {
                    class: "field",
                    placeholder: "onnx-community/whisper-small",
                    value: "{speech.stt_model}",
                    oninput: {
                        let speech = speech.clone();
                        move |e: Event<FormData>| on_speech.call(SpeechConfig { stt_model: e.value(), ..speech.clone() })
                    },
                }
            }
            label { class: "settings-row",
                span { class: "settings-label", "TTS model (default onnx-community/Kokoro-82M-v1.0-ONNX)" }
                input {
                    class: "field",
                    placeholder: "onnx-community/Kokoro-82M-v1.0-ONNX",
                    value: "{speech.tts_model}",
                    oninput: {
                        let speech = speech.clone();
                        move |e: Event<FormData>| on_speech.call(SpeechConfig { tts_model: e.value(), ..speech.clone() })
                    },
                }
            }
            label { class: "settings-row",
                span { class: "settings-label", "TTS voice (default af_heart)" }
                input {
                    class: "field",
                    placeholder: "af_heart",
                    value: "{speech.voice}",
                    oninput: {
                        let speech = speech.clone();
                        move |e: Event<FormData>| on_speech.call(SpeechConfig { voice: e.value(), ..speech.clone() })
                    },
                }
            }
            p { class: "hint",
                "Models download from the Hugging Face hub on first use and cache in this browser. Speech runs fully locally (ONNX wasm) — nothing leaves the machine."
            }
        }
    }
}
