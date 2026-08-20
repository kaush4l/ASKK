//! THE SHAPE OF THE BLOCK — which key each frontmatter line belongs to, and
//! which key a bare `- item` under one of them belongs to. Three jobs, three
//! files: this reads the block, [`super::value`] judges one value, and the
//! parent module holds the rules that need the whole file in hand.
//!
//! The subset is deliberate and is not a YAML parser: `key: value`, a block
//! list under a bare `key:`, and the inline `[a, b]` form. `goal.outcome:` and
//! its two siblings are DOTTED rather than nested for exactly that reason —
//! three more `key: value` lines, and no indentation to understand.
//!
//! A KEY NOTHING READS IS A SETTING THAT LOOKS APPLIED, so an unknown key is
//! refused here rather than dropped, and [`KEYS`] is what the refusal prints.
//! `tests/frontmatter.rs` walks that list through `set_field` and asserts each
//! name is actually accepted: the list and the arms are two places, and
//! `faculty::mod` documents what this codebase already paid for the last time
//! a `match` and a `pub const` drifted apart with every gate still green.

use crate::error::AgentError;
use crate::spec::value::{self, malformed};
use crate::spec::{AgentSpec, ENGINE_BASE, ENGINE_REACT, ROLES};

/// EVERY KEY AN AGENT FILE MAY CARRY, for the refusal below to print.
const KEYS: [&str; 14] = [
    "name", "description", "model", "space", "engine", "role", "stages", "tools", "faculties",
    "compact_at", "keep_recent", "max_rounds", "passes", "temperature",
];

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

/// Fill the spec from the frontmatter lines. One loop over the block, and the
/// only place that knows a `- item` line belongs to whichever key opened a
/// list above it.
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
                Some("faculties") => spec.faculties.push(unquote(item)),
                Some("tools") => spec.tools.push(unquote(item)),
                // A `- item` under no open list. NOT a fall-through to
                // `tools:`, which is what the catch-all used to be: with a
                // third list key that would silently feed the toolbox, and
                // silence must never fail towards more capability.
                _ => {}
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
        "space" => spec.space = value.into(),
        "engine" => spec.engine = value::one_of(spec, key, value, &[ENGINE_REACT, ENGINE_BASE])?,
        // An empty `role:` is a file that holds no job, which is the ordinary
        // case and not a misspelling — so it is the one blank this accepts.
        "role" if value.is_empty() => {}
        "role" => spec.role = value::one_of(spec, key, value, &ROLES)?,
        // Named one at a time so the `&'static str` a block list is keyed by
        // comes from HERE and not from the borrowed line.
        "stages" => return value::list_field(spec, "stages", value),
        "tools" => return value::list_field(spec, "tools", value),
        "faculties" => return value::list_field(spec, "faculties", value),
        "compact_at" | "keep_recent" | "max_rounds" | "passes" | "temperature" => {
            value::number_field(spec, key, value)?
        }
        // THE STANDING GOAL'S THREE (26), claimed by the file that also holds
        // its whole-file refusals — one feature, one vocabulary, one place.
        k if crate::goal::declare::field(spec, k, value) => {}
        // A KEY NOTHING READS IS A SETTING THAT LOOKS APPLIED. This used to be
        // `_ => {}`: a misspelt `temprature:` or a `stage:` that meant `stages:`
        // parsed clean, changed nothing, and stayed in the file being believed
        // — `engine: reakt` again, one level up. Every other value this reader
        // cannot honour is refused (`one_of`, `number`, `list_field`), so the
        // KEY is refused too. Blank lines and `#` comments never reach here.
        _ => return Err(malformed(spec, format!("no agent file key is called '{key}' — \
            the keys are: {}, {}", KEYS.join(", "), crate::goal::declare::KEYS.join(", ")))),
    }
    Ok(None)
}
