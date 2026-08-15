//! SKILLS — instruction the model pulls in when it needs it, and not before.
//!
//! A skill is a named piece of reusable instruction: frontmatter that says what
//! it is FOR, and a body that is the instruction itself. It is data in the same
//! shape an agent is data (`public/skills/<name>/skill.md`, listed in
//! `public/skills/index.json`, because a static host cannot list a directory).
//! The point is context economy — the description is cheap and always visible
//! through `list_skills`, and the body costs nothing until `read_skill` puts it
//! in the window. `crates/context` exists because that window is scarce.
//!
//! A SKILL RUNS NOTHING. Both tools are total pure functions of compiled-in
//! text: no capability, no port, no I/O, nothing a skill's author could make
//! happen. That is why the result is produced here, beside the refusals in
//! `subagent::invoke_or_refuse`, rather than in `core`'s executor table — that
//! table is where a tool ACTS, and this one does not. It is still a fact in the
//! log like any other call (`EventKind::ToolInvoked`), so the trace shows which
//! skill entered the context and when (I8).
//!
//! WHY COMPILED IN, TODAY. The manifest is real and the tree is real; the
//! fetch is not wired, because `assets::fetch_agents` and the boot path that
//! installs its files live outside this increment. The include list below is
//! the one place that changes when it is.

use kernel::{EventKind, ToolId};

use crate::effect::Effect;
use crate::error::AgentError;
use crate::yaml::unquote;

/// The two tools. Named for the pair they stand beside — `list_agents` and
/// `read_agent` — because a tool the model has to learn a second convention for
/// is a tool it calls wrongly.
pub const LIST_SKILLS: &str = "list_skills";
pub const READ_SKILL: &str = "read_skill";

/// I15, in the words the tool says when there is nothing to say. Never an empty
/// list dressed as a result.
pub const NONE_INSTALLED: &str = "No skills are installed in this browser.";

/// The skills this build ships. A folder here and a name in
/// `public/skills/index.json`; `crates/agent/tests/skills.rs` holds the two to
/// each other.
const INSTALLED: &[(&str, &str)] = &[
    (
        "agent-file",
        include_str!("../../../public/skills/agent-file/skill.md"),
    ),
    (
        "tool-calls",
        include_str!("../../../public/skills/tool-calls/skill.md"),
    ),
];

/// The two descriptors, declared beside the rules they obey — `space_tools`
/// and `workspace_tools` are the same shape. Both say plainly that they run
/// nothing, because a model that thinks `read_skill` might act will not spend a
/// round on it.
pub fn tools() -> Vec<crate::tools::Tool> {
    vec![
        crate::tools::Tool::new(
            LIST_SKILLS,
            "The skills installed in this browser: each one's name and what it is for. A skill \
             is written instruction you can pull in when a job calls for it. Listing is cheap, \
             so check it before a job you might have house rules for.",
            &[],
        ),
        crate::tools::Tool::new(
            READ_SKILL,
            "Read one skill's instruction into this conversation by name, then follow it for \
             the rest of the turn. It runs nothing and changes nothing — the result is text. \
             The names come from list_skills.",
            &["name"],
        ),
    ]
}

/// One skill as its file declares it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Skill {
    pub name: String,
    pub description: String,
    /// The markdown body: the instruction itself.
    pub body: String,
}

/// Every installed skill, in manifest order. A file that will not parse costs
/// that one skill and never the rest — the `load_agents` rule; the test above
/// is what keeps the shipped ones from being the casualty.
pub fn skills() -> Vec<Skill> {
    INSTALLED
        .iter()
        .filter_map(|(dir, text)| parse_skill_file(dir, text).ok())
        .collect()
}

/// `skill.md` → `Skill`, on `parse_agent_file`'s rules: frontmatter between
/// `---` lines, body after. A missing `description` is REFUSED, not defaulted:
/// the description is the whole basis on which a model decides to load a skill,
/// and one that cannot say what it is for cannot be chosen deliberately.
pub fn parse_skill_file(dir: &str, text: &str) -> Result<Skill, AgentError> {
    let bad = |m: &str| AgentError::MalformedSkillFile {
        skill: dir.to_string(),
        message: m.to_string(),
    };
    let rest = text
        .strip_prefix("---")
        .ok_or_else(|| bad("missing YAML frontmatter (file must start with '---')"))?;
    let (frontmatter, body) = rest
        .split_once("\n---")
        .ok_or_else(|| bad("unterminated YAML frontmatter (no closing '---')"))?;
    let mut skill = Skill {
        name: dir.to_string(),
        description: String::new(),
        body: body.trim().to_string(),
    };
    for line in frontmatter.lines() {
        match line.trim().split_once(':') {
            Some(("name", v)) if !unquote(v).is_empty() => skill.name = unquote(v),
            Some(("description", v)) => skill.description = unquote(v),
            _ => {}
        }
    }
    if skill.description.is_empty() {
        return Err(bad("frontmatter 'description' is missing or empty"));
    }
    if skill.body.is_empty() {
        return Err(bad("the body is empty, so there is no instruction to load"));
    }
    Ok(skill)
}

/// The catalogue: one line per skill, cheap enough to hold always. Public
/// because I15's empty case is the one this file must be tested on, and the
/// compiled-in list is never empty.
pub fn catalogue(skills: &[Skill]) -> String {
    if skills.is_empty() {
        return NONE_INSTALLED.into();
    }
    let lines: Vec<String> = skills
        .iter()
        .map(|s| format!("{}: {}", s.name, s.description))
        .collect();
    format!(
        "INSTALLED SKILLS\n\n{}\n\nRead one with {READ_SKILL}({{\"name\": \"<skill>\"}}) when \
         it applies to what you are doing, then follow it.",
        lines.join("\n")
    )
}

/// One skill's instruction. A name that is not installed is a REFUSAL that
/// names it and lists what is here — `read_agent`'s discipline, and the reason
/// deleting a skill cannot break the agent that asks for it: the turn carries
/// on with a result it can read.
pub fn instruction(skills: &[Skill], args_json: &str) -> Result<String, String> {
    let asked = serde_json::from_str::<serde_json::Value>(args_json)
        .ok()
        .and_then(|v| v.get("name")?.as_str().map(str::to_string))
        .unwrap_or_default();
    let asked = asked.trim();
    if asked.is_empty() {
        return Err(format!(
            "no skill named. Call it as {READ_SKILL}({{\"name\": \"<skill>\"}})"
        ));
    }
    match skills.iter().find(|s| s.name == asked) {
        Some(s) => Ok(format!("SKILL {} — {}\n\n{}", s.name, s.description, s.body)),
        None if skills.is_empty() => Err(format!("No skill called '{asked}'. {NONE_INSTALLED}")),
        None => Err(format!(
            "No skill called '{asked}'. Installed: {}",
            skills
                .iter()
                .map(|s| s.name.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )),
    }
}

/// The call answered, or `None` if this is not a skill tool. The fact carries
/// the same shape every tool's does, so the transcript and the trace show the
/// load exactly as they show a call that ran (I8).
pub(crate) fn effect(tool: &str, args_json: &str) -> Option<Effect> {
    let (ok, output) = match tool {
        LIST_SKILLS => (true, catalogue(&skills())),
        READ_SKILL => match instruction(&skills(), args_json) {
            Ok(body) => (true, body),
            Err(refusal) => (false, refusal),
        },
        _ => return None,
    };
    Some(Effect::Emit {
        kind: EventKind::ToolInvoked {
            tool: ToolId(tool.into()),
            args: args_json.into(),
            ok,
            output,
        },
    })
}
