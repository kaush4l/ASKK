use crate::agent_prompt::render_system_prompt;
use crate::engine::{pick_agent, sub_agent_roster};
use crate::inference::InferenceRequest;
use crate::responses::ResponseKind;
use crate::state::{AppSnapshot, default_tool_names};
use crate::tools::ToolRegistry;
use dioxus::prelude::*;

/// Right-panel preview of the exact prompt the next run will compile for the active
/// agent, in the order the model sees it: soul → agent (identity + role) → tools →
/// context → messages → response format. Built from the same `agent_prompt` renderer
/// the engine uses, so it stays in sync; the conversation messages are shown as a
/// placeholder since they only exist at run time.
#[component]
pub fn CompiledPromptPanel(snapshot: Signal<AppSnapshot>) -> Element {
    let current = snapshot.read().clone();
    let agent = pick_agent(&current, None);
    let prompt = compile_preview_prompt(&current, &agent);

    rsx! {
        aside { class: "panel compiled-prompt-panel",
            div { class: "panel-heading",
                h2 { "Compiled prompt" }
                span { class: "event-count", "{agent.name}" }
            }
            p { class: "muted compiled-prompt-note",
                "The full prompt the next run sends for the active agent, in order: soul → agent → tools → context → messages → response format. Tools from enabled MCP servers are added when the run connects them."
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
        now: crate::state::now_iso(),
        format_instructions: ResponseKind::ReAct.instructions(agent.response_format),
        parts: Vec::new(),
    };

    let system = render_system_prompt(&request)
        .unwrap_or_else(|err| format!("Unable to render prompt: {err}"));
    let response_format = request.format_instructions.clone();
    format!(
        "{system}\n\n## MESSAGES\n\n(The running conversation — the goal, prior turns, and tool observations — is inserted here at run time.)\n\n{response_format}"
    )
}
