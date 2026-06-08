//! Agent-owned prompt rendering: the one place the *whole* system prompt is
//! assembled from the agent's parts.
//!
//! This is ASKK's "format the whole prompt within the agent" seam. A provider
//! ([`crate::inference`]) only wires the rendered system prompt to the transcript and
//! ships it — it never composes prompt sections itself. The renderer turns the
//! in-code objects (the soul, the agent role, the run context, [`Skill`]s,
//! [`ToolSpec`]s, and the sub-agent roster) into the LLM-facing text, in a fixed
//! order:
//!
//! `soul → "You are {name}" → role → ## SUB-AGENTS → ## AVAILABLE TOOLS → ## SKILLS
//! → ## CONTEXT`.
//!
//! The soul is always first (the agent's persona/identity); everything task-specific
//! follows it. The prompt carries only what the agent's objects actually contain: no
//! boilerplate headers, and tools render as minimal markdown (a name, a description,
//! and a usage hint) rather than a raw JSON-Schema dump. Optional sub-agent and skill
//! sections are omitted when empty. The response-format instructions are not part of
//! the system prompt; the provider appends them as the final message, after the
//! conversation, so the model reads them last. The full order the model sees is
//! therefore soul, agent, tools, context, messages, response format.

use crate::inference::{InferenceRequest, SubAgentInfo};
use crate::state::{AppResult, Skill, ToolSpec, default_soul_prompt};

/// Render the system prompt for a working ReAct agent: the soul (persona) first, then
/// the agent identity and role, the sub-agent roster (if any), the compiled tool
/// manifest, workspace skills (if any), and the run context (current date + sandbox
/// note). The response-format instructions are appended separately by the provider as
/// the final message — see [`crate::inference`].
pub fn render_system_prompt(request: &InferenceRequest) -> AppResult<String> {
    let soul_prompt = resolve_soul(&request.soul);
    let sub_agents = describe_sub_agents(&request.sub_agents);
    let tool_manifest = describe_tools(&request.tools);
    let skills = describe_skills(&request.skills);
    let context = render_context(&request.now);

    Ok(format!(
        "{soul_prompt}\n\nYou are {agent_name}.\n\n{agent_role}\n\n{sub_agents}{tool_manifest}\n\n{skills}{context}",
        agent_name = request.agent_name,
        agent_role = request.agent_role.trim(),
    ))
}

/// The run context block: the current date (so the agent can reason about "now" — e.g.
/// when searching for news) plus the one-line sandbox note. The date string is read
/// once at request-build time (see [`crate::state::now_iso`]) and passed in, so this
/// renderer stays pure and platform-free.
fn render_context(now: &str) -> String {
    format!(
        "## CONTEXT\n\nCurrent date (UTC): {now}\nYou run in a client-only browser Wasm sandbox; tools execute in the browser or the local ASKK bridge."
    )
}

/// The soul text, falling back to the bundled default when the snapshot's soul is
/// blank. Always rendered first in every prompt.
fn resolve_soul(soul: &str) -> String {
    if soul.trim().is_empty() {
        default_soul_prompt()
    } else {
        soul.trim().to_string()
    }
}

/// Code-object → LLM-info: the compiled tool manifest the model may call. Each tool
/// is rendered as a minimal markdown entry — its name, its description, and a generic
/// invocation hint — never a raw JSON-Schema dump. The exact parameters live in the
/// description; the model writes the call as `tool_name({"key": "value"})` (the same
/// shape the response-format instructions require).
fn describe_tools(tools: &[ToolSpec]) -> String {
    if tools.is_empty() {
        return "## AVAILABLE TOOLS\n\n(No tools are enabled for this agent.)".to_string();
    }
    let entries = tools
        .iter()
        .map(|tool| {
            format!(
                "## {name}\n{description}\nUsage: {name}({{\"key\": \"value\"}})",
                name = tool.name.trim(),
                description = tool.description.trim(),
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    format!("## AVAILABLE TOOLS\n\n{entries}")
}

/// Code-object → LLM-info: the enabled workspace [`Skill`]s, each a markdown
/// subsection under a `## SKILLS` header. Returns an empty string when none are
/// enabled (so the section is omitted entirely, not rendered as a "none" placeholder);
/// otherwise a trailing-blank-line block so it slots cleanly before the response
/// format.
fn describe_skills(skills: &[Skill]) -> String {
    let enabled = skills
        .iter()
        .filter(|skill| skill.enabled && !skill.content.trim().is_empty())
        .map(|skill| format!("### {}\n{}", skill.name.trim(), skill.content.trim()))
        .collect::<Vec<_>>();
    if enabled.is_empty() {
        return String::new();
    }
    format!("## SKILLS\n\n{}\n\n", enabled.join("\n\n"))
}

/// Code-object → LLM-info: the sub-agent roster the agent "sees" and can delegate
/// to. Empty roster renders to an empty string so single-agent prompts omit the
/// section; otherwise a labelled `## SUB-AGENTS` block with a trailing blank line so
/// it slots cleanly before the tool manifest.
fn describe_sub_agents(sub_agents: &[SubAgentInfo]) -> String {
    if sub_agents.is_empty() {
        return String::new();
    }
    let roster = sub_agents
        .iter()
        .map(|agent| format!("- {}: {}", agent.name.trim(), agent.description.trim()))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "## SUB-AGENTS\n\nHand a focused sub-task to one; it runs its own ReAct loop and returns a result you build on.\n{roster}\n\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::responses::ResponseFormat;
    use crate::state::Message;

    fn base_request() -> InferenceRequest {
        InferenceRequest {
            agent_name: "Planner".to_string(),
            agent_role: "Plan carefully.".to_string(),
            soul: "Shared behavior.".to_string(),
            skills: vec![Skill {
                id: "care".to_string(),
                name: "Care".to_string(),
                content: "Work carefully.".to_string(),
                enabled: true,
                source_path: None,
            }],
            goal: "Ship it.".to_string(),
            history: Vec::<Message>::new(),
            tools: Vec::new(),
            sub_agents: Vec::new(),
            now: "2026-06-08T00:00:00Z".to_string(),
            response_format: ResponseFormat::Toon,
        }
    }

    #[test]
    fn soul_is_rendered_before_identity_and_role() {
        let system = render_system_prompt(&base_request()).unwrap();
        assert!(system.starts_with("Shared behavior."));
        let soul_at = system.find("Shared behavior.").unwrap();
        let identity_at = system.find("You are Planner.").unwrap();
        let role_at = system.find("Plan carefully.").unwrap();
        assert!(soul_at < identity_at && identity_at < role_at);
        // The role is rendered directly under the identity line, with no "Role:" label.
        assert!(!system.contains("Role:"));
        assert!(system.contains("### Care\nWork carefully."));
    }

    #[test]
    fn context_block_carries_the_current_date_and_comes_last() {
        let system = render_system_prompt(&base_request()).unwrap();
        assert!(system.contains("## CONTEXT"));
        assert!(system.contains("Current date (UTC): 2026-06-08T00:00:00Z"));
        // Context is the last section of the system prompt (tools precede it).
        assert!(system.find("## AVAILABLE TOOLS").unwrap() < system.find("## CONTEXT").unwrap());
        // The response format is NOT in the system prompt; the provider appends it as
        // the final message, after the conversation.
        assert!(!system.contains("## RESPONSE FORMAT"));
    }

    #[test]
    fn tools_render_as_minimal_markdown_not_json_schema() {
        let mut request = base_request();
        request.tools = vec![ToolSpec {
            name: "web_search".to_string(),
            description: "Search the web.".to_string(),
            input_schema: serde_json::json!({"type": "object"}),
        }];
        let system = render_system_prompt(&request).unwrap();
        assert!(system.contains("## AVAILABLE TOOLS"));
        assert!(
            system.contains(
                "## web_search\nSearch the web.\nUsage: web_search({\"key\": \"value\"})"
            )
        );
        // No raw JSON-Schema leaked into the prompt.
        assert!(!system.contains("input_schema"));
        assert!(!system.contains("\"type\": \"object\""));
    }

    #[test]
    fn blank_soul_falls_back_to_default() {
        let mut request = base_request();
        request.soul = "   ".to_string();
        let system = render_system_prompt(&request).unwrap();
        let default_soul = default_soul_prompt();
        let default_soul = default_soul.trim();
        // A blank soul falls back to the bundled default, rendered first.
        assert!(system.starts_with(default_soul));
        // The agent identity follows the (non-empty) fallback soul.
        assert!(system.find("You are Planner.").unwrap() > default_soul.len() - 1);
    }

    #[test]
    fn empty_roster_omits_sub_agent_section() {
        let system = render_system_prompt(&base_request()).unwrap();
        assert!(!system.contains("## SUB-AGENTS"));
        // With no peers, the tool manifest follows the role directly.
        assert!(system.contains("Plan carefully.\n\n## AVAILABLE TOOLS"));
    }

    #[test]
    fn roster_is_rendered_when_sub_agents_present() {
        let mut request = base_request();
        request.sub_agents = vec![
            SubAgentInfo {
                name: "Researcher".to_string(),
                description: "Finds and reads current web sources.".to_string(),
            },
            SubAgentInfo {
                name: "Coder".to_string(),
                description: "Writes and runs code in the browser.".to_string(),
            },
        ];
        let system = render_system_prompt(&request).unwrap();
        assert!(system.contains("## SUB-AGENTS"));
        assert!(system.contains("- Researcher: Finds and reads current web sources."));
        assert!(system.contains("- Coder: Writes and runs code in the browser."));
        // Order: identity/role → sub-agents → tools → context.
        let identity_at = system.find("You are Planner.").unwrap();
        let roster_at = system.find("## SUB-AGENTS").unwrap();
        let tools_at = system.find("## AVAILABLE TOOLS").unwrap();
        let context_at = system.find("## CONTEXT").unwrap();
        assert!(identity_at < roster_at && roster_at < tools_at && tools_at < context_at);
    }
}
