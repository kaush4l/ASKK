use super::agent_team::AgentTeam;
use super::chat_panel::ChatPanel;
use super::inspector::InspectorPanel;
use super::provider_settings::ProviderSettings;
use super::{FAVICON, MAIN_CSS};
use crate::state::{default_tool_names, AppSnapshot};
use dioxus::prelude::*;

#[component]
pub fn AppShell(
    snapshot: Signal<AppSnapshot>,
    goal: Signal<String>,
    new_agent_name: Signal<String>,
    new_agent_role: Signal<String>,
    provider_models: Signal<Vec<String>>,
) -> Element {
    let current = snapshot.read().clone();
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
                ProviderSettings { snapshot, provider_models }
                AgentTeam {
                    snapshot,
                    new_agent_name,
                    new_agent_role,
                    tool_names,
                }
                ChatPanel { snapshot, goal }
                InspectorPanel { snapshot }
            }
        }
    }
}
