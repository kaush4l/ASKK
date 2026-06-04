use super::shared::{CompactList, StatBlock};
use crate::state::AppSnapshot;
use dioxus::prelude::*;

#[component]
pub fn InspectorPanel(snapshot: Signal<AppSnapshot>) -> Element {
    let current = snapshot.read().clone();

    rsx! {
        section { class: "panel inspector-panel",
            h2 { "State Inspector" }
            div { class: "stats-grid",
                StatBlock { label: "Agents", value: current.agents.len().to_string() }
                StatBlock { label: "Profiles", value: current.provider_profiles.len().to_string() }
                StatBlock { label: "Memories", value: current.memories.len().to_string() }
                StatBlock { label: "Tasks", value: current.tasks.len().to_string() }
                StatBlock { label: "Runs", value: current.runs.len().to_string() }
            }
            h3 { "Provider Profiles" }
            CompactList {
                items: current.provider_profiles
                    .iter()
                    .map(|profile| format!("{} -> {}", profile.name, profile.config.model))
                    .collect::<Vec<_>>()
            }
            h3 { "Memories" }
            CompactList { items: current.memories.iter().map(|item| item.content.clone()).collect::<Vec<_>>() }
            h3 { "Tasks" }
            CompactList {
                items: current.tasks.iter().map(|task| format!("{} [{}]", task.title, task.status)).collect::<Vec<_>>()
            }
            h3 { "Recent Tool Calls" }
            CompactList {
                items: current.current_run.as_ref()
                    .map(|run| run.tool_calls.iter().map(|call| format!("{} {}", call.tool_name, call.arguments)).collect::<Vec<_>>())
                    .unwrap_or_default()
            }
        }
    }
}
