//! Agents and skills, and the Markdown-manifest parsing that builds them. An agent
//! or skill is authored as a Markdown file with YAML-ish frontmatter (see
//! `docs/extensibility.md`); the parsers here turn that text into [`Agent`] /
//! [`Skill`] data and back. The bundled defaults are embedded from the repo's
//! `soul.md`, `agents/`, and `skills/` at build time.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::AppResult;
use super::tool_types::default_tool_names;
use crate::responses::ResponseFormat;

const DEFAULT_SOUL: &str = include_str!("../../soul.md");
const DEFAULT_AGENT_FILES: [(&str, &str); 5] = [
    ("agents/planner.md", include_str!("../../agents/planner.md")),
    ("agents/coder.md", include_str!("../../agents/coder.md")),
    (
        "agents/researcher.md",
        include_str!("../../agents/researcher.md"),
    ),
    (
        "agents/synthesizer.md",
        include_str!("../../agents/synthesizer.md"),
    ),
    (
        "agents/orchestrator.md",
        include_str!("../../agents/orchestrator.md"),
    ),
];
const DEFAULT_SKILL_FILES: [(&str, &str); 3] = [
    (
        "skills/research/SKILL.md",
        include_str!("../../skills/research/SKILL.md"),
    ),
    (
        "skills/coding/SKILL.md",
        include_str!("../../skills/coding/SKILL.md"),
    ),
    (
        "skills/synthesis/SKILL.md",
        include_str!("../../skills/synthesis/SKILL.md"),
    ),
];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub role: String,
    pub enabled: bool,
    pub enabled_tools: Vec<String>,
    #[serde(default)]
    pub response_format: ResponseFormat,
    #[serde(default)]
    pub source_path: Option<String>,
    /// Optional model profile this agent runs with. Falls back to the workspace
    /// active model profile when unset.
    #[serde(default)]
    pub model_profile_id: Option<String>,
    #[serde(default)]
    pub workflow_id: Option<String>,
    /// Strategy this agent runs by default. `None` = the workspace default
    /// (`react`). Overridable per invocation via `LoopParams.strategy`.
    #[serde(default)]
    pub strategy_id: Option<String>,
}

impl Agent {
    pub fn new(
        name: impl Into<String>,
        role: impl Into<String>,
        enabled_tools: Vec<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            role: role.into(),
            enabled: true,
            enabled_tools,
            response_format: ResponseFormat::Toon,
            source_path: None,
            model_profile_id: None,
            workflow_id: None,
            strategy_id: None,
        }
    }

    /// A one-line, LLM-facing summary of this agent for the sub-agent roster
    /// (code object → LLM information). Agents carry their full instruction as the
    /// role/markdown body rather than a separate description field, so the summary
    /// is the first non-empty line of the role, stripped of markdown heading/bullet
    /// markers and bounded in length.
    pub fn short_description(&self) -> String {
        self.role
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .map(|line| {
                let cleaned = line.trim_start_matches(['#', '-', '*', ' ']).trim();
                if cleaned.chars().count() > 200 {
                    let mut out = cleaned.chars().take(200).collect::<String>();
                    out.push('…');
                    out
                } else {
                    cleaned.to_string()
                }
            })
            .filter(|summary| !summary.is_empty())
            .unwrap_or_else(|| self.name.clone())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub content: String,
    pub enabled: bool,
    #[serde(default)]
    pub source_path: Option<String>,
}

pub fn default_soul_prompt() -> String {
    DEFAULT_SOUL.trim().to_string()
}

pub fn default_agents() -> Vec<Agent> {
    let agents = DEFAULT_AGENT_FILES
        .iter()
        .filter_map(|(path, content)| agent_from_markdown(path, content).ok())
        .collect::<Vec<_>>();

    if agents.is_empty() {
        return vec![Agent::new("Agent", "", default_tool_names())];
    }
    agents
}

pub fn default_skills() -> Vec<Skill> {
    DEFAULT_SKILL_FILES
        .iter()
        .filter_map(|(path, content)| skill_from_markdown(path, content).ok())
        .collect()
}

pub fn agent_from_markdown(path: &str, content: &str) -> AppResult<Agent> {
    let (meta, body) = split_markdown_frontmatter(content);
    let id = meta_value(&meta, "id")
        .filter(|value| !value.trim().is_empty())
        .map(|value| slugify(&value))
        .unwrap_or_else(|| slug_from_path(path));
    let name = meta_value(&meta, "name")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| title_from_slug(&id));
    let enabled = meta_value(&meta, "enabled")
        .map(|value| parse_bool(&value))
        .unwrap_or(true);
    let enabled_tools = meta_value(&meta, "tools")
        .map(|value| parse_tools(&value))
        .unwrap_or_else(default_tool_names);
    let response_format = meta_value(&meta, "response_format")
        .or_else(|| meta_value(&meta, "format"))
        .map(|value| ResponseFormat::from_form_value(&value))
        .unwrap_or_default();
    let workflow_id = meta_value(&meta, "workflow")
        .filter(|value| !value.trim().is_empty())
        .map(|value| slugify(&value));
    let strategy_id = meta_value(&meta, "strategy")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let role = body.trim().to_string();

    if role.is_empty() {
        return Err(format!("Agent file {path} does not contain a prompt body."));
    }

    Ok(Agent {
        id,
        name,
        role,
        enabled,
        enabled_tools,
        response_format,
        source_path: Some(path.to_string()),
        model_profile_id: None,
        workflow_id,
        strategy_id,
    })
}

pub fn agent_to_markdown(agent: &Agent) -> String {
    let tools = if same_tools(&agent.enabled_tools, &default_tool_names()) {
        "all".to_string()
    } else {
        agent.enabled_tools.join(", ")
    };
    let strategy_line = match agent.strategy_id.as_deref() {
        Some(s) if !s.is_empty() => format!("strategy: {s}\n"),
        _ => String::new(),
    };
    format!(
        "---\nid: {id}\nname: {name}\nenabled: {enabled}\ntools: {tools}\nresponse_format: {response_format}\n{strategy_line}---\n\n{role}\n",
        id = slugify(&agent.id),
        name = agent.name.trim(),
        enabled = agent.enabled,
        tools = tools,
        response_format = agent.response_format.as_form_value(),
        strategy_line = strategy_line,
        role = agent.role.trim(),
    )
}

pub fn agent_markdown_path(agent: &Agent) -> String {
    agent
        .source_path
        .as_deref()
        .filter(|path| path.starts_with("agents/") && path.ends_with(".md"))
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("agents/{}.md", slugify(&agent.name)))
}

pub fn skill_from_markdown(path: &str, content: &str) -> AppResult<Skill> {
    let (meta, body) = split_markdown_frontmatter(content);
    let id = meta_value(&meta, "id")
        .filter(|value| !value.trim().is_empty())
        .map(|value| slugify(&value))
        .unwrap_or_else(|| slug_from_path(path));
    let name = meta_value(&meta, "name")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| title_from_slug(&id));
    let enabled = meta_value(&meta, "enabled")
        .map(|value| parse_bool(&value))
        .unwrap_or(true);
    let body = body.trim().to_string();

    if body.is_empty() {
        return Err(format!("Skill file {path} does not contain a body."));
    }

    Ok(Skill {
        id,
        name,
        content: body,
        enabled,
        source_path: Some(path.to_string()),
    })
}

fn split_markdown_frontmatter(content: &str) -> (Vec<(String, String)>, String) {
    let normalized = content.replace("\r\n", "\n");
    let mut lines = normalized.lines();
    if lines.next() != Some("---") {
        return (Vec::new(), normalized);
    }

    let mut meta = Vec::new();
    let mut body = Vec::new();
    let mut in_meta = true;
    for line in lines {
        if in_meta && line.trim() == "---" {
            in_meta = false;
            continue;
        }
        if in_meta {
            if let Some((key, value)) = line.split_once(':') {
                meta.push((key.trim().to_ascii_lowercase(), value.trim().to_string()));
            }
        } else {
            body.push(line);
        }
    }
    (meta, body.join("\n"))
}

fn meta_value(meta: &[(String, String)], key: &str) -> Option<String> {
    meta.iter()
        .find(|(candidate, _)| candidate == key)
        .map(|(_, value)| value.clone())
}

fn parse_bool(value: &str) -> bool {
    !matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "false" | "0" | "no"
    )
}

/// Parse and normalize a `tools:` allowlist (comma-separated, lowercased, deduped).
/// Empty or `all` expands to the full built-in set. Crate-visible because the
/// snapshot normalizer re-runs it over loaded agents.
pub(crate) fn parse_tools(value: &str) -> Vec<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("all") {
        return default_tool_names();
    }

    let mut tools = Vec::new();
    for raw in trimmed.split(',') {
        let candidate = raw.trim();
        if candidate.is_empty() {
            continue;
        }
        if !candidate
            .chars()
            .all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
        {
            continue;
        }
        let normalized = candidate.to_ascii_lowercase();
        if !tools.iter().any(|tool| tool == &normalized) {
            tools.push(normalized);
        }
    }

    if tools.is_empty() {
        default_tool_names()
    } else {
        tools
    }
}

fn same_tools(left: &[String], right: &[String]) -> bool {
    let mut left = left.to_vec();
    let mut right = right.to_vec();
    left.sort();
    right.sort();
    left == right
}

fn slug_from_path(path: &str) -> String {
    let file = path
        .rsplit('/')
        .next()
        .unwrap_or(path)
        .trim_end_matches(".md")
        .trim_end_matches(".MD");
    slugify(file)
}

fn title_from_slug(slug: &str) -> String {
    slug.split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn slugify(value: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in value.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        Uuid::new_v4().to_string()
    } else {
        slug
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_agent_markdown_frontmatter_and_normalizes_tools() {
        let agent = agent_from_markdown(
            "agents/deep-research.md",
            "---\nid: deep-research\nname: Deep Research\nenabled: false\ntools: memory_search, web_search\nresponse_format: json\n---\n\nResearch deeply.",
        )
        .unwrap();

        assert_eq!(agent.id, "deep-research");
        assert_eq!(agent.name, "Deep Research");
        assert!(!agent.enabled);
        assert_eq!(
            agent.enabled_tools,
            vec!["memory_search".to_string(), "web_search".to_string()]
        );
        assert_eq!(agent.response_format, ResponseFormat::Json);
        assert_eq!(agent.role, "Research deeply.");
        assert_eq!(
            agent.source_path.as_deref(),
            Some("agents/deep-research.md")
        );

        let serialized = agent_to_markdown(&agent);
        assert!(serialized.contains("name: Deep Research"));
        assert!(serialized.contains("tools: memory_search, web_search"));
        assert!(serialized.contains("response_format: json"));
        assert!(serialized.contains("Research deeply."));
    }

    #[test]
    fn agent_markdown_defaults_to_toon_response_format() {
        let agent = agent_from_markdown(
            "agents/planner.md",
            "---\nid: planner\nname: Planner\nenabled: true\ntools: all\n---\n\nPlan.",
        )
        .unwrap();

        assert_eq!(agent.response_format, ResponseFormat::Toon);
    }

    #[test]
    fn parses_skill_markdown_frontmatter_and_body() {
        let skill = skill_from_markdown(
            "skills/research/SKILL.md",
            "---\nid: research\nname: Research\nenabled: true\n---\n\nUse evidence.",
        )
        .unwrap();

        assert_eq!(skill.id, "research");
        assert_eq!(skill.name, "Research");
        assert!(skill.enabled);
        assert_eq!(skill.content, "Use evidence.");
        assert_eq!(
            skill.source_path.as_deref(),
            Some("skills/research/SKILL.md")
        );
    }

    #[test]
    fn default_tool_list_contains_expected_browser_tools() {
        assert_eq!(
            default_tool_names(),
            vec![
                "run_js",
                "run_python",
                "web_search",
                "web_fetch",
                "run_command",
                "run_in_sandbox",
                "fs_read",
                "fs_write",
                "fs_list",
                "file_read",
                "file_write",
                "file_list",
                "file_edit",
                "camera_capture",
                "screen_capture",
                "mic_record",
                "geolocate",
                "clipboard_read",
                "clipboard_write",
                "notify_user",
                "speak_text",
                "device_info",
            ]
        );
        assert_eq!(parse_tools("all"), default_tool_names());
    }

    #[test]
    fn parses_agent_tool_allowlist_from_markdown() {
        assert_eq!(
            parse_tools("calculator, file_read, web_search"),
            vec!["calculator", "file_read", "web_search"]
        );
        assert_eq!(
            parse_tools(" calculator , calculator , file-read "),
            vec!["calculator"]
        );
    }

    #[test]
    fn agent_markdown_parses_strategy_key() {
        let agent = agent_from_markdown(
            "agents/orchestrator.md",
            "---\nid: orchestrator\nname: Orchestrator\nenabled: true\ntools: all\nstrategy: orchestrate\n---\n\nOrchestrate tasks.",
        )
        .unwrap();

        assert_eq!(agent.strategy_id, Some("orchestrate".to_string()));
    }

    #[test]
    fn agent_markdown_without_strategy_defaults_to_none() {
        let agent = agent_from_markdown(
            "agents/plain.md",
            "---\nid: plain\nname: Plain\nenabled: true\ntools: all\n---\n\nDo work.",
        )
        .unwrap();

        assert_eq!(agent.strategy_id, None);
    }

    #[test]
    fn agent_markdown_round_trips_strategy() {
        // Agent with a strategy_id survives a serialize → parse round-trip.
        let mut agent = Agent::new("Round Tripper", "Do the round trip.", default_tool_names());
        agent.strategy_id = Some("plan-act-review".to_string());

        let md = agent_to_markdown(&agent);
        assert!(md.contains("strategy: plan-act-review"));

        let path = format!("agents/{}.md", slugify(&agent.name));
        let parsed = agent_from_markdown(&path, &md).unwrap();
        assert_eq!(parsed.strategy_id, Some("plan-act-review".to_string()));

        // Agent with strategy_id == None round-trips to None, with no `strategy:` line.
        let mut agent_none = Agent::new("No Strategy", "Just work.", default_tool_names());
        agent_none.strategy_id = None;

        let md_none = agent_to_markdown(&agent_none);
        assert!(!md_none.contains("strategy:"));

        let path_none = format!("agents/{}.md", slugify(&agent_none.name));
        let parsed_none = agent_from_markdown(&path_none, &md_none).unwrap();
        assert_eq!(parsed_none.strategy_id, None);
    }
}
