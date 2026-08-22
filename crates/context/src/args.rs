//! ONE READER FOR THE JSON A MODEL WROTE. Every tool on the invoke path is
//! handed a string the model authored and has to get one field out of it. That
//! read was copied sixteen times across `core` and `agent` — `websearch.rs:41`,
//! `workspace/gate.rs:56`, `space/shared.rs:108`, `memory/host.rs:93`,
//! `tools.rs:170`, `agents/roster.rs:99`, `subagent.rs:109`, `skills.rs:155` —
//! and each copy re-decided, silently, what a missing key and a blank value
//! mean. Three of the next four increments each add a tool ARGUMENT; without
//! this they add a seventeenth and eighteenth copy.
//!
//! IT SPLITS IN TWO, AND THE SPLIT IS THE WHOLE POINT. The obvious design —
//! one reader that always trims — is a data-corruption bug, and it was caught
//! before it shipped: `workspace/gate.rs` writes files with
//! `port.write(root, &path, &arg("contents"))`, so a trimming reader silently
//! strips the trailing newline off EVERY FILE AN AGENT WRITES. So:
//!
//! - [`Args::name`] trims and refuses blank. For IDENTIFIERS — a path, a
//!   process name, an agent name, a fact's key — where surrounding space is a
//!   typo and a blank one is a call that cannot be run.
//! - [`Args::text`] is VERBATIM, byte for byte. For CONTENT — file contents, a
//!   note, a remembered value — where the bytes ARE the argument.
//!
//! Choosing wrong at a call site is corruption, which is why each site states
//! its choice in a comment rather than inheriting one.
//!
//! NOTHING HERE RAISES ON UNREADABLE JSON. Parsing is total: a body that is not
//! JSON, or is JSON but not an object, reads as an object with no keys, so a
//! garbled call is refused by the same words that refuse a missing argument
//! (`crates/core/src/tools.rs:116-118`). The refusals stay where they are —
//! written for the model, in the tool's own vocabulary — and this file only
//! decides what the model actually said.

use serde_json::Value;

/// Why one argument could not be read. One variant per real cause, because the
/// three want different words: a key the model never wrote needs the call
/// shape, a key it wrote as a number needs the type, and a key it wrote blank
/// needs to be told that blank is not a value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArgError {
    /// No such key — including every case where the body was not a readable
    /// JSON object at all, which for a caller is the same fact: the model did
    /// not say.
    Missing { key: String },
    /// The key is there and its value is not a string. `found` is the JSON type
    /// name, so a refusal can say what was written instead of what was needed.
    ///
    /// `null` lands HERE and not in [`ArgError::Missing`], deliberately: a key
    /// the model wrote is a key it meant, and reporting it absent would be a
    /// claim about the call that is not true.
    NotText { key: String, found: &'static str },
    /// [`Args::name`] only: a string that is nothing but whitespace. Never
    /// returned by [`Args::text`], for which two spaces are two spaces.
    Empty { key: String },
}

/// The arguments of one tool call, parsed once.
///
/// Owns its raw string as well as the parsed value because the call is recorded
/// verbatim in the `ToolInvoked` fact (`crates/core/src/faculty/run.rs:79`) and
/// a host that echoes what it was handed needs the same bytes back.
pub struct Args {
    raw: String,
    value: Value,
}

impl Args {
    /// Read a call's arguments. Total: see the module note on why unreadable
    /// JSON is an empty object here rather than an error.
    pub fn parse(args_json: &str) -> Args {
        Args {
            raw: args_json.to_string(),
            value: serde_json::from_str(args_json).unwrap_or(Value::Null),
        }
    }

    /// The bytes the model actually sent, for the record of the call.
    pub fn raw(&self) -> &str {
        &self.raw
    }

    /// One argument, VERBATIM. Use for content: what comes back is what was
    /// written, trailing newline and all.
    pub fn text(&self, key: &str) -> Result<&str, ArgError> {
        match self.value.get(key) {
            None => Err(ArgError::Missing { key: key.to_string() }),
            Some(Value::String(said)) => Ok(said),
            Some(other) => Err(ArgError::NotText {
                key: key.to_string(),
                found: kind(other),
            }),
        }
    }

    /// One argument as an IDENTIFIER: trimmed, and refused when nothing is left.
    ///
    /// The refusal is the point. A blank path or a blank process name is a call
    /// that cannot be run, and the sites here have always checked for it by
    /// hand (`crates/agent/src/skills.rs:159`); this makes the check part of
    /// asking rather than something each site remembers to do.
    pub fn name(&self, key: &str) -> Result<&str, ArgError> {
        let said = self.text(key)?.trim();
        match said.is_empty() {
            true => Err(ArgError::Empty { key: key.to_string() }),
            false => Ok(said),
        }
    }

    /// The first non-blank string value under ANY key, trimmed.
    ///
    /// For the one call that has to accept a key it did not name: a sub-agent
    /// tool carries exactly one argument, its goal, and a model writing
    /// `{"task": ...}` instead of `{"query": ...}` meant the same thing
    /// (`crates/agent/src/subagent.rs:96-101`). Dropping it would start the
    /// sub-agent on nothing, which is the failure that machinery exists to
    /// prevent. Key order is the map's, which is sorted — the same order the
    /// hand-rolled `object.values()` walked.
    pub fn first_name(&self) -> Option<&str> {
        self.value
            .as_object()?
            .values()
            .filter_map(Value::as_str)
            .map(str::trim)
            .find(|said| !said.is_empty())
    }
}

/// The JSON type name, for [`ArgError::NotText`].
fn kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}
