//! `agent.md` → `AgentSpec`. The Python `core/utils.py::parse_agent_file`
//! ported: YAML frontmatter for metadata, the markdown body for the system
//! prompt. Pure — the bytes arrive from wherever the host got them (in the
//! browser, a fetch of `public/agents/<name>/agent.md`), so this file tests
//! on the host with no network (I3).
//!
//! The frontmatter subset is deliberate, not a YAML parser: `key: value`,
//! a block list under a bare `key:`, and the inline `[a, b]` form. That is
//! every shape the shipped agents use, and a whole YAML dependency to read
//! seven keys would be the tail wagging the dog. Anything else in the file
//! is ignored the way Python forwards unknown keys it has no use for yet.

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
    /// (Python forwards any `Engine` field from the frontmatter, and the
    /// shipped summarizer sets `compact_at: 0` so it never summarises itself).
    pub compact_at: usize,
    /// How many of the newest entries survive a compaction verbatim.
    pub keep_recent: usize,
    /// The markdown body: this agent's system prompt.
    pub prompt: String,
}

/// Parse one agent file. `dir` is the folder the file came from — the
/// agent's name when the frontmatter does not give one, exactly as the
/// Python loader defaults `name` to the directory.
///
/// Malformed frontmatter is an error, never a silently empty spec: an agent
/// with no prompt would only surface later as a confusing bad model call.
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

/// Fill the spec from the frontmatter lines. Separate so `parse_agent_file`
/// stays inside the 40-line rule and this stays one loop.
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
        "name" => spec.name = value.into(),
        "description" => spec.description = value.into(),
        "model" => spec.model = value.into(),
        "engine" => spec.engine = value.into(),
        "space" => spec.space = value.into(),
        "compact_at" => spec.compact_at = number(spec, key, value)?,
        "keep_recent" => spec.keep_recent = number(spec, key, value)?,
        "temperature" => {
            spec.temperature = Some(value.parse::<f32>().map_err(|_| {
                AgentError::MalformedAgentFile {
                    agent: spec.name.clone(),
                    message: format!("temperature '{value}' is not a number"),
                }
            })?)
        }
        // Inline form here; the block form arrives on the following lines.
        "tools" => match value.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
            Some(inline) => spec.tools = split_inline(inline),
            None => return Ok(value.is_empty()),
        },
        _ => {}
    }
    Ok(false)
}

/// One non-negative frontmatter integer, refused rather than defaulted: a
/// `compact_at: lots` that silently became 75 would be a setting that looks
/// applied and is not.
fn number(spec: &AgentSpec, key: &str, value: &str) -> Result<usize, AgentError> {
    value.parse::<usize>().map_err(|_| AgentError::MalformedAgentFile {
        agent: spec.name.clone(),
        message: format!("{key} '{value}' is not a whole number"),
    })
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
    inline
        .split(',')
        .map(unquote)
        .filter(|s| !s.is_empty())
        .collect()
}

/// Every agent, from files given built-ins FIRST and the project's second —
/// so a project agent of the same name REPLACES the built-in rather than
/// running beside it (Python `registry._agent_dirs`). A file that will not
/// parse costs that one agent and nothing else: the rest still load, and the
/// app still boots. Result order is by name, so the UI is deterministic.
///
/// Skipping is correct; SILENCE is not (`ux-walker`, increment 03). The second
/// return is one sentence per file that could not be read, for the UI to show
/// — a page that quietly runs with fewer agents than its manifest names is a
/// page lying about what is loaded.
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
