//! WHAT A FRESH AGENT IS — [`AgentState::new`], whole, in one piece.
//!
//! It is the file's index in the sense that reading it top to bottom is the
//! fastest way to learn what an agent HAS; it is here rather than under the
//! record because it is the one thing in the pair that is not a declaration.
//! Nothing else may construct an `AgentState` from parts: the boot and every
//! test start here, so "what an absent host has left behind" is written once.

use std::collections::BTreeMap;

use kernel::PhaseId;

use crate::spec::defaults::{
    default_compact_at, default_keep_recent, default_max_rounds, default_passes,
};
use crate::state::AgentState;
use crate::toolbox::Toolbox;

impl AgentState {
    /// A fresh idle agent — the boot and the tests start here. Work is the
    /// resting phase (Plan-on-demand, RESEARCH phase-cut); the paper is the
    /// seeded §8.2 starter set.
    pub fn new() -> AgentState {
        AgentState {
            phase: PhaseId::Work,
            model: String::new(),
            temperature: None,
            task: None,
            plan: Vec::new(),
            cursor: 0,
            retries: 0,
            replans: 0,
            pending_tools: 0,
            tool_rounds: 0,
            // No agent file adopted yet: an agent with no spec has no tools,
            // which is the honest default (nothing is attached that an agent
            // did not ask for).
            toolbox: Toolbox::default(),
            steered: false, stopping: false,
            max_rounds: default_max_rounds(),
            compact_at: default_compact_at(), keep_recent: default_keep_recent(),
            compacting: false, compactions: 0,
            mutated: false, green: false, nudges: 0,
            stages: Vec::new(), declared: Vec::new(), stage: 0,
            passes: default_passes(), pass: 0, acted: false,
            critic: String::new(), reviewed: None,
            standing: crate::goal::Standing::default(),
            space: None,
            // Senses nothing until a faculty says otherwise, and remembers
            // nothing sensed: both are what "no host has written yet" is.
            faculties: Vec::new(), senses: BTreeMap::new(),
            // NO BRIEFS: seeding them here would be the compiled-in fallback.
            briefs: crate::brief::Briefs::default(),
            paper: crate::paper::seed(),
        }
    }
}

impl Default for AgentState {
    fn default() -> AgentState {
        AgentState::new()
    }
}
