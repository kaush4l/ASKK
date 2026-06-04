use dioxus::prelude::*;
use wasm_bindgen_futures::spawn_local;

mod engine;
mod inference;
mod responses;
mod state;
mod storage;
mod tools;

use engine::ReActEngine;
use inference::{list_models, test_chat};
use state::{default_tool_names, Agent, AppSnapshot, ProviderAuthMode};
use storage::{IndexedDbStorage, StorageAdapter};

const FAVICON: Asset = asset!("/assets/favicon.svg");
const MAIN_CSS: Asset = asset!("/assets/main.css");

fn main() {
    dioxus::launch(App);
}

#[component]
fn App() -> Element {
    let mut snapshot = use_signal(AppSnapshot::default);
    let mut goal = use_signal(String::new);
    let mut new_agent_name = use_signal(|| "ASKK Specialist".to_string());
    let mut new_agent_role = use_signal(|| {
        "Handle a focused part of the goal and use compiled tools when useful.".to_string()
    });
    let mut provider_models = use_signal(Vec::<String>::new);

    use_effect(move || {
        spawn_local(async move {
            match IndexedDbStorage::open().await {
                Ok(storage) => match storage.load_snapshot().await {
                    Ok(Some(saved)) => snapshot.set(saved),
                    Ok(None) => {}
                    Err(err) => set_status(&mut snapshot, format!("Load failed: {err}")),
                },
                Err(err) => set_status(&mut snapshot, err),
            }
        });
    });

    let current = snapshot.read().clone();
    let current_goal = goal.read().clone();
    let current_models = provider_models.read().clone();
    let tool_names = default_tool_names();

    rsx! {
        document::Link { rel: "icon", href: FAVICON }
        document::Link { rel: "stylesheet", href: MAIN_CSS }

        main { class: "app-shell",
            header { class: "topbar",
                div {
                    h1 { "ASKK" }
                    p { "Client-side multi-agent workspace compiled to Wasm with OpenAI-compatible browser fetch calls." }
                }
                div { class: "status-pill", "{current.status}" }
            }

            section { class: "security-note",
                strong { "Prototype key warning: " }
                span { "provider keys entered here are visible to browser code. Use testing keys. Hosted pages can call localhost only when the model server allows this page origin through CORS." }
            }

            div { class: "workspace-grid",
                section { class: "panel provider-panel",
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
                        div { class: "model-picker",
                            for model in current_models.iter() {
                                button {
                                    class: "ghost-button model-chip",
                                    key: "{model}",
                                    onclick: {
                                        let model = model.clone();
                                        move |_| {
                                            snapshot.write().provider.model = model.clone();
                                            set_status(&mut snapshot, format!("Selected model: {model}"));
                                        }
                                    },
                                    "{model}"
                                }
                            }
                        }
                    }
                }

                section { class: "panel agent-panel",
                    div { class: "panel-heading",
                        h2 { "Multi-Agent Team" }
                        button {
                            onclick: move |_| {
                                let agent = Agent::new(
                                    new_agent_name.read().clone(),
                                    new_agent_role.read().clone(),
                                    default_tool_names(),
                                );
                                snapshot.write().agents.push(agent);
                            },
                            "Add Agent"
                        }
                    }
                    div { class: "new-agent-row",
                        input {
                            value: "{new_agent_name.read()}",
                            oninput: move |event| new_agent_name.set(event.value())
                        }
                        input {
                            value: "{new_agent_role.read()}",
                            oninput: move |event| new_agent_role.set(event.value())
                        }
                    }
                    div { class: "agent-list",
                        for (agent_index, agent) in current.agents.iter().enumerate() {
                            article { class: "agent-card", key: "{agent.id}",
                                div { class: "agent-card-head",
                                    label { class: "checkbox-line",
                                        input {
                                            r#type: "checkbox",
                                            checked: agent.enabled,
                                            onchange: move |event| {
                                                if let Some(agent) = snapshot.write().agents.get_mut(agent_index) {
                                                    agent.enabled = event.checked();
                                                }
                                            }
                                        }
                                        strong { "{agent.name}" }
                                    }
                                    button {
                                        class: "ghost-button",
                                        onclick: move |_| {
                                            if snapshot.read().agents.len() > 1 {
                                                snapshot.write().agents.remove(agent_index);
                                            } else {
                                                set_status(&mut snapshot, "Keep at least one agent.".to_string());
                                            }
                                        },
                                        "Remove"
                                    }
                                }
                                label {
                                    "Name"
                                    input {
                                        value: "{agent.name}",
                                        oninput: move |event| {
                                            if let Some(agent) = snapshot.write().agents.get_mut(agent_index) {
                                                agent.name = event.value();
                                            }
                                        }
                                    }
                                }
                                label {
                                    "Role / system prompt"
                                    textarea {
                                        value: "{agent.role}",
                                        oninput: move |event| {
                                            if let Some(agent) = snapshot.write().agents.get_mut(agent_index) {
                                                agent.role = event.value();
                                            }
                                        }
                                    }
                                }
                                div { class: "tool-grid",
                                    for tool_name in tool_names.iter() {
                                        label { class: "checkbox-line tool-checkbox", key: "{agent.id}-{tool_name}",
                                            input {
                                                r#type: "checkbox",
                                                checked: agent.enabled_tools.iter().any(|enabled| enabled == tool_name),
                                                onchange: {
                                                    let tool_name = tool_name.clone();
                                                    move |event| {
                                                        if let Some(agent) = snapshot.write().agents.get_mut(agent_index) {
                                                            if event.checked() {
                                                                if !agent.enabled_tools.iter().any(|enabled| enabled == &tool_name) {
                                                                    agent.enabled_tools.push(tool_name.clone());
                                                                }
                                                            } else {
                                                                agent.enabled_tools.retain(|enabled| enabled != &tool_name);
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                            "{tool_name}"
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                section { class: "panel runner-panel",
                    div { class: "panel-heading",
                        h2 { "Task Runner" }
                        div { class: "button-row",
                            button {
                                onclick: move |_| {
                                    let run_goal = goal.read().trim().to_string();
                                    if run_goal.is_empty() {
                                        set_status(&mut snapshot, "Enter a goal before running.".to_string());
                                        return;
                                    }
                                    let start_data = snapshot.read().clone();
                                    let mut snapshot = snapshot;
                                    spawn_local(async move {
                                        set_status(&mut snapshot, "Running agent loop...".to_string());
                                        let runtime = ReActEngine::new();
                                        match runtime.run_goal(start_data, run_goal).await {
                                            Ok(next) => {
                                                let run_status = next.status.clone();
                                                let save_status = save_snapshot(next.clone()).await;
                                                snapshot.set(next);
                                                set_status(&mut snapshot, format!("{run_status}. {save_status}"));
                                            }
                                            Err(err) => set_status(&mut snapshot, format!("Run failed: {err}")),
                                        }
                                    });
                                },
                                "Run"
                            }
                            button {
                                onclick: move |_| {
                                    snapshot.write().current_run = None;
                                    set_status(&mut snapshot, "Current run reset.".to_string());
                                },
                                "Reset"
                            }
                        }
                    }
                    textarea {
                        class: "goal-box",
                        placeholder: "Describe a goal for the ASKK team...",
                        value: "{current_goal}",
                        oninput: move |event| goal.set(event.value())
                    }

                    if let Some(run) = current.current_run.as_ref() {
                        div { class: "final-answer",
                            h3 { "Final Answer" }
                            p { "{run.final_answer}" }
                        }
                        div { class: "timeline",
                            for event in run.events.iter() {
                                article { class: "event-row", key: "{event.id}",
                                    div { class: "event-meta",
                                        span { "{event.created_at}" }
                                        span { "{event.kind:?}" }
                                    }
                                    h3 { "{event.title}" }
                                    pre { "{event.body}" }
                                }
                            }
                        }
                    } else {
                        div { class: "empty-state", "No run yet. Enter a goal and run the browser agent loop." }
                    }
                }

                section { class: "panel inspector-panel",
                    h2 { "State Inspector" }
                    div { class: "stats-grid",
                        stat_block { label: "Agents", value: current.agents.len().to_string() }
                        stat_block { label: "Memories", value: current.memories.len().to_string() }
                        stat_block { label: "Tasks", value: current.tasks.len().to_string() }
                        stat_block { label: "Runs", value: current.runs.len().to_string() }
                    }
                    h3 { "Memories" }
                    compact_list { items: current.memories.iter().map(|item| item.content.clone()).collect::<Vec<_>>() }
                    h3 { "Tasks" }
                    compact_list {
                        items: current.tasks.iter().map(|task| format!("{} [{}]", task.title, task.status)).collect::<Vec<_>>()
                    }
                    h3 { "Recent Tool Calls" }
                    compact_list {
                        items: current.current_run.as_ref()
                            .map(|run| run.tool_calls.iter().map(|call| format!("{} {}", call.tool_name, call.arguments)).collect::<Vec<_>>())
                            .unwrap_or_default()
                    }
                }
            }
        }
    }
}

#[component]
fn stat_block(label: &'static str, value: String) -> Element {
    rsx! {
        div { class: "stat-block",
            span { "{label}" }
            strong { "{value}" }
        }
    }
}

#[component]
fn compact_list(items: Vec<String>) -> Element {
    rsx! {
        ul { class: "compact-list",
            if items.is_empty() {
                li { class: "muted", "None yet" }
            } else {
                for (index, item) in items.iter().enumerate() {
                    li { key: "{index}", "{item}" }
                }
            }
        }
    }
}

async fn save_snapshot(snapshot: AppSnapshot) -> String {
    match IndexedDbStorage::open().await {
        Ok(storage) => match storage.save_snapshot(&snapshot).await {
            Ok(()) => "Workspace saved to IndexedDB.".to_string(),
            Err(err) => format!("Save failed: {err}"),
        },
        Err(err) => err,
    }
}

fn set_status(snapshot: &mut Signal<AppSnapshot>, status: String) {
    snapshot.write().status = status;
}

#[derive(Clone, Copy)]
enum ProviderPreset {
    OpenAi,
    Ollama,
    LmStudio,
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
    }
}

fn should_replace_with_local_model(model: &str) -> bool {
    let model = model.trim();
    model.is_empty() || model == "gpt-4.1-mini" || model == "local-model"
}

fn is_local_placeholder(model: &str) -> bool {
    matches!(model.trim(), "" | "llama3.2" | "local-model")
}
