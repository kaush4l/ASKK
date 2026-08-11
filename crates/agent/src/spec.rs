//! `agent.md` → `AgentSpec`. The Python `core/utils.py::parse_agent_file`
//! ported: YAML frontmatter for metadata, the markdown body for the system
//! prompt. Pure — the bytes arrive from wherever the host got them, so this
//! file tests on the host with no network (I3).
//!
//! The frontmatter subset is deliberate, not a YAML parser: `key: value`, a
//! block list under a bare `key:`, and the inline `[a, b]` form — every shape
//! the shipped agents use, without a YAML dependency to read seven keys.
//! Unknown keys are ignored; a key whose VALUE is a shape this cannot read is
//! refused, never defaulted.

use serde::{Deserialize, Serialize};

use crate::error::AgentError;

/// One agent as its file declares it. The seven frontmatter keys of the
/// Python loader plus the body, which is the system prompt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentSpec {
    pub name: String,
    pub description: String,
    /// A key into the model catalogue (increment 04), never a URL.
    pub model: String,
    pub temperature: Option<f32>,
    pub engine: String,
    pub tools: Vec<String>,
    pub space: String,
    /// Compact once the history reaches this many entries; 0 never compacts
    /// (the shipped summarizer sets 0, so it never summarises itself).
    pub compact_at: usize,
    /// How many of the newest entries survive a compaction verbatim.
    pub keep_recent: usize,
    /// The markdown body: this agent's system prompt.
    pub prompt: String,
}

/// Parse one agent file. `dir` is the folder the file came from — the agent's
/// name when the frontmatter gives none, as the Python loader defaults it.
/// Malformed frontmatter is an error, never a silently empty spec.
pub fn parse_agent_file(dir: &str, text: &str) -> Result<AgentSpec, AgentError> {
    let bad = |m: &str| AgentError::MalformedAgentFile {
        agent: dir.to_string(),
        message: m.to_string(),
    };
    let rest = text
        .strip_prefix("---")
        .ok_or_else(|| bad("missing YAML frontmatter (file must start with '---')"))?;
    let (frontmatter, body) = rest
        .split_once("\n---")
        .ok_or_else(|| bad("unterminated YAML frontmatter (no closing '---')"))?;

    let mut spec = AgentSpec {
        name: dir.to_string(),
        description: String::new(),
        model: String::new(),
        temperature: None,
        // The Python default when frontmatter names no engine.
        engine: "base".into(),
        tools: Vec::new(),
        space: String::new(),
        compact_at: crate::state::default_compact_at(),
        keep_recent: crate::state::default_keep_recent(),
        prompt: body.trim().to_string(),
    };
    read_frontmatter(frontmatter, &mut spec)?;
    if spec.name.is_empty() {
        return Err(bad("frontmatter 'name' is empty"));
    }
    Ok(spec)
}

/// Fill the spec from the frontmatter lines — separate so `parse_agent_file`
/// stays inside the 40-line rule (I12) and this stays one loop.
fn read_frontmatter(frontmatter: &str, spec: &mut AgentSpec) -> Result<(), AgentError> {
    let mut in_tools = false;
    for line in frontmatter.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(item) = trimmed.strip_prefix("- ") {
            if in_tools {
                spec.tools.push(unquote(item));
            }
            continue;
        }
        in_tools = match trimmed.split_once(':') {
            Some((key, value)) => set_field(spec, key.trim(), &unquote(value.trim()))?,
            None => false,
        };
    }
    Ok(())
}

/// One `key: value` pair onto the spec. Returns whether the following lines
/// are this key's block list (only `tools:` has one).
fn set_field(spec: &mut AgentSpec, key: &str, value: &str) -> Result<bool, AgentError> {
    match key {
        // An EMPTY `name:` falls back to the folder, exactly as an absent one
        // does — the editor's "Folder name" field IS that folder (11b walk).
        "name" if !value.is_empty() => spec.name = value.into(),
        "name" => {}
        "description" => spec.description = value.into(),
        "model" => spec.model = value.into(),
        "engine" => spec.engine = value.into(),
        "space" => spec.space = value.into(),
        "compact_at" => spec.compact_at = number(spec, key, value)?,
        "keep_recent" => spec.keep_recent = number(spec, key, value)?,
        "temperature" => {
            spec.temperature = Some(value.parse::<f32>().map_err(|_| {
                malformed(spec, format!("temperature '{value}' is not a number"))
            })?)
        }
        // Inline form here; the block form arrives on the following lines.
        "tools" => match value.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
            Some(inline) => spec.tools = split_inline(inline),
            // A bare `tools:` opens the block list. Anything else is REFUSED,
            // exactly as `compact_at: lots` is (11b walk): a dropped tools line
            // leaves the list empty, and empty means EVERY built-in, including
            // `write_agent`. Silence must never fail towards more capability.
            None if value.is_empty() => return Ok(true),
            None => {
                return Err(malformed(
                    spec,
                    format!(
                        "tools '{value}' is not a list — write tools: [a, b], or a bare \
                         'tools:' with '- name' lines under it, or tools: [] for all of them"
                    ),
                ))
            }
        },
        _ => {}
    }
    Ok(false)
}

/// One frontmatter line this file cannot honour, as the typed error.
fn malformed(spec: &AgentSpec, message: String) -> AgentError {
    let agent = spec.name.clone();
    AgentError::MalformedAgentFile { agent, message }
}

/// One non-negative frontmatter integer, refused rather than defaulted: a
/// `compact_at: lots` silently becoming 75 is a setting that looks applied.
fn number(spec: &AgentSpec, key: &str, value: &str) -> Result<usize, AgentError> {
    value
        .parse::<usize>()
        .map_err(|_| malformed(spec, format!("{key} '{value}' is not a whole number")))
}

fn unquote(value: &str) -> String {
    let v = value.trim();
    for q in ['"', '\''] {
        if let Some(inner) = v.strip_prefix(q).and_then(|s| s.strip_suffix(q)) {
            return inner.to_string();
        }
    }
    v.to_string()
}

fn split_inline(inline: &str) -> Vec<String> {
    inline.split(',').map(unquote).filter(|s| !s.is_empty()).collect()
}

/// Every agent, from files given built-ins FIRST and the project's second — so
/// a project agent of the same name REPLACES the built-in (Python
/// `registry._agent_dirs`). A file that will not parse costs that one agent:
/// the rest still load. Result order is by name, so the UI is deterministic.
///
/// Skipping is correct; SILENCE is not (`ux-walker`, increment 03). The second
/// return is one sentence per unreadable file, for the UI to show.
pub fn load_agents<I>(files: I) -> (Vec<AgentSpec>, Vec<String>)
where
    I: IntoIterator<Item = (String, String)>,
{
    let mut found: Vec<AgentSpec> = Vec::new();
    let mut problems: Vec<String> = Vec::new();
    for (dir, text) in files {
        let spec = match parse_agent_file(&dir, &text) {
            Ok(spec) => spec,
            Err(AgentError::MalformedAgentFile { message, .. }) => {
                problems.push(format!("{dir}/agent.md could not be read: {message}"));
                continue;
            }
            Err(other) => {
                problems.push(format!("{dir}/agent.md could not be read: {other:?}"));
                continue;
            }
        };
        match found.iter().position(|s| s.name == spec.name) {
            Some(i) => found[i] = spec,
            None => found.push(spec),
        }
    }
    found.sort_by(|a, b| a.name.cmp(&b.name));
    (found, problems)
}
