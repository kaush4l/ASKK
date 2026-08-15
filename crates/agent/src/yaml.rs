//! THE FRONTMATTER READER — every `key: value` an agent file may carry, and
//! what each one refuses. Lifted out of `spec.rs`, which owns the record and
//! the whole-file rules, so both hold the 200-line rule (I12).
//!
//! ONE RULE RUNS THROUGH ALL OF IT: a value this cannot honour is REFUSED,
//! never defaulted. A setting that parses clean and selects nothing is worse
//! than no setting — that was `engine: reakt` for eighteen rounds.

use crate::error::AgentError;
use crate::spec::{AgentSpec, ENGINE_BASE, ENGINE_REACT, ROLES};

/// One frontmatter value with its optional quoting removed. Quotes are a YAML
/// nicety and never part of the value; `name: "shopper"` and `name: shopper`
/// are the same agent.
pub(crate) fn unquote(value: &str) -> String {
    let v = value.trim();
    for q in ['"', '\''] {
        if let Some(inner) = v.strip_prefix(q).and_then(|s| s.strip_suffix(q)) {
            return inner.to_string();
        }
    }
    v.to_string()
}

/// The inside of an inline `[a, b]` list. Empty items are dropped, so a
/// trailing comma costs nothing; an empty LIST is still meaningful and stays
/// empty (`tools: []` is every built-in, `stages: []` is no stage machine).
pub(crate) fn split_inline(inline: &str) -> Vec<String> {
    inline.split(',').map(unquote).filter(|s| !s.is_empty()).collect()
}

/// Fill the spec from the frontmatter lines — separate so `parse_agent_file`
/// stays inside the 40-line rule (I12) and this stays one loop.
pub(crate) fn read_frontmatter(frontmatter: &str, spec: &mut AgentSpec) -> Result<(), AgentError> {
    let mut list: Option<&'static str> = None;
    for line in frontmatter.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(item) = trimmed.strip_prefix("- ") {
            match list {
                Some("stages") => spec.stages.push(unquote(item)),
                Some(_) => spec.tools.push(unquote(item)),
                None => {}
            }
            continue;
        }
        list = match trimmed.split_once(':') {
            Some((key, value)) => set_field(spec, key.trim(), &unquote(value.trim()))?,
            None => None,
        };
    }
    // Every stage name, from either form, checked in one place — `engine`'s
    // rule (19) for the key that now decides the whole loop.
    if let Some(bad) = spec.stages.iter().find(|s| !crate::stages::is_stage(s)) {
        let known = crate::stages::STAGES.join(", ");
        return Err(malformed(spec, format!("stage '{bad}' is not one of: {known}")));
    }
    Ok(())
}

/// One `key: value` pair onto the spec. Returns which key's block list the
/// following lines belong to, when the value opened one.
fn set_field(spec: &mut AgentSpec, key: &str, value: &str) -> Result<Option<&'static str>, AgentError> {
    match key {
        // An EMPTY `name:` falls back to the folder, exactly as an absent one
        // does — the editor's "Folder name" field IS that folder (11b walk).
        "name" if !value.is_empty() => spec.name = value.into(),
        "name" => {}
        "description" => spec.description = value.into(),
        "model" => spec.model = value.into(),
        // REFUSED, NEVER DEFAULTED — `compact_at: lots`'s rule (see `number`)
        // applied to the key that had been breaking it.
        "engine" => match value {
            ENGINE_REACT | ENGINE_BASE => spec.engine = value.into(),
            _ => {
                return Err(malformed(
                    spec,
                    format!("engine '{value}' is not one of: {ENGINE_REACT}, {ENGINE_BASE}"),
                ))
            }
        },
        // …and the same refusal for the key that says which job this agent
        // holds: a misspelt role leaves the job unheld, which is a running app
        // with no entry agent at all.
        "role" => match value {
            "" => {}
            v if ROLES.contains(&v) => spec.role = v.into(),
            _ => {
                let known = ROLES.join(", ");
                return Err(malformed(spec, format!("role '{value}' is not one of: {known}")));
            }
        },
        // Inline here, block form on the lines below — `tools:`'s two shapes.
        "stages" => match value.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
            Some(inline) => spec.stages = split_inline(inline),
            None if value.is_empty() => return Ok(Some("stages")),
            None => {
                return Err(malformed(
                    spec,
                    format!("stages '{value}' is not a list — write stages: [plan, work, verify]"),
                ))
            }
        },
        "space" => spec.space = value.into(),
        "compact_at" => spec.compact_at = number(spec, key, value)?,
        "keep_recent" => spec.keep_recent = number(spec, key, value)?,
        "max_rounds" => spec.max_rounds = number(spec, key, value)? as u16,
        "passes" => spec.passes = number(spec, key, value)? as u16,
        "temperature" => {
            spec.temperature = Some(value.parse::<f64>().map_err(|_| {
                malformed(spec, format!("temperature '{value}' is not a number"))
            })?)
        }
        // Inline form here; the block form arrives on the following lines.
        "tools" => match value.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
            Some(inline) => spec.tools = split_inline(inline),
            // A bare `tools:` opens the block list. Anything else is REFUSED,
            // exactly as `compact_at: lots` is (11b walk): a dropped tools line
            // leaves the list empty, and empty means EVERY built-in. Silence
            // must never fail towards more capability.
            None if value.is_empty() => return Ok(Some("tools")),
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
    Ok(None)
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
