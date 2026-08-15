//! Typed agent errors (PROMPT §13). These are the machine's own failure
//! vocabulary — what `step` records and acts on when a model misbehaves;
//! none of them escape as prose.

use serde::{Deserialize, Serialize};

use kernel::PhaseId;

/// What the phase machine can reject. Each variant maps to a deterministic
/// handling rule in `step` (repair-retry, replan, or fail the task), which
/// is how a looping model terminates (ADR-010).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AgentError {
    /// The reply did not parse against the phase's contract.
    MalformedReply { phase: PhaseId, message: String },
    /// The parsed reply matched no entry in the phase's exit table.
    IllegalTransition { phase: PhaseId, message: String },
    /// The consecutive-retry guard fired.
    RetriesExhausted { phase: PhaseId },
    /// The replan guard fired — the task fails rather than loops.
    ReplansExhausted,
    /// An event arrived that no rule in the current phase consumes.
    UnexpectedEvent { phase: PhaseId, message: String },
    /// An `agent.md` could not be read. Costs that agent, never the boot.
    MalformedAgentFile { agent: String, message: String },
    /// A `skill.md` could not be read. Costs that skill and nothing else — the
    /// other skills still list, and an agent that asks for this one gets the
    /// refusal every unknown skill gets.
    MalformedSkillFile { skill: String, message: String },
}
