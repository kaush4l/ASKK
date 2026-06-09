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
use crate::responses::{ResponseFormat, ResponseKind};
use crate::state::{AppResult, Message, Skill, ToolSpec, default_soul_prompt};

/// A prompt whose **static** pieces are compiled once and reused across turns.
///
/// This mirrors LocalAgents' `BaseAgent`, where the soul, tool manifest, skills, and
/// sub-agent roster are assembled in `__init__` and cached, while only the per-turn
/// context, history, and current goal are rebuilt in `render()`. Splitting the prompt
/// this way keeps the hot path (one [`CompiledPrompt::render`] per agent step) free of
/// the repeated string work that the static sections would otherwise cost.
///
/// The static body is everything from the soul through the tool/skill sections —
/// `soul → "You are {name}" → role → ## SUB-AGENTS → ## AVAILABLE TOOLS → ## SKILLS`.
/// The dynamic tail a render appends is the run context (`## CONTEXT` + date), the
/// conversation history, the current goal, and — always **last** — the response-format
/// instructions, which the model reads right before it generates.
#[derive(Clone, Debug)]
pub struct CompiledPrompt {
    /// The precomputed static prefix: soul + identity/role + sub-agents + tools +
    /// skills, joined exactly as [`render_system_prompt`] would, but **without** the
    /// trailing `## CONTEXT` block (that is dynamic). Computed once in
    /// [`CompiledPrompt::new`] and never rebuilt.
    static_body: String,
}

/// The fully ordered, per-turn prompt pieces a [`CompiledPrompt::render`] produces.
///
/// The pieces are kept separate (rather than pre-joined) so the caller — today the
/// provider in [`crate::inference`] — can map them onto wire messages with the right
/// roles: the `system_prompt` is the system message, the `history` are the transcript
/// turns, and `response_format` is the final user message the model reads last.
// Adopted by the agent-loop unit, which will read these per turn; until then the
// fields are only exercised by tests, so the dead-code lint would otherwise fire.
#[allow(dead_code)]
#[derive(Clone, Debug)]
pub struct RenderedPrompt {
    /// The system message: the compiled static body followed by the dynamic
    /// `## CONTEXT` block (current date + sandbox note).
    pub system_prompt: String,
    /// The current goal for this run (the engine sends it as a user turn when no
    /// transcript is supplied).
    pub goal: String,
    /// The conversation transcript for this turn, in order.
    pub history: Vec<Message>,
    /// The response-format instructions — **always last**, so the model reads the
    /// output contract immediately before generating.
    pub response_format: String,
}

impl CompiledPrompt {
    /// Compile the **static** prompt pieces once: the soul (persona), the agent
    /// identity and role, the sub-agent roster (if any), the compiled tool manifest,
    /// and workspace skills (if any). The result is cached in [`Self::static_body`] and
    /// reused by every [`Self::render`] / [`Self::render_system`] — the dynamic
    /// context, history, goal, and response-format instructions are added per turn.
    pub fn new(
        soul: &str,
        agent_name: &str,
        agent_role: &str,
        sub_agents: &[SubAgentInfo],
        tools: &[ToolSpec],
        skills: &[Skill],
    ) -> Self {
        let soul_prompt = resolve_soul(soul);
        let sub_agents = describe_sub_agents(sub_agents);
        let tool_manifest = describe_tools(tools);
        let skills = describe_skills(skills);

        // Byte-identical to the legacy one-shot assembly, minus the trailing context
        // block: the context (`{skills}{context}`) had `skills` end in `\n\n` (or be
        // empty) so it slots before `## CONTEXT`. Trimming the trailing whitespace here
        // lets `render_system` re-append `\n\n{context}` and reproduce the exact text.
        let static_body = format!(
            "{soul_prompt}\n\nYou are {agent_name}.\n\n{agent_role}\n\n{sub_agents}{tool_manifest}\n\n{skills}",
            agent_role = agent_role.trim(),
        )
        .trim_end()
        .to_string();

        Self { static_body }
    }

    /// Compile the static pieces from an [`InferenceRequest`]'s agent-side fields
    /// (everything except the per-turn `now`, `goal`, `history`, and
    /// `response_format`). A convenience for callers that already hold a request and
    /// want the static body cached once before stepping the agent.
    pub fn from_request(request: &InferenceRequest) -> Self {
        Self::new(
            &request.soul,
            &request.agent_name,
            &request.agent_role,
            &request.sub_agents,
            &request.tools,
            &request.skills,
        )
    }

    /// Build the **system message** for a turn: the cached static body plus the dynamic
    /// `## CONTEXT` block carrying `now` (the current date) and the sandbox note. This
    /// is the system prompt only — the response-format instructions are appended
    /// separately (see [`Self::render`]).
    pub fn render_system(&self, now: &str) -> String {
        let context = render_context(now);
        format!("{}\n\n{context}", self.static_body)
    }

    /// Render all per-turn **dynamic** pieces around the cached static body: the system
    /// message (static body + context/date), the current `goal`, the conversation
    /// `history`, and the response-format instructions — which stay **last**. The
    /// static body itself is never recomputed; only this dynamic tail changes per turn.
    // The agent-loop unit calls this each step; until it lands the only caller is a
    // test, so the dead-code lint would otherwise flag it.
    #[allow(dead_code)]
    pub fn render(
        &self,
        now: &str,
        goal: &str,
        history: &[Message],
        response_format: ResponseFormat,
        response_kind: ResponseKind,
    ) -> RenderedPrompt {
        RenderedPrompt {
            system_prompt: self.render_system(now),
            goal: goal.to_string(),
            history: history.to_vec(),
            response_format: response_kind.instructions(response_format),
        }
    }
}

/// Render the system prompt for a working ReAct agent: the soul (persona) first, then
/// the agent identity and role, the sub-agent roster (if any), the compiled tool
/// manifest, workspace skills (if any), and the run context (current date + sandbox
/// note). The response-format instructions are appended separately by the provider as
/// the final message — see [`crate::inference`].
///
/// This is a thin back-compat wrapper over [`CompiledPrompt`]: it compiles the static
/// body and renders the system message in one call. Callers that step the same agent
/// repeatedly should build a [`CompiledPrompt`] once and reuse it.
pub fn render_system_prompt(request: &InferenceRequest) -> AppResult<String> {
    Ok(CompiledPrompt::from_request(request).render_system(&request.now))
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
    use crate::responses::{ReActResponse, ResponseFormat, StructuredResponse};
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
            format_instructions: ResponseKind::ReAct.instructions(ResponseFormat::Toon),
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

    /// The legacy one-shot assembly, inlined here as an independent golden reference so
    /// the [`CompiledPrompt`] split can never silently drift the wording the model sees.
    /// This is the exact `format!` the renderer used before the static/dynamic split.
    fn legacy_system_prompt(request: &InferenceRequest) -> String {
        let soul_prompt = resolve_soul(&request.soul);
        let sub_agents = describe_sub_agents(&request.sub_agents);
        let tool_manifest = describe_tools(&request.tools);
        let skills = describe_skills(&request.skills);
        let context = render_context(&request.now);
        format!(
            "{soul_prompt}\n\nYou are {agent_name}.\n\n{agent_role}\n\n{sub_agents}{tool_manifest}\n\n{skills}{context}",
            agent_name = request.agent_name,
            agent_role = request.agent_role.trim(),
        )
    }

    /// A request that exercises every static section (soul, role, sub-agents, tools,
    /// skills) so the golden comparison covers the trailing-whitespace seam between the
    /// skills block and the dynamic context.
    fn full_request() -> InferenceRequest {
        let mut request = base_request();
        request.tools = vec![ToolSpec {
            name: "web_search".to_string(),
            description: "Search the web.".to_string(),
            input_schema: serde_json::json!({"type": "object"}),
        }];
        request.sub_agents = vec![SubAgentInfo {
            name: "Researcher".to_string(),
            description: "Finds and reads current web sources.".to_string(),
        }];
        request
    }

    #[test]
    fn compiled_render_system_matches_legacy_byte_for_byte() {
        // No-skills / no-tools / no-roster case (the trailing seam is tool→context).
        let minimal = base_request();
        let mut minimal = minimal;
        minimal.skills = Vec::new();
        assert_eq!(
            CompiledPrompt::from_request(&minimal).render_system(&minimal.now),
            legacy_system_prompt(&minimal),
        );

        // Skills-present case (the trailing seam is skills→context).
        let with_skills = base_request();
        assert_eq!(
            CompiledPrompt::from_request(&with_skills).render_system(&with_skills.now),
            legacy_system_prompt(&with_skills),
        );

        // Every section populated.
        let full = full_request();
        assert_eq!(
            CompiledPrompt::from_request(&full).render_system(&full.now),
            legacy_system_prompt(&full),
        );

        // And the public back-compat wrapper agrees with the golden reference too.
        assert_eq!(
            render_system_prompt(&full).unwrap(),
            legacy_system_prompt(&full),
        );
    }

    #[test]
    fn static_body_is_stable_while_dynamic_pieces_vary() {
        let request = full_request();
        let compiled = CompiledPrompt::from_request(&request);

        // The static body is identical no matter the per-turn `now`.
        let a = compiled.render_system("2026-01-01T00:00:00Z");
        let b = compiled.render_system("2030-12-31T23:59:59Z");
        let static_a = a.split("\n\n## CONTEXT").next().unwrap();
        let static_b = b.split("\n\n## CONTEXT").next().unwrap();
        assert_eq!(static_a, static_b);
        // Only the dynamic context differs.
        assert_ne!(a, b);
        assert!(a.contains("Current date (UTC): 2026-01-01T00:00:00Z"));
        assert!(b.contains("Current date (UTC): 2030-12-31T23:59:59Z"));
    }

    #[test]
    fn render_keeps_response_format_last_and_carries_dynamic_goal_and_history() {
        let request = full_request();
        let compiled = CompiledPrompt::from_request(&request);

        let history = vec![Message {
            role: "user".to_string(),
            content: "Earlier turn.".to_string(),
        }];
        let first = compiled.render(
            &request.now,
            "Goal one.",
            &history,
            ResponseFormat::Toon,
            ResponseKind::ReAct,
        );
        let second = compiled.render(
            "2031-02-03T00:00:00Z",
            "Goal two.",
            &[],
            ResponseFormat::Json,
            ResponseKind::ReAct,
        );

        // The static body inside the system prompt is unchanged across renders.
        let static_first = first.system_prompt.split("\n\n## CONTEXT").next().unwrap();
        let static_second = second.system_prompt.split("\n\n## CONTEXT").next().unwrap();
        assert_eq!(static_first, static_second);

        // Dynamic pieces vary per call.
        assert_eq!(first.goal, "Goal one.");
        assert_eq!(second.goal, "Goal two.");
        assert_eq!(first.history, history);
        assert!(second.history.is_empty());

        // The response-format instructions are produced (and differ per format), to be
        // wired as the final message the model reads.
        assert_eq!(
            first.response_format,
            ReActResponse::instructions(ResponseFormat::Toon)
        );
        assert_eq!(
            second.response_format,
            ReActResponse::instructions(ResponseFormat::Json)
        );
        assert_ne!(first.response_format, second.response_format);
    }
}
