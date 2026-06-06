use super::save_snapshot;
use super::shared::set_status;
use crate::inference::{list_models, test_chat};
use crate::state::{AppSnapshot, ProviderAuthMode};
use crate::storage::{IndexedDbStorage, StorageAdapter};
use dioxus::prelude::*;
use wasm_bindgen_futures::spawn_local;

#[component]
pub fn ProviderSettings(
    mut snapshot: Signal<AppSnapshot>,
    mut provider_models: Signal<Vec<String>>,
) -> Element {
    let current = snapshot.read().clone();
    let current_models = provider_models.read().clone();
    let active_profile_id = current
        .active_provider_profile_id
        .clone()
        .unwrap_or_default();
    let active_profile_name = current
        .provider_profiles
        .iter()
        .find(|profile| profile.id == active_profile_id)
        .map(|profile| profile.name.clone())
        .unwrap_or_else(|| "Provider Profile".to_string());
    let routing_profile_id = current
        .orchestrator
        .routing_provider_profile_id
        .clone()
        .unwrap_or_default();
    let worker_profile_id = current
        .orchestrator
        .worker_provider_profile_id
        .clone()
        .unwrap_or_default();
    let active_model_profile_id = current.active_model_profile_id.clone().unwrap_or_default();
    let mut profile_name = use_signal(String::new);
    let mut model_profile_name = use_signal(String::new);

    rsx! {
        section { class: "panel page-panel provider-panel",
            div { class: "panel-heading",
                h2 { "Provider Settings" }
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

            div { class: "profile-controls",
                label {
                    "Saved Profiles"
                    select {
                        value: "{active_profile_id}",
                        onchange: move |event| {
                            let status = snapshot.write().select_provider_profile(&event.value());
                            provider_models.set(Vec::new());
                            match status {
                                Ok(status) => set_status(&mut snapshot, status),
                                Err(err) => set_status(&mut snapshot, err),
                            }
                        },
                        for profile in current.provider_profiles.iter() {
                            option {
                                value: "{profile.id}",
                                "{profile.name} - {profile.config.model}"
                            }
                        }
                    }
                }
                label {
                    "Profile Name"
                    input {
                        value: "{profile_name.read()}",
                        placeholder: "{active_profile_name}",
                        oninput: move |event| profile_name.set(event.value())
                    }
                }
            }

            div { class: "profile-actions",
                button {
                    class: "ghost-button",
                    onclick: move |_| {
                        let name = profile_name.read().clone();
                        let status = snapshot.write().save_current_provider_profile(&name);
                        profile_name.set(String::new());
                        set_status(&mut snapshot, status);
                    },
                    "Save New"
                }
                button {
                    class: "ghost-button",
                    onclick: move |_| {
                        let name = profile_name.read().clone();
                        let status = snapshot.write().update_active_provider_profile(&name);
                        profile_name.set(String::new());
                        set_status(&mut snapshot, status);
                    },
                    "Update"
                }
                button {
                    class: "ghost-button",
                    onclick: move |_| {
                        let Some(profile_id) = snapshot.read().active_provider_profile_id.clone() else {
                            set_status(&mut snapshot, "No active provider profile selected.".to_string());
                            return;
                        };
                        let status = snapshot.write().delete_provider_profile(&profile_id);
                        provider_models.set(Vec::new());
                        set_status(&mut snapshot, status);
                    },
                    "Delete"
                }
            }

            div { class: "orchestrator-controls",
                h3 { "Orchestrator Runtime" }
                div { class: "profile-controls",
                    label {
                        "Routing Profile"
                        select {
                            value: "{routing_profile_id}",
                            onchange: move |event| {
                                let value = event.value();
                                snapshot.write().orchestrator.routing_provider_profile_id =
                                    if value.is_empty() { None } else { Some(value) };
                            },
                            option { value: "", "Active provider" }
                            for profile in current.provider_profiles.iter() {
                                option {
                                    value: "{profile.id}",
                                    "{profile.name} - {profile.config.model}"
                                }
                            }
                        }
                    }
                    label {
                        "Worker Profile"
                        select {
                            value: "{worker_profile_id}",
                            onchange: move |event| {
                                let value = event.value();
                                snapshot.write().orchestrator.worker_provider_profile_id =
                                    if value.is_empty() { None } else { Some(value) };
                            },
                            option { value: "", "Active provider" }
                            for profile in current.provider_profiles.iter() {
                                option {
                                    value: "{profile.id}",
                                    "{profile.name} - {profile.config.model}"
                                }
                            }
                        }
                    }
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
                    label {
                        "No-progress turns"
                        input {
                            class: "number-input",
                            r#type: "number",
                            min: "1",
                            value: "{current.orchestrator.no_progress_turns}",
                            oninput: move |event| {
                                if let Ok(value) = event.value().parse::<u32>() {
                                    snapshot.write().orchestrator.no_progress_turns = value.max(1);
                                }
                            }
                        }
                    }
                    label {
                        "Max parallel"
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
                }
            }

            div { class: "preset-grid",
                button {
                    class: "ghost-button",
                    onclick: move |_| {
                        let status = apply_provider_preset(&mut snapshot, ProviderPreset::OpenAi);
                        provider_models.set(Vec::new());
                        set_status(&mut snapshot, status);
                    },
                    "OpenAI"
                }
                button {
                    class: "ghost-button",
                    onclick: move |_| {
                        let status = apply_provider_preset(&mut snapshot, ProviderPreset::Ollama);
                        provider_models.set(Vec::new());
                        set_status(&mut snapshot, status);
                    },
                    "Ollama"
                }
                button {
                    class: "ghost-button",
                    onclick: move |_| {
                        let status = apply_provider_preset(&mut snapshot, ProviderPreset::LmStudio);
                        provider_models.set(Vec::new());
                        set_status(&mut snapshot, status);
                    },
                    "LM Studio"
                }
                button {
                    class: "ghost-button",
                    onclick: move |_| {
                        let status = apply_provider_preset(&mut snapshot, ProviderPreset::LocalBridge);
                        provider_models.set(Vec::new());
                        set_status(&mut snapshot, status);
                    },
                    "Local Bridge"
                }
                button {
                    class: "ghost-button",
                    onclick: move |_| {
                        provider_models.set(Vec::new());
                        set_status(&mut snapshot, "Custom provider: edit Base URL, Auth, and Model directly.".to_string());
                    },
                    "Custom"
                }
            }
            label {
                "Base URL"
                input {
                    value: "{current.provider.base_url}",
                    oninput: move |event| {
                        snapshot.write().provider.base_url = event.value();
                    }
                }
            }
            label {
                "Model"
                input {
                    value: "{current.provider.model}",
                    oninput: move |event| {
                        snapshot.write().provider.model = event.value();
                    }
                }
            }
            label {
                "Auth"
                select {
                    value: "{current.provider.auth_mode.as_form_value()}",
                    onchange: move |event| {
                        snapshot.write().provider.auth_mode = ProviderAuthMode::from_form_value(&event.value());
                    },
                    option { value: "bearer", "Bearer token" }
                    option { value: "none", "No auth" }
                }
            }
            label {
                "API Key"
                input {
                    r#type: "password",
                    disabled: !current.provider.auth_mode.requires_key(),
                    value: "{current.provider.api_key}",
                    placeholder: if current.provider.auth_mode.requires_key() { "sk-... or provider token" } else { "not sent when Auth is No auth" },
                    oninput: move |event| {
                        snapshot.write().provider.api_key = event.value();
                    }
                }
            }
            div { class: "inline-controls",
                label { class: "checkbox-line",
                    input {
                        r#type: "checkbox",
                        checked: current.provider.persist_api_key,
                        onchange: move |event| {
                            snapshot.write().provider.persist_api_key = event.checked();
                        }
                    }
                    "Persist key in browser storage"
                }
                label {
                    "Temp"
                    input {
                        class: "number-input",
                        r#type: "number",
                        step: "0.1",
                        min: "0",
                        max: "2",
                        value: "{current.provider.temperature}",
                        oninput: move |event| {
                            if let Ok(value) = event.value().parse::<f64>() {
                                snapshot.write().provider.temperature = value;
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
                                snapshot.write().provider.max_tokens = value;
                            }
                        }
                    }
                }
                label {
                    "Top P"
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
                            let parsed = if raw.trim().is_empty() {
                                None
                            } else {
                                raw.parse::<f64>().ok()
                            };
                            snapshot.write().provider.top_p = parsed;
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
                                snapshot.write().provider.context_window = value.max(1);
                            }
                        }
                    }
                }
            }

            div { class: "model-profile-controls",
                h3 { "Model Profiles" }
                p { class: "muted", "Tune temperature, max tokens, Top P, and context window above, then save them as a reusable profile to pair with a model." }
                div { class: "profile-controls",
                    label {
                        "Active Profile"
                        select {
                            value: "{active_model_profile_id}",
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
                                    "{profile.name} - temp {profile.temperature}, {profile.context_window} ctx"
                                }
                            }
                        }
                    }
                    label {
                        "Profile Name"
                        input {
                            value: "{model_profile_name.read()}",
                            placeholder: "e.g. Long-context research",
                            oninput: move |event| model_profile_name.set(event.value())
                        }
                    }
                }
                div { class: "profile-actions",
                    button {
                        class: "ghost-button",
                        onclick: move |_| {
                            let name = model_profile_name.read().clone();
                            let status = snapshot.write().save_model_profile(&name);
                            model_profile_name.set(String::new());
                            set_status(&mut snapshot, status);
                        },
                        "Save New"
                    }
                    button {
                        class: "ghost-button",
                        onclick: move |_| {
                            let name = model_profile_name.read().clone();
                            let status = snapshot.write().update_active_model_profile(&name);
                            model_profile_name.set(String::new());
                            set_status(&mut snapshot, status);
                        },
                        "Update"
                    }
                    button {
                        class: "ghost-button",
                        onclick: move |_| {
                            let Some(profile_id) = snapshot.read().active_model_profile_id.clone() else {
                                set_status(&mut snapshot, "No active model profile selected.".to_string());
                                return;
                            };
                            let status = snapshot.write().delete_model_profile(&profile_id);
                            set_status(&mut snapshot, status);
                        },
                        "Delete"
                    }
                }
            }
            div { class: "diagnostic-actions",
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
                                    set_status(&mut snapshot, format!("Listed {count} model(s)."));
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
                div { class: "model-table",
                    div { class: "model-table-head",
                        span { "Model" }
                        span { "Profile" }
                    }
                    for model in current_models.iter() {
                        div { class: "model-row", key: "{model}",
                            button {
                                class: "ghost-button model-chip",
                                onclick: {
                                    let model = model.clone();
                                    move |_| {
                                        let applied = {
                                            let mut data = snapshot.write();
                                            data.provider.model = model.clone();
                                            match data.active_model_profile_id.clone() {
                                                Some(id) => data.apply_model_profile(&id).ok(),
                                                None => None,
                                            }
                                        };
                                        let suffix = applied
                                            .map(|status| format!(" {status}"))
                                            .unwrap_or_default();
                                        set_status(&mut snapshot, format!("Selected model: {model}.{suffix}"));
                                    }
                                },
                                "{model}"
                            }
                            select {
                                class: "model-profile-select",
                                value: "{active_model_profile_id}",
                                onchange: move |event| {
                                    let status = snapshot.write().apply_model_profile(&event.value());
                                    match status {
                                        Ok(status) => set_status(&mut snapshot, status),
                                        Err(err) => set_status(&mut snapshot, err),
                                    }
                                },
                                for profile in current.model_profiles.iter() {
                                    option { value: "{profile.id}", "{profile.name}" }
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
