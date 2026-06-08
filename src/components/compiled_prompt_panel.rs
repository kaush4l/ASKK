use crate::agent_prompt::render_system_prompt;
use crate::engine::{pick_agent, sub_agent_roster};
use crate::inference::InferenceRequest;
use crate::state::{AppSnapshot, default_tool_names};
use crate::tools::ToolRegistry;
use dioxus::prelude::*;

/// Right-panel preview of the exact system prompt the next run will compile for the
/// active agent (soul → identity → role → tools → skills → sub-agents → format).
/// Built from the same `agent_prompt` renderer the engine uses, so it stays in sync.
#[component]
pub fn CompiledPromptPanel(snapshot: Signal<AppSnapshot>) -> Element {
    let current = snapshot.read().clone();
    let agent = pick_agent(&current);
    let prompt = compile_preview_prompt(&current, &agent);

    rsx! {
        aside { class: "panel compiled-prompt-panel",
            div { class: "panel-heading",
                h2 { "Compiled prompt" }
                span { class: "event-count", "{agent.name}" }
            }
            p { class: "muted compiled-prompt-note",
                "The system prompt the next run sends for the active agent. Tools from enabled MCP servers are added when the run connects them."
            }
            div { class: "scroll-area",
                pre { class: "compiled-prompt", "{prompt}" }
            }
        }
    }
}

/// Render the system prompt for the agent that would run next, using only what is
/// knowable on the main thread (compiled built-in tools + soul + skills + roster).
/// Live MCP tools are discovered in the worker at run start, so they are noted in
/// the panel rather than shown here.
fn compile_preview_prompt(snapshot: &AppSnapshot, agent: &crate::state::Agent) -> String {
    let enabled_tools = if agent.enabled_tools.is_empty() {
        default_tool_names()
    } else {
        agent.enabled_tools.clone()
    };
    let tools = ToolRegistry::new().specs_for_agent(&enabled_tools);
    let sub_agents = sub_agent_roster(snapshot, &agent.id);

    let request = InferenceRequest {
        agent_name: agent.name.clone(),
        agent_role: agent.role.clone(),
        soul: snapshot.soul.clone(),
        skills: snapshot.skills.clone(),
        goal: String::new(),
        history: Vec::new(),
        tools,
        sub_agents,
        response_format: agent.response_format,
    };

    render_system_prompt(&request).unwrap_or_else(|err| format!("Unable to render prompt: {err}"))
}
