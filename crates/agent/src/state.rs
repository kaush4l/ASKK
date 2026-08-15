//! AgentState — plain data (§11: snapshot/restore, pause-and-resume across
//! refreshes all depend on this being serializable, which async-fn futures
//! could never be — ARCHITECTURE §1c).

use serde::{Deserialize, Serialize};

use context::State;
use kernel::PhaseId;

use crate::defaults::{default_compact_at, default_keep_recent, default_max_rounds, default_passes};
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
/// because `Persist`ing this IS pause-and-resume (I11).
/// (No `Eq`: `temperature` is an `f64`, which has no total equality.)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentState {
    pub phase: PhaseId,
    /// This agent's `model:` frontmatter key — a MODEL CATALOGUE key, never a
    /// URL (increment 04). It rides out on `Effect::CallModel` so the adapter
    /// can resolve it; empty means "the catalogue's default entry".
    #[serde(default)]
    pub model: String,
    /// This agent's `temperature:` frontmatter key, or `None` where the file
    /// named none. Rides out on `Effect::CallModel` (increment 19): the key
    /// parsed, rendered back out and printed on the card for eighteen rounds
    /// while reaching no request body — the `compact_at: lots` failure
    /// (`spec::number`) in a key that looked applied.
    #[serde(default)]
    pub temperature: Option<f64>,
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
    #[serde(default)]
    pub pending_tools: usize,
    /// How many times this turn has already gone round the tool loop. A
    /// looping model terminates on this counter, never on prose.
    #[serde(default)]
    pub tool_rounds: u16,
    /// A sentence the person typed while this turn was already running, not
    /// yet answered. It is a FLAG and not a queue: the sentence itself is
    /// already in the history, and this only records that nothing has replied
    /// to it since. Cleared the moment a call is made carrying it.
    #[serde(default)]
    pub steered: bool,
    /// The person pressed Stop while this turn was running. A FLAG, like
    /// `steered`, and for the same reason: the press is a fact about the turn
    /// and not a queue of work. `stop::boundary` consumes it at the next step
    /// boundary; a new turn clears it.
    #[serde(default)]
    pub stopping: bool,
    /// The ceiling that counter terminates on, from this agent's `max_rounds:`
    /// frontmatter. It is per-agent because the right number is a property of
    /// the WORK: a summarizer that calls two tools and a coding agent that
    /// edits nine files, builds, reads the errors and edits again cannot share
    /// one constant, and the constant this replaced was four.
    #[serde(default = "default_max_rounds")]
    pub max_rounds: u16,
    /// What THIS agent may call: its `agent.md` `tools:` list resolved
    /// against the built-ins and its peers (`subagent::toolbox_for`). In
    /// state, not in the phase table, because it is the agent's property and
    /// not the machine's — the phase only decides whether this phase may act.
    #[serde(default)]
    pub toolbox: Toolbox,
    /// Compact once the window reaches this many entries; 0 never compacts
    /// (Python `Engine.compact_at`, default 75, overridable in frontmatter).
    #[serde(default = "default_compact_at")]
    pub compact_at: usize,
    /// How many of the newest entries survive a compaction verbatim (Python
    /// `Engine.keep_recent`, default 24).
    #[serde(default = "default_keep_recent")]
    pub keep_recent: usize,
    /// The reply now in flight is the SUMMARIZER's, not this agent's answer.
    /// A summary is an artifact compaction produces and assembly reads back —
    /// `assemble` is pure and cannot author one (I14, RESEARCH).
    #[serde(default)]
    pub compacting: bool,
    /// How many times this window has been compacted. The log mirrors the
    /// window, and this counter is what tells the mirror a REWRITE is due
    /// rather than another append.
    #[serde(default)]
    pub compactions: u32,
    /// The summarizer agent's own prompt and catalogue key, taken from the
    /// peer of that name at adoption. The Python registry hands the summarizer
    /// to every other engine as the thing that compacts a history rather than
    /// as a tool anyone calls — it is an ordinary agent, and this is its file.
    #[serde(default)]
    pub summarizer_prompt: String,
    #[serde(default)]
    pub summarizer_model: String,
    #[serde(default)]
    pub summarizer_temperature: Option<f64>,
    /// THIS TURN'S EVIDENCE (`crate::verify`). Two flags folded left-to-right
    /// over the turn's tool results, and `nudges` counting how many times the
    /// gate has already asked. All three are turn-scoped: cleared where
    /// `pending_tools` and `tool_rounds` are, and again when a turn ends.
    #[serde(default)]
    pub mutated: bool,
    #[serde(default)]
    pub green: bool,
    #[serde(default)]
    pub nudges: u8,
    /// The loop this agent's file declares (`crate::stages`), in order, and
    /// how far this turn has walked it. Empty is the react loop alone — which
    /// is every agent written before the key existed, and the reason nothing
    /// about the old single-stage turn changed.
    #[serde(default)]
    pub stages: Vec<String>,
    #[serde(default)]
    pub stage: usize,
    /// The `passes:` budget, the laps spent, and whether THIS lap changed or
    /// ran anything — the continue condition, mechanical and never the model's
    /// verdict (`crate::passes`). 1/0/false is today's turn exactly.
    #[serde(default = "default_passes")]
    pub passes: u16,
    #[serde(default)]
    pub pass: u16,
    #[serde(default)]
    pub acted: bool,
    /// THE SEPARATE REVIEWER (`crate::critic`, 25). `critic` names the agent
    /// holding `role: critic`, so its answer is recognised as a verdict rather
    /// than by a hardcoded name; `reviewed` is what that verdict said — `None`
    /// where it was never asked, or a write since made it stale.
    #[serde(default)] pub critic: String,
    #[serde(default)] pub reviewed: Option<bool>,
    /// The shared space this agent works in, as of the last time it was read
    /// — its facts and notes go into CONTEXT on every call. `None` means the
    /// agent's file named no space, so it works alone (Python: `space` is an
    /// optional frontmatter key).
    #[serde(default)]
    pub space: Option<crate::space::Space>,
    /// The paper's assembly inputs — gathered section sources, refreshed by
    /// `core` (affordances from the registry, observations from effects)
    /// before each step. Inside AgentState so one snapshot restores the
    /// whole thinking context.
    pub paper: State,
}

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
            summarizer_prompt: String::new(),
            summarizer_model: String::new(), summarizer_temperature: None,
            mutated: false, green: false, nudges: 0,
            stages: Vec::new(), stage: 0,
            passes: default_passes(), pass: 0, acted: false,
            critic: String::new(), reviewed: None,
            space: None,
            paper: crate::paper::seed(),
        }
    }
}

impl Default for AgentState {
    fn default() -> AgentState {
        AgentState::new()
    }
}
