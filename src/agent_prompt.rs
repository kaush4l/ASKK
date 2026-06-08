//! Agent-owned prompt rendering: the one place the *whole* system prompt is
//! assembled from the agent's parts.
//!
//! This is ASKK's "format the whole prompt within the agent" seam. A provider
//! ([`crate::inference`]) only wires the rendered system prompt to the transcript and
//! ships it — it never composes prompt sections itself. The renderer turns the
//! in-code objects (the soul, the agent role, [`Skill`]s, [`ToolSpec`]s, and the
//! sub-agent roster) into the LLM-facing text, in a fixed order:
//!
//! `soul → "You are {name}" → role → ReAct guidance → sub-agents → tools → skills →
//! response-format`.
//!
//! The soul is always first; everything task-specific follows it.

use crate::inference::{InferenceRequest, SubAgentInfo};
use crate::responses::{ReActResponse, StructuredResponse, VerificationCriticResponse};
use crate::state::{AppResult, Skill, ToolSpec, default_soul_prompt};

/// Shared ReAct-loop guidance shown to every working agent (between its role and
/// the tool/skill manifests).
const REACT_GUIDANCE: &str = "You run inside a client-only browser Wasm prototype. The runner is a ReAct loop: each turn you must choose either one tool call or a final answer. If a tool observation is returned in the conversation history, use it to decide the next turn.

Use `action: tool` only when the next best step is to call a compiled tool. Put exactly one invocation in `response`, such as `web_search({\"query\":\"Dioxus 0.7 signals\",\"count\":5})`.

Use `web_search` when the goal needs current public information, source discovery, or web evidence. Good parameters are `query`, optional `count` from 1 to 10, and optional `country`, `language`, `freshness`, `date_after`, or `date_before`.

Use `action: answer` when you have enough information or when further tool use is unlikely to help.

All tools are precompiled and execute inside the browser or the local ASKK bridge.";

/// Render the full system prompt for a working ReAct agent. Soul first, then the
/// agent identity/role, ReAct guidance, the sub-agent roster (if any), the compiled
/// tool manifest, workspace skills, and the response-format instructions.
pub fn render_system_prompt(request: &InferenceRequest) -> AppResult<String> {
    let soul_prompt = resolve_soul(&request.soul);
    let tool_manifest = describe_tools(&request.tools)?;
    let skill_prompt = describe_skills(&request.skills);
    let sub_agents = describe_sub_agents(&request.sub_agents);
    let response_instructions = ReActResponse::instructions(request.response_format);

    Ok(format!(
        "{soul_prompt}\n\nYou are {agent_name}.\n\nRole:\n{agent_role}\n\n{REACT_GUIDANCE}\n\n{sub_agents}Available compiled tools:\n{tool_manifest}\n\nWorkspace skills:\n{skill_prompt}\n\n{response_instructions}",
        agent_name = request.agent_name,
        agent_role = request.agent_role,
    ))
}

/// Render the system prompt for the verification critic: same soul/identity/role
/// header, but no tools or sub-agents and the critic's own charter + response format.
pub fn render_critic_system_prompt(request: &InferenceRequest) -> AppResult<String> {
    let soul_prompt = resolve_soul(&request.soul);
    let skill_prompt = describe_skills(&request.skills);
    let response_instructions = VerificationCriticResponse::instructions(request.response_format);

    Ok(format!(
        "{soul_prompt}\n\nYou are {agent_name}.\n\nRole:\n{agent_role}\n\nYou are a verifier. Decide whether the worker result satisfies the user's goal using only the supplied worker result, evidence, and checks. Prefer deterministic evidence. Do not call tools. Return `passed: true` only when the answer is supported by the evidence and no required work remains.\n\nWorkspace skills:\n{skill_prompt}\n\n{response_instructions}",
        agent_name = request.agent_name,
        agent_role = request.agent_role,
    ))
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

/// Code-object → LLM-info: the compiled tool manifest the model may call. Each
/// [`ToolSpec`] is already MCP-shaped (`{ name, description, input_schema }`); we
/// serialize the set as the model's tool catalogue.
fn describe_tools(tools: &[ToolSpec]) -> AppResult<String> {
    serde_json::to_string_pretty(tools)
        .map_err(|err| format!("Unable to serialize tool manifest: {err}"))
}

/// Code-object → LLM-info: the enabled workspace [`Skill`]s, each rendered as a
/// markdown section. Skills are guidance the agent should weave into its approach.
fn describe_skills(skills: &[Skill]) -> String {
    let enabled = skills
        .iter()
        .filter(|skill| skill.enabled && !skill.content.trim().is_empty())
        .map(|skill| format!("## {}\n{}", skill.name.trim(), skill.content.trim()))
        .collect::<Vec<_>>();
    if enabled.is_empty() {
        "No workspace skills are enabled.".to_string()
    } else {
        enabled.join("\n\n")
    }
}

/// Code-object → LLM-info: the sub-agent roster the agent "sees" and can delegate
/// to. Empty roster renders to an empty string so single-agent prompts are
/// unchanged; otherwise a labelled, trailing-blank-line block so it slots cleanly
/// before the tool manifest.
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
        "Sub-agents you can delegate to (hand a focused sub-task to one; it runs its own ReAct loop and returns a result you then build on):\n{roster}\n\n"
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
            response_format: ResponseFormat::Toon,
        }
    }

    #[test]
    fn soul_is_rendered_before_identity_and_role() {
        let system = render_system_prompt(&base_request()).unwrap();
        assert!(system.starts_with("Shared behavior."));
        assert!(
            system.find("You are Planner.").unwrap() > system.find("Shared behavior.").unwrap()
        );
        assert!(system.contains("Role:\nPlan carefully."));
        assert!(system.contains("## Care\nWork carefully."));
    }

    #[test]
    fn blank_soul_falls_back_to_default() {
        let mut request = base_request();
        request.soul = "   ".to_string();
        let system = render_system_prompt(&request).unwrap();
        assert!(!system.starts_with("You are"));
        // The bundled soul is non-empty.
        assert!(system.trim_start().len() > "You are Planner.".len());
    }

    #[test]
    fn empty_roster_omits_sub_agent_section() {
        let system = render_system_prompt(&base_request()).unwrap();
        assert!(!system.contains("Sub-agents you can delegate to"));
        // The tool manifest must follow the ReAct guidance directly.
        assert!(system.contains("ASKK bridge.\n\nAvailable compiled tools:"));
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
        assert!(system.contains("Sub-agents you can delegate to"));
        assert!(system.contains("- Researcher: Finds and reads current web sources."));
        assert!(system.contains("- Coder: Writes and runs code in the browser."));
        // Roster sits between the ReAct guidance and the tool manifest.
        let roster_at = system.find("Sub-agents you can delegate to").unwrap();
        let tools_at = system.find("Available compiled tools:").unwrap();
        let guidance_at = system.find("All tools are precompiled").unwrap();
        assert!(guidance_at < roster_at && roster_at < tools_at);
    }

    #[test]
    fn critic_prompt_has_verifier_charter_and_no_tools() {
        let system = render_critic_system_prompt(&base_request()).unwrap();
        assert!(system.starts_with("Shared behavior."));
        assert!(system.contains("You are a verifier."));
        assert!(!system.contains("Available compiled tools:"));
    }
}
