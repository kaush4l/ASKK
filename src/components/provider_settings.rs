use super::save_snapshot;
use super::shared::set_status;
use crate::inference::{list_models, test_chat};
use crate::state::{AppSnapshot, ProviderAuthMode};
use crate::storage::{IndexedDbStorage, StorageAdapter};
use dioxus::prelude::*;
use wasm_bindgen_futures::spawn_local;

/// Provider settings, organized into three cards:
///   1. Connection      — where to call (base URL / model / auth / key)
///   2. Generation preset — how to sample (temperature / max tokens / top-p / context)
///   3. Run limits        — how hard to work a goal (max steps / max parallel / retries)
///
/// Connection and Generation preset are independent saved lists; a run uses the
/// active connection × the active preset. Editing any field updates the active
/// profile in place (no separate "save" step) — only New / Duplicate / Delete remain.
#[component]
pub fn ProviderSettings(
    mut snapshot: Signal<AppSnapshot>,
    mut provider_models: Signal<Vec<String>>,
) -> Element {
    let current = snapshot.read().clone();
    let current_models = provider_models.read().clone();

    let active_connection_id = current
        .active_provider_profile_id
        .clone()
        .unwrap_or_default();
    let active_connection_name = current
        .provider_profiles
        .iter()
        .find(|profile| profile.id == active_connection_id)
        .map(|profile| profile.name.clone())
        .unwrap_or_default();
    let active_preset_id = current.active_model_profile_id.clone().unwrap_or_default();
    let active_preset_name = current
        .model_profiles
        .iter()
        .find(|profile| profile.id == active_preset_id)
        .map(|profile| profile.name.clone())
        .unwrap_or_default();

    rsx! {
        section { class: "panel page-panel provider-panel",
            div { class: "panel-heading",
                h2 { "Provider" }
                div { class: "button-row",
                    button {
                        onclick: move |_| {
                            let save_data = snapshot.read().clone();
                            let mut snapshot = snapshot;
                            spawn_local(async move {
                                let status = save_snapshot(save_data).await;
                                set_status(&mut snapshot, status);
                            });
                        },
                        "Save"
                    }
                    button {
                        onclick: move |_| {
                            let mut snapshot = snapshot;
                            spawn_local(async move {
                                match IndexedDbStorage::open().await {
                                    Ok(storage) => match storage.load_snapshot().await {
                                        Ok(Some(saved)) => snapshot.set(saved),
                                        Ok(None) => set_status(&mut snapshot, "No saved workspace found.".to_string()),
                                        Err(err) => set_status(&mut snapshot, format!("Load failed: {err}")),
                                    },
                                    Err(err) => set_status(&mut snapshot, err),
                                }
                            });
                        },
                        "Load"
                    }
                }
            }

            // ---- Card 1: Connection ------------------------------------------------
            div { class: "settings-card",
                div { class: "card-heading",
                    h3 { "Connection" }
                    p { class: "muted", "Where to send requests. Pick a saved connection or add one." }
                }
                div { class: "profile-row",
                    select {
                        class: "profile-select",
                        value: "{active_connection_id}",
                        onchange: move |event| {
                            let status = snapshot.write().select_connection(&event.value());
                            provider_models.set(Vec::new());
                            match status {
                                Ok(status) => set_status(&mut snapshot, status),
                                Err(err) => set_status(&mut snapshot, err),
                            }
                        },
                        for profile in current.provider_profiles.iter() {
                            option {
                                value: "{profile.id}",
                                selected: profile.id == active_connection_id,
                                "{profile.name} · {profile.config.model}"
                            }
                        }
                    }
                    input {
                        class: "profile-name",
                        value: "{active_connection_name}",
                        placeholder: "Name this connection",
                        oninput: move |event| {
                            snapshot.write().rename_active_connection(&event.value());
                        }
                    }
                    div { class: "button-row",
                        button {
                            class: "ghost-button",
                            onclick: move |_| {
                                let status = snapshot.write().add_connection();
                                provider_models.set(Vec::new());
                                set_status(&mut snapshot, status);
                            },
                            "New"
                        }
                        button {
                            class: "ghost-button",
                            onclick: move |_| {
                                let status = snapshot.write().duplicate_active_connection();
                                set_status(&mut snapshot, status);
                            },
                            "Duplicate"
                        }
                        button {
                            class: "ghost-button",
                            onclick: move |_| {
                                let Some(id) = snapshot.read().active_provider_profile_id.clone() else {
                                    set_status(&mut snapshot, "No active connection.".to_string());
                                    return;
                                };
                                let status = snapshot.write().delete_provider_profile(&id);
                                provider_models.set(Vec::new());
                                set_status(&mut snapshot, status);
                            },
                            "Delete"
                        }
                    }
                }

                div { class: "preset-grid",
                    button {
                        class: "ghost-button",
                        onclick: move |_| {
                            let status = apply_provider_preset(&mut snapshot, ProviderPreset::OpenAi);
                            snapshot.write().sync_active_connection();
                            provider_models.set(Vec::new());
                            set_status(&mut snapshot, status);
                        },
                        "OpenAI"
                    }
                    button {
                        class: "ghost-button",
                        onclick: move |_| {
                            let status = apply_provider_preset(&mut snapshot, ProviderPreset::Ollama);
                            snapshot.write().sync_active_connection();
                            provider_models.set(Vec::new());
                            set_status(&mut snapshot, status);
                        },
                        "Ollama"
                    }
                    button {
                        class: "ghost-button",
                        onclick: move |_| {
                            let status = apply_provider_preset(&mut snapshot, ProviderPreset::LmStudio);
                            snapshot.write().sync_active_connection();
                            provider_models.set(Vec::new());
                            set_status(&mut snapshot, status);
                        },
                        "LM Studio"
                    }
                    button {
                        class: "ghost-button",
                        onclick: move |_| {
                            let status = apply_provider_preset(&mut snapshot, ProviderPreset::LocalBridge);
                            snapshot.write().sync_active_connection();
                            provider_models.set(Vec::new());
                            set_status(&mut snapshot, status);
                        },
                        "Local Bridge"
                    }
                }

                label {
                    "Base URL"
                    input {
                        value: "{current.provider.base_url}",
                        oninput: move |event| {
                            let mut data = snapshot.write();
                            data.provider.base_url = event.value();
                            data.sync_active_connection();
                        }
                    }
                }
                label {
                    "Model"
                    input {
                        value: "{current.provider.model}",
                        placeholder: "e.g. gpt-4.1-mini",
                        oninput: move |event| {
                            let mut data = snapshot.write();
                            data.provider.model = event.value();
                            data.sync_active_connection();
                        }
                    }
                }
                div { class: "button-row",
                    button {
                        onclick: move |_| {
                            let config = snapshot.read().provider.clone();
                            let mut snapshot = snapshot;
                            let mut provider_models = provider_models;
                            spawn_local(async move {
                                set_status(&mut snapshot, "Listing provider models...".to_string());
                                match list_models(&config).await {
                                    Ok(models) if models.is_empty() => {
                                        provider_models.set(Vec::new());
                                        set_status(&mut snapshot, "Provider returned no models.".to_string());
                                    }
                                    Ok(models) => {
                                        let count = models.len();
                                        provider_models.set(models);
                                        set_status(&mut snapshot, format!("Listed {count} model(s). Click one to use it."));
                                    }
                                    Err(err) => {
                                        provider_models.set(Vec::new());
                                        set_status(&mut snapshot, err);
                                    }
                                }
                            });
                        },
                        "List Models"
                    }
                    button {
                        onclick: move |_| {
                            let config = snapshot.read().provider.clone();
                            let mut snapshot = snapshot;
                            spawn_local(async move {
                                set_status(&mut snapshot, "Testing chat completion...".to_string());
                                match test_chat(&config).await {
                                    Ok(status) => set_status(&mut snapshot, status),
                                    Err(err) => set_status(&mut snapshot, err),
                                }
                            });
                        },
                        "Test Chat"
                    }
                }
                if !current_models.is_empty() {
                    div { class: "model-picker",
                        for model in current_models.iter() {
                            button {
                                class: "ghost-button model-chip",
                                key: "{model}",
                                onclick: {
                                    let model = model.clone();
                                    move |_| {
                                        let mut data = snapshot.write();
                                        data.provider.model = model.clone();
                                        data.sync_active_connection();
                                        drop(data);
                                        set_status(&mut snapshot, format!("Selected model: {model}"));
                                    }
                                },
                                "{model}"
                            }
                        }
                    }
                }
                div { class: "inline-controls",
                    label {
                        "Auth"
                        select {
                            value: "{current.provider.auth_mode.as_form_value()}",
                            onchange: move |event| {
                                let mut data = snapshot.write();
                                data.provider.auth_mode = ProviderAuthMode::from_form_value(&event.value());
                                data.sync_active_connection();
                            },
                            option { value: "bearer", "Bearer token" }
                            option { value: "none", "No auth" }
                        }
                    }
                    label {
                        "API key"
                        input {
                            r#type: "password",
                            disabled: !current.provider.auth_mode.requires_key(),
                            value: "{current.provider.api_key}",
                            placeholder: if current.provider.auth_mode.requires_key() { "sk-… or provider token" } else { "not sent when Auth is No auth" },
                            oninput: move |event| {
                                let mut data = snapshot.write();
                                data.provider.api_key = event.value();
                                data.sync_active_connection();
                            }
                        }
                    }
                    label { class: "checkbox-line",
                        input {
                            r#type: "checkbox",
                            checked: current.provider.persist_api_key,
                            onchange: move |event| {
                                let mut data = snapshot.write();
                                data.provider.persist_api_key = event.checked();
                                data.sync_active_connection();
                            }
                        }
                        "Remember key in this browser"
                    }
                }
            }

            // ---- Card 2: Generation preset ----------------------------------------
            div { class: "settings-card",
                div { class: "card-heading",
                    h3 { "Generation preset" }
                    p { class: "muted", "How the model samples. Reusable across connections." }
                }
                div { class: "profile-row",
                    select {
                        class: "profile-select",
                        value: "{active_preset_id}",
                        onchange: move |event| {
                            let status = snapshot.write().apply_model_profile(&event.value());
                            match status {
                                Ok(status) => set_status(&mut snapshot, status),
                                Err(err) => set_status(&mut snapshot, err),
                            }
                        },
                        for profile in current.model_profiles.iter() {
                            option {
                                value: "{profile.id}",
                                selected: profile.id == active_preset_id,
                                "{profile.name} · temp {profile.temperature}"
                            }
                        }
                    }
                    input {
                        class: "profile-name",
                        value: "{active_preset_name}",
                        placeholder: "Name this preset",
                        oninput: move |event| {
                            snapshot.write().rename_active_model_profile(&event.value());
                        }
                    }
                    div { class: "button-row",
                        button {
                            class: "ghost-button",
                            onclick: move |_| {
                                let status = snapshot.write().add_model_profile();
                                set_status(&mut snapshot, status);
                            },
                            "New"
                        }
                        button {
                            class: "ghost-button",
                            onclick: move |_| {
                                let status = snapshot.write().duplicate_active_model_profile();
                                set_status(&mut snapshot, status);
                            },
                            "Duplicate"
                        }
                        button {
                            class: "ghost-button",
                            onclick: move |_| {
                                let Some(id) = snapshot.read().active_model_profile_id.clone() else {
                                    set_status(&mut snapshot, "No active generation preset.".to_string());
                                    return;
                                };
                                let status = snapshot.write().delete_model_profile(&id);
                                set_status(&mut snapshot, status);
                            },
                            "Delete"
                        }
                    }
                }
                div { class: "inline-controls",
                    label {
                        "Temperature"
                        input {
                            class: "number-input",
                            r#type: "number",
                            step: "0.1",
                            min: "0",
                            max: "2",
                            value: "{current.provider.temperature}",
                            oninput: move |event| {
                                if let Ok(value) = event.value().parse::<f64>() {
                                    let mut data = snapshot.write();
                                    data.provider.temperature = value;
                                    data.sync_active_model_profile();
                                }
                            }
                        }
                    }
                    label {
                        "Max tokens"
                        input {
                            class: "number-input",
                            r#type: "number",
                            min: "1",
                            value: "{current.provider.max_tokens}",
                            oninput: move |event| {
                                if let Ok(value) = event.value().parse::<u32>() {
                                    let mut data = snapshot.write();
                                    data.provider.max_tokens = value.max(1);
                                    data.sync_active_model_profile();
                                }
                            }
                        }
                    }
                    label {
                        "Top-p"
                        input {
                            class: "number-input",
                            r#type: "number",
                            step: "0.05",
                            min: "0",
                            max: "1",
                            placeholder: "off",
                            value: current.provider.top_p.map(|value| value.to_string()).unwrap_or_default(),
                            oninput: move |event| {
                                let raw = event.value();
                                let parsed = if raw.trim().is_empty() { None } else { raw.parse::<f64>().ok() };
                                let mut data = snapshot.write();
                                data.provider.top_p = parsed;
                                data.sync_active_model_profile();
                            }
                        }
                    }
                    label {
                        "Context window"
                        input {
                            class: "number-input",
                            r#type: "number",
                            min: "1",
                            value: "{current.provider.context_window}",
                            oninput: move |event| {
                                if let Ok(value) = event.value().parse::<u32>() {
                                    let mut data = snapshot.write();
                                    data.provider.context_window = value.max(1);
                                    data.sync_active_model_profile();
                                }
                            }
                        }
                    }
                }
            }

            // ---- Card 3: Run limits -----------------------------------------------
            div { class: "settings-card",
                div { class: "card-heading",
                    h3 { "Run limits" }
                    p { class: "muted", "Apply to every run. Set Max parallel ≥ 2 to let decomposable goals fan out into parallel agents." }
                }
                div { class: "inline-controls",
                    label {
                        "Max steps"
                        input {
                            class: "number-input",
                            r#type: "number",
                            min: "1",
                            value: "{current.orchestrator.max_steps}",
                            oninput: move |event| {
                                if let Ok(value) = event.value().parse::<u32>() {
                                    snapshot.write().orchestrator.max_steps = value.max(1);
                                }
                            }
                        }
                    }
                    label {
                        "Max parallel agents"
                        input {
                            class: "number-input",
                            r#type: "number",
                            min: "1",
                            value: "{current.orchestrator.max_parallelism}",
                            oninput: move |event| {
                                if let Ok(value) = event.value().parse::<u32>() {
                                    snapshot.write().orchestrator.max_parallelism = value.max(1);
                                }
                            }
                        }
                    }
                    label {
                        "Verification retries"
                        input {
                            class: "number-input",
                            r#type: "number",
                            min: "0",
                            value: "{current.orchestrator.verification_retries}",
                            oninput: move |event| {
                                if let Ok(value) = event.value().parse::<u32>() {
                                    snapshot.write().orchestrator.verification_retries = value;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

#[derive(Clone, Copy)]
enum ProviderPreset {
    OpenAi,
    Ollama,
    LmStudio,
    LocalBridge,
}

fn apply_provider_preset(snapshot: &mut Signal<AppSnapshot>, preset: ProviderPreset) -> String {
    let mut data = snapshot.write();
    let provider = &mut data.provider;
    match preset {
        ProviderPreset::OpenAi => {
            provider.base_url = "https://api.openai.com/v1".to_string();
            provider.auth_mode = ProviderAuthMode::Bearer;
            if is_local_placeholder(&provider.model) {
                provider.model = "gpt-4.1-mini".to_string();
            }
            "OpenAI preset selected.".to_string()
        }
        ProviderPreset::Ollama => {
            provider.base_url = "http://localhost:11434/v1".to_string();
            provider.auth_mode = ProviderAuthMode::None;
            provider.api_key.clear();
            provider.persist_api_key = false;
            if should_replace_with_local_model(&provider.model) {
                provider.model = "llama3.2".to_string();
            }
            "Ollama local preset selected. Use List Models if this model id is not available."
                .to_string()
        }
        ProviderPreset::LmStudio => {
            provider.base_url = "http://localhost:1234/v1".to_string();
            provider.auth_mode = ProviderAuthMode::None;
            provider.api_key.clear();
            provider.persist_api_key = false;
            if should_replace_with_local_model(&provider.model) {
                provider.model = "local-model".to_string();
            }
            "LM Studio local preset selected. Use List Models to choose the loaded model id."
                .to_string()
        }
        ProviderPreset::LocalBridge => {
            provider.base_url = "http://127.0.0.1:8874/v1".to_string();
            provider.auth_mode = ProviderAuthMode::None;
            provider.api_key.clear();
            provider.persist_api_key = false;
            if should_replace_with_local_model(&provider.model) {
                provider.model = "local-model".to_string();
            }
            "Local Bridge preset selected. Run `node scripts/askk-local-bridge.mjs --target <provider-base-url>` on this browser machine.".to_string()
        }
    }
}

fn should_replace_with_local_model(model: &str) -> bool {
    let model = model.trim();
    model.is_empty() || model == "gpt-4.1-mini" || model == "local-model"
}

fn is_local_placeholder(model: &str) -> bool {
    matches!(model.trim(), "" | "llama3.2" | "local-model")
}
