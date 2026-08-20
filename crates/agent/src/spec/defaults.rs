//! WHAT AN ABSENT KEY MEANS — the four numbers an agent file may override, in
//! one audited place, so "what happens when the line is missing?" is one file
//! to read rather than four scattered literals. They are functions and not
//! consts because these are the paths `#[serde(default = …)]` names, on
//! `AgentSpec` and on the state restored from a log alike.
//!
//! …AND, AT THE BOTTOM, THE WHOLE SPEC THAT ANSWER ADDS UP TO. `unwritten` is
//! the file that declared nothing: the folder for a name, the body for a
//! prompt, and one of these for every number. It sits here rather than in
//! `spec::mod` because that file is about what a DECLARATION means and this
//! one is about what SILENCE means, and `unwritten` is silence, all of it at
//! once. `parse_agent_file` starts from it and every reader writes over it.

use crate::spec::{AgentSpec, ENGINE_REACT};

/// How far a turn may go before the machine stops it. Sixty-four, not four:
/// four rounds cannot finish any real task — read a file, run a build, read
/// the errors, edit, build again is already five — and the number exists to
/// stop a MODEL LOOPING, not to stop an agent working. It is still a hard
/// deterministic wall, and every agent may set its own.
pub(crate) fn default_max_rounds() -> u16 {
    64
}

/// Python `Engine.compact_at` / `keep_recent` defaults.
pub(crate) fn default_compact_at() -> usize {
    75
}

pub(crate) fn default_keep_recent() -> usize {
    24
}

/// How many times one turn may walk the declared stage list (`crate::passes`).
/// ONE, and one is not a placeholder: one pass is byte-for-byte the turn this
/// build has always taken, which is the same compatibility rule `stages:` ships
/// with. A file that wants the loop asks for it, and `main` deliberately does
/// not — a greeting must not cost five passes.
pub(crate) fn default_passes() -> u16 {
    1
}

/// The spec a file that declared nothing would produce: the folder for a name,
/// the body for a prompt, and [`defaults`] for every number.
pub(crate) fn unwritten(dir: &str, body: &str) -> AgentSpec {
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
        faculties: Vec::new(),
        space: String::new(),
        // NO GOAL: an agent that declared none stops its turn on exactly what it
        // always stopped on (`crate::goal`).
        goal: crate::goal::Goal::default(),
        compact_at: default_compact_at(),
        keep_recent: default_keep_recent(),
        max_rounds: default_max_rounds(),
        passes: default_passes(),
        prompt: body.trim().to_string(),
    }
}
