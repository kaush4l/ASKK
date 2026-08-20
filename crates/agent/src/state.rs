//! AgentState — plain data (§11: snapshot/restore, pause-and-resume across
//! refreshes all depend on this being serializable, which async-fn futures
//! could never be — ARCHITECTURE §1c).
//!
//! THIS FILE IS THE VOCABULARY: every field the agent has, with the argument
//! for why it exists beside it. [`opening`] holds the one particular VALUE of
//! that vocabulary a fresh agent starts as, in one piece, because "what is an
//! agent before anything has happened to it" is a question with its own answer
//! and reading the record should not mean reading past forty initialisers.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use context::{Part, State};
use kernel::PhaseId;

use crate::spec::defaults::{
    default_compact_at, default_keep_recent, default_max_rounds, default_passes,
};
use crate::toolbox::Toolbox;

/// One planned step with its own success criteria — Verify judges against
/// these, not vibes (ADR-010: "the judge reads the spec").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanStep {
    pub description: String,
    pub success_criteria: String,
}

/// The whole agent between events. Everything `step` may consult is a field
/// here; everything not here does not exist to the agent (I7). Serializable
/// because a state that can be written down is a state a refresh can resume
/// (I11) — today through the stored LOG (`core::log::decisions`).
/// (No `Eq`: `temperature` is an `f64`, which has no total equality.)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentState {
    pub phase: PhaseId,
    /// This agent's `model:` frontmatter key — a MODEL CATALOGUE key, never a
    /// URL (increment 04). It rides out on `Effect::CallModel` so the adapter
    /// can resolve it; empty means "the catalogue's default entry".
    #[serde(default)] pub model: String,
    /// This agent's `temperature:` frontmatter key, or `None` where the file
    /// named none. Rides out on `Effect::CallModel` (increment 19): the key
    /// parsed, rendered back out and printed on the card for eighteen rounds
    /// while reaching no request body — the `compact_at: lots` failure
    /// (`spec::number`) in a key that looked applied.
    #[serde(default)] pub temperature: Option<f64>,
    /// What is being attempted; `None` = idle, awaiting a task.
    pub task: Option<String>,
    /// The current plan; empty in Work-first flows (RESEARCH phase-cut:
    /// Plan-on-demand, not mandatory).
    pub plan: Vec<PlanStep>,
    /// Which plan step Work is on — the LOOP advances this, never the model
    /// (ADR-010: one step per call).
    pub cursor: usize,
    /// Consecutive-retry guard counter; a looping model terminates
    /// deterministically because these live here, not in prose (ADR-010).
    pub retries: u8,
    pub replans: u8,
    /// Tool results still outstanding from the batch the model just wrote.
    /// The model sees none of them until this reaches zero — that is what
    /// makes one line of calls one observation (Python `core/tools.py`).
    #[serde(default)] pub pending_tools: usize,
    /// How many times this turn has already gone round the tool loop. A
    /// looping model terminates on this counter, never on prose.
    #[serde(default)] pub tool_rounds: u16,
    /// A sentence the person typed while this turn was already running, not
    /// yet answered. It is a FLAG and not a queue: the sentence itself is
    /// already in the history, and this only records that nothing has replied
    /// to it since. Cleared the moment a call is made carrying it.
    #[serde(default)] pub steered: bool,
    /// The person pressed Stop while this turn was running. A FLAG, like
    /// `steered`, and for the same reason: the press is a fact about the turn
    /// and not a queue of work. `stop::boundary` consumes it at the next step
    /// boundary; a new turn clears it.
    #[serde(default)] pub stopping: bool,
    /// The ceiling that counter terminates on, from this agent's `max_rounds:`
    /// frontmatter. It is per-agent because the right number is a property of
    /// the WORK: a summarizer that calls two tools and a coding agent that
    /// edits nine files, builds, reads the errors and edits again cannot share
    /// one constant, and the constant this replaced was four.
    #[serde(default = "default_max_rounds")] pub max_rounds: u16,
    /// What THIS agent may call: its `agent.md` `tools:` list resolved
    /// against the built-ins and its peers (`subagent::toolbox_for`). In
    /// state, not in the phase table, because it is the agent's property and
    /// not the machine's — the phase only decides whether this phase may act.
    #[serde(default)] pub toolbox: Toolbox,
    /// Compact once the window reaches this many entries; 0 never compacts
    /// (Python `Engine.compact_at`, default 75, overridable in frontmatter).
    #[serde(default = "default_compact_at")] pub compact_at: usize,
    /// How many of the newest entries survive a compaction verbatim (Python
    /// `Engine.keep_recent`, default 24).
    #[serde(default = "default_keep_recent")] pub keep_recent: usize,
    /// The reply now in flight is the SUMMARIZER's, not this agent's answer.
    /// A summary is an artifact compaction produces and assembly reads back —
    /// `assemble` is pure and cannot author one (I14, RESEARCH).
    #[serde(default)] pub compacting: bool,
    /// How many times this window has been compacted. The log mirrors the
    /// window, and this counter is what tells the mirror a REWRITE is due
    /// rather than another append.
    #[serde(default)] pub compactions: u32,
    /// THIS TURN'S EVIDENCE (`crate::verify`). Two flags folded left-to-right
    /// over the turn's tool results, and `nudges` counting how many times the
    /// gate has already asked. All three are turn-scoped: cleared where
    /// `pending_tools` and `tool_rounds` are, and again when a turn ends.
    #[serde(default)] pub mutated: bool,
    #[serde(default)] pub green: bool,
    #[serde(default)] pub nudges: u8,
    /// The loop this agent's file declares (`crate::stages`), in order, and
    /// how far this turn has walked it. Empty is the react loop alone — which
    /// is every agent written before the key existed, and the reason nothing
    /// about the old single-stage turn changed.
    #[serde(default)] pub stages: Vec<String>,
    /// The list the agent's FILE declares, which `stages` is reset to at the
    /// start of every turn. The two are separate because the strategy stage
    /// REWRITES `stages` mid-turn: without a copy of the declaration, the
    /// second message of a conversation would inherit the route the first one
    /// chose, and a greeting after a project would still be planning.
    #[serde(default)] pub declared: Vec<String>,
    #[serde(default)] pub stage: usize,
    /// The `passes:` budget, the laps spent, and whether THIS lap changed or
    /// ran anything — the continue condition, mechanical and never the model's
    /// verdict (`crate::passes`). 1/0/false is today's turn exactly.
    #[serde(default = "default_passes")] pub passes: u16,
    #[serde(default)] pub pass: u16,
    #[serde(default)] pub acted: bool,
    /// THE SEPARATE REVIEWER (`crate::critic`, 25). `critic` names the agent
    /// holding `role: critic`, so its answer is recognised as a verdict rather
    /// than by a hardcoded name; `reviewed` is what that verdict said — `None`
    /// where it was never asked, or a write since made it stale.
    #[serde(default)] pub critic: String,
    #[serde(default)] pub reviewed: Option<bool>,
    /// THE STANDING GOAL (26) — what this agent's FILE declares it is for, and
    /// what the harness last observed about it. One field and not five because
    /// the three declared lines and the two observations are one mechanism;
    /// `crate::goal` holds it, and the default is an agent that declared none,
    /// which is every agent written before the key and the reason the continue
    /// condition of all of them is untouched.
    #[serde(default)] pub standing: crate::goal::Standing,
    /// The shared space this agent works in, as of the last time it was read
    /// — its facts and notes go into CONTEXT on every call. `None` means the
    /// agent's file named no space, so it works alone (Python: `space` is an
    /// optional frontmatter key).
    #[serde(default)] pub space: Option<crate::space::Space>,
    /// The faculties this agent's file declared (`crate::faculty`), in order.
    /// The host walks this list before every pass and writes fresh state into
    /// `senses` for each. Empty is an agent that senses nothing, which is
    /// every agent written before the key existed.
    #[serde(default)] pub faculties: Vec<String>,
    /// BLOCK ID -> the parts a host wrote for it, most recently. `space` one
    /// step generalised: the slot where an impure host leaves fresh data for a
    /// pure component (`components::Sensed`) to render. `Vec<Part>` and not
    /// `String` so a screenshot is representable without a second mechanism;
    /// `BTreeMap` and not `HashMap` so two identical agents assemble two
    /// identical papers (I7, I14).
    #[serde(default)] pub senses: BTreeMap<String, Vec<Part>>,
    /// WHAT EACH STAGE IS TOLD (`crate::brief`), loaded from `public/stages/`.
    /// Here and not in the spec because a brief is a property of the STAGE —
    /// whose meaning belongs to the machine — and not of the agent, whose own
    /// voice is already the `Soul` block.
    #[serde(default)] pub briefs: crate::brief::Briefs,
    /// The paper's assembly inputs — gathered section sources, refreshed by
    /// `core` (affordances from the registry, observations from effects)
    /// before each step. Inside AgentState so one snapshot restores the
    /// whole thinking context.
    pub paper: State,
}

mod opening;
