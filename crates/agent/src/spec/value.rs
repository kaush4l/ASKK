//! WHAT ONE VALUE MUST BE — the refusal vocabulary, all of it, in one file.
//!
//! [`super::yaml`] answers a different question: what SHAPE is this block of
//! frontmatter in, which key does a `- item` line belong to, where does a list
//! open. This answers what a single value is allowed to say once that reader
//! has it in hand — one of a closed set, a list in either of its two forms, a
//! whole number, a float.
//!
//! ONE RULE RUNS THROUGH ALL OF IT: a value this cannot honour is REFUSED,
//! never defaulted. A setting that parses clean and selects nothing is worse
//! than no setting — that was `engine: reakt` for eighteen rounds, and
//! `compact_at: lots` silently becoming 75 is the same failure with a number.
//! Silence must never fail towards more capability either: a dropped `tools:`
//! line leaves the list empty, and empty means EVERY built-in.

use crate::error::AgentError;
use crate::spec::yaml::split_inline;
use crate::spec::AgentSpec;

/// One key whose legal values are a short closed list. REFUSED, NEVER
/// DEFAULTED — `compact_at: lots`'s rule (see [`number`]) applied to the two
/// keys that had been breaking it: `engine: reakt` parsed clean and selected
/// nothing for eighteen rounds, and a misspelt `role:` leaves the job unheld,
/// which is a running app with no entry agent at all.
pub(super) fn one_of(
    spec: &AgentSpec,
    key: &str,
    value: &str,
    legal: &[&str],
) -> Result<String, AgentError> {
    match legal.contains(&value) {
        true => Ok(value.into()),
        false => Err(malformed(
            spec,
            format!("{key} '{value}' is not one of: {}", legal.join(", ")),
        )),
    }
}

/// One of the three keys written as a list, in either of its two shapes:
/// `[a, b]` here, or a bare `key:` opening the `- name` block on the lines
/// below — which is what the returned name says is now open. An unknown
/// FACULTY name is not refused here; only an unreadable SHAPE is, because a
/// name that resolves to nothing is a capability question and this file only
/// judges what one line can be judged by (`crate::faculty::of`).
///
/// Anything else is REFUSED, exactly as `compact_at: lots` is (11b walk): a
/// dropped `tools:` line leaves the list empty, and empty means EVERY built-in.
/// Silence must never fail towards more capability.
pub(super) fn list_field(
    spec: &mut AgentSpec,
    key: &'static str,
    value: &str,
) -> Result<Option<&'static str>, AgentError> {
    let shape = match key {
        "stages" => "write stages: [plan, work, verify]",
        "faculties" => "write faculties: [space], or a bare 'faculties:' with '- name' \
                        lines under it",
        _ => "write tools: [a, b], or a bare 'tools:' with '- name' lines under it, or \
              tools: [] for all of them",
    };
    let items = match value.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
        Some(inline) => split_inline(inline),
        None if value.is_empty() => return Ok(Some(key)),
        None => {
            return Err(malformed(
                spec,
                format!("{key} '{value}' is not a list — {shape}"),
            ))
        }
    };
    match key {
        "stages" => spec.stages = items,
        "faculties" => spec.faculties = items,
        _ => spec.tools = items,
    }
    Ok(None)
}

/// One frontmatter line this file cannot honour, as the typed error.
pub(super) fn malformed(spec: &AgentSpec, message: String) -> AgentError {
    let agent = spec.name.clone();
    AgentError::MalformedAgentFile { agent, message }
}

/// One key whose value is a number, onto the field it names.
pub(super) fn number_field(spec: &mut AgentSpec, key: &str, value: &str) -> Result<(), AgentError> {
    match key {
        "compact_at" => spec.compact_at = whole(spec, key, value)?,
        "keep_recent" => spec.keep_recent = whole(spec, key, value)?,
        "max_rounds" => spec.max_rounds = whole(spec, key, value)? as u16,
        "passes" => spec.passes = whole(spec, key, value)? as u16,
        _ => {
            spec.temperature = Some(value.parse::<f64>().map_err(|_| {
                malformed(spec, format!("temperature '{value}' is not a number"))
            })?)
        }
    }
    Ok(())
}

/// One non-negative frontmatter integer, refused rather than defaulted.
fn whole(spec: &AgentSpec, key: &str, value: &str) -> Result<usize, AgentError> {
    value
        .parse::<usize>()
        .map_err(|_| malformed(spec, format!("{key} '{value}' is not a whole number")))
}
