//! AN AGENT FILE, READ — `agent.md` → `AgentSpec`, and the four files that do
//! it. This one holds the RECORD and the rules that need the whole file in
//! hand; [`yaml`] reads one key at a time, [`defaults`] says what an absent key
//! means, and [`loader`] does the same for a folder full of files.
//!
//! The Python `core/utils.py::parse_agent_file` ported: YAML frontmatter for
//! metadata, the markdown body for the system prompt. Pure — the bytes arrive
//! from wherever the host got them (I3).
//!
//! The frontmatter subset is deliberate, not a YAML parser: `key: value`, a
//! block list under a bare `key:`, and the inline `[a, b]` form — every shape
//! the shipped agents use, without a YAML dependency. Unknown keys are ignored;
//! a key whose VALUE is a shape this cannot read is refused, never defaulted.

pub(crate) mod defaults;
pub(crate) mod loader;
pub(crate) mod yaml;

use serde::{Deserialize, Serialize};

use crate::error::AgentError;
use yaml::read_frontmatter;

/// THE TWO ENGINES, AND THERE ARE ONLY TWO (19). `react` is the tool loop
/// `step` walks; `base` is one reply with NO tools, which is what the agent
/// card has said it means all along and what `subagent::resolve` now enforces.
/// Any other value is REFUSED, on `number`'s rule below: `engine: reakt` parsed
/// clean and printed on the card while selecting nothing, and a setting that
/// looks applied is worse than no setting.
pub const ENGINE_REACT: &str = "react";
pub const ENGINE_BASE: &str = "base";

/// THE JOBS THE CORE USED TO HARDCODE (20). `main` and `summarizer` were two
/// string literals in `core::app` and `agent::paper`, so renaming the entry
/// agent's folder silently changed nothing and deleting the summarizer's
/// silently stopped compaction everywhere. A role is a DECLARATION now: the
/// file says which job it holds, and the core looks the holder up.
pub const ROLE_ENTRY: &str = "entry";
// `summarizer` was a role until compaction stopped needing an agent to do it
// (`window::SUMMARIZE`). It is gone from the vocabulary rather than left in it
// unread: a `role:` line the machine parses and never looks up is the exact
// "setting that looks applied" failure this file refuses everywhere else.
/// …and the third (25): the agent whose answer is a VERDICT on another agent's
/// work. A role rather than the name `critic`, for the reason above and for one
/// more — `crate::critic` has to recognise a tool result as a verdict, and
/// recognising it by a hardcoded name is what 20 was spent undoing.
pub const ROLE_CRITIC: &str = "critic";
pub const ROLES: [&str; 2] = [ROLE_ENTRY, ROLE_CRITIC];

/// One agent as its file declares it. The seven frontmatter keys of the Python
/// loader, `max_rounds` (15C, which the Python had no equivalent of), and the
/// body, which is the system prompt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentSpec {
    pub name: String,
    pub description: String,
    /// A key into the model catalogue (increment 04), never a URL.
    pub model: String,
    pub temperature: Option<f64>,
    pub engine: String,
    /// Which job in the app this agent holds — `entry`, `summarizer`, or
    /// empty for the ordinary case of holding none (`ROLE_ENTRY`).
    #[serde(default)]
    pub role: String,
    /// The loop this agent runs, in order (`crate::stages`). Empty is the
    /// react loop alone, which is every agent that came before the key.
    #[serde(default)]
    pub stages: Vec<String>,
    pub tools: Vec<String>,
    pub space: String,
    /// Compact once the history reaches this many entries; 0 never compacts
    /// (the shipped summarizer sets 0, so it never summarises itself).
    pub compact_at: usize,
    /// How many of the newest entries survive a compaction verbatim.
    pub keep_recent: usize,
    /// How many rounds of the tool loop one turn of this agent may take
    /// before the machine stops it (`defaults::default_max_rounds`).
    pub max_rounds: u16,
    /// How many times one turn may walk the `stages:` list (`crate::passes`).
    /// 1 is today's turn exactly; more is an agent that keeps working toward a
    /// goal without being asked again each time.
    #[serde(default = "crate::spec::defaults::default_passes")]
    pub passes: u16,
    /// The markdown body: this agent's system prompt.
    pub prompt: String,
}

/// Parse one agent file. `dir` is the folder the file came from — the agent's
/// name when the frontmatter gives none, as the Python loader defaults it.
/// Malformed frontmatter is an error, never a silently empty spec.
pub fn parse_agent_file(dir: &str, text: &str) -> Result<AgentSpec, AgentError> {
    let rest = text
        .strip_prefix("---")
        .ok_or_else(|| bad(dir, "missing YAML frontmatter (file must start with '---')"))?;
    let (frontmatter, body) = rest
        .split_once("\n---")
        .ok_or_else(|| bad(dir, "unterminated YAML frontmatter (no closing '---')"))?;
    let mut spec = unwritten(dir, body);
    read_frontmatter(frontmatter, &mut spec)?;
    if spec.name.is_empty() {
        return Err(bad(dir, "frontmatter 'name' is empty"));
    }
    refuse_contradictions(dir, &spec)?;
    Ok(spec)
}

/// One file this cannot read, as the typed error the UI shows.
fn bad(dir: &str, message: &str) -> AgentError {
    AgentError::MalformedAgentFile {
        agent: dir.to_string(),
        message: message.to_string(),
    }
}

/// The spec a file that declared nothing would produce: the folder for a name,
/// the body for a prompt, and [`defaults`] for every number.
fn unwritten(dir: &str, body: &str) -> AgentSpec {
    AgentSpec {
        name: dir.to_string(),
        description: String::new(),
        model: String::new(),
        temperature: None,
        // REACT, NOT `base` — the default has to be the loop that actually
        // runs. It read `base` while nothing branched on the key, and now that
        // `base` means "no tools at all", defaulting to it would disarm every
        // file that simply omits the line. Absence means the loop this build
        // has always run; `base` is a choice somebody writes.
        engine: ENGINE_REACT.into(),
        role: String::new(),
        stages: Vec::new(),
        tools: Vec::new(),
        space: String::new(),
        compact_at: defaults::default_compact_at(),
        keep_recent: defaults::default_keep_recent(),
        max_rounds: defaults::default_max_rounds(),
        passes: defaults::default_passes(),
        prompt: body.trim().to_string(),
    }
}

/// TWO KEYS THAT EACH PARSE AND TOGETHER MEAN NOTHING. Every rule here needs
/// the whole file in hand, which is why none of them lives in [`yaml`], and
/// every one of them is a refusal rather than a dropped line: the file is
/// asking for two incompatible things and only its author knows which it meant.
///
/// `engine: base` GRANTS NOTHING, so a `tools:` list under it would be a second
/// thing that looks applied and is not — and a `stages:` list under it is the
/// same mistake one key over, because `base` is ONE reply and a stage list is a
/// sequence of them.
///
/// A stage list with no `work` in it can never act, whatever its `tools:` line
/// says. The one exception is the whole strategy loop: `[strategy]` contains no
/// `work` because it does not know yet whether the turn needs one, and the vote
/// picks a list that does — so the guarantee this defends, that a turn can
/// always reach a stage that acts, still holds.
///
/// And `passes:` counts laps of that list, so with no list to lap it parses
/// clean and does nothing at all (`engine: reakt`'s rule, 19).
fn refuse_contradictions(dir: &str, spec: &AgentSpec) -> Result<(), AgentError> {
    let acts = |s: &String| s == crate::stages::WORK || s == crate::strategy::STRATEGY;
    if spec.engine == ENGINE_BASE && !spec.tools.is_empty() {
        return Err(bad(
            dir,
            "engine: base answers in one reply and calls no tools, so the tools: list \
             under it would never be granted — use engine: react, or drop the list",
        ));
    }
    if spec.engine == ENGINE_BASE && !spec.stages.is_empty() {
        return Err(bad(
            dir,
            "engine: base answers in one reply, so the stages: list under it would never \
             be walked — use engine: react, or drop the list",
        ));
    }
    if !spec.stages.is_empty() && !spec.stages.iter().any(acts) {
        return Err(bad(
            dir,
            "a stages: list must contain work — it is the stage that acts — or strategy, \
             which chooses a list that does",
        ));
    }
    if spec.passes > 1 && spec.stages.is_empty() {
        return Err(bad(
            dir,
            "passes: counts laps of the stages: list, so it needs one — add stages: \
             [plan, work, verify], or drop the passes: line",
        ));
    }
    Ok(())
}
