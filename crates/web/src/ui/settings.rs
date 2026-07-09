//! Settings stage (kiln `settingsStage`): theme picker chips, endpoint
//! preset buttons, the one BYOK provider form, and the primary Save. Theme
//! applies immediately through the parent's handler; the form hands the
//! whole profile back to the facade on Save.

use dioxus::prelude::*;

use crate::host::boot::ProviderProfileForm;

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
    ("LM Studio (local)", "http://localhost:1234/v1"),
    ("Ollama (local)", "http://localhost:11434/v1"),
    ("OpenRouter", "https://openrouter.ai/api/v1"),
    ("Anthropic", "https://api.anthropic.com/v1"),
];

#[component]
pub fn SettingsStage(
    profile: ProviderProfileForm,
    theme: String,
    on_save: EventHandler<ProviderProfileForm>,
    on_theme: EventHandler<String>,
) -> Element {
    let mut base_url = use_signal(|| profile.base_url.clone());
    let mut model = use_signal(|| profile.model.clone());
    let mut api_key = use_signal(|| profile.api_key.clone());
    let mut temperature = use_signal(|| {
        profile
            .temperature
            .map(|t| t.to_string())
            .unwrap_or_default()
    });
    let mut saved = use_signal(|| false);

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
                span { class: "settings-label", "Base URL" }
                input {
                    class: "field",
                    placeholder: "http://localhost:1234/v1",
                    value: "{base_url}",
                    oninput: move |e| base_url.set(e.value()),
                }
            }
            label { class: "settings-row",
                span { class: "settings-label", "Model" }
                input {
                    class: "field",
                    placeholder: "llama3.2",
                    value: "{model}",
                    oninput: move |e| model.set(e.value()),
                }
            }
            label { class: "settings-row",
                span { class: "settings-label", "API key" }
                input {
                    class: "field",
                    r#type: "password",
                    placeholder: "local",
                    value: "{api_key}",
                    oninput: move |e| api_key.set(e.value()),
                }
            }
            label { class: "settings-row",
                span { class: "settings-label", "Temperature (blank = provider default)" }
                input {
                    class: "field",
                    placeholder: "0.7",
                    value: "{temperature}",
                    oninput: move |e| temperature.set(e.value()),
                }
            }
            button {
                class: "save",
                onclick: move |_| {
                    saved.set(true);
                    on_save.call(ProviderProfileForm {
                        base_url: base_url().trim().to_string(),
                        model: model().trim().to_string(),
                        api_key: api_key().trim().to_string(),
                        temperature: temperature().trim().parse::<f32>().ok(),
                    });
                },
                if saved() { "Saved ✓" } else { "Save" }
            }
            p { class: "hint",
                "Bring your own key: it stays in this browser's private storage (OPFS) and is sent only to the base URL above. Remote servers must allow this origin via CORS."
            }
        }
    }
}
