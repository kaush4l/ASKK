//! Phases as data (ADR-010 Option C). A phase is a named configuration of
//! the paper and nearly nothing else (§9); keeping it data keeps the
//! phase-cut question open as a config question and lets the forge one day
//! propose phase changes through the same gates as any module.

use serde::{Deserialize, Serialize};

use context::{Budget, Fidelity};
use kernel::{PhaseId, SectionId, ToolId};

/// Which capabilities a phase exposes. `None` is structural, not refused:
/// `render` receives it and emits no tool schema at all — Plan and Verify
/// cannot act even if the model asks (ADR-010).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ToolScope {
    None,
    Only(Vec<ToolId>),
}

/// The exact reply shape a phase demands — parsed, never trusted. One
/// variant per §9 contract; a new contract is a new variant plus a parser
/// arm, surfaced as a design change rather than smuggled in via prose.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ResponseContract {
    /// Ordered steps + success criteria (Plan).
    PlanSteps,
    /// Exactly one tool envelope (Work).
    ToolEnvelope,
    /// pass / fail / retry / replan + reason (Verify).
    Verdict,
    /// Prose to the user — the cheap exit every graph must have
    /// (RESEARCH phase-cut).
    Answer,
}

/// Verify's four legal judgments (ADR-010). An enum so an illegal fifth
/// judgment is a parse error the machine handles, not a string the loop
/// improvises on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Verdict {
    Pass,
    Fail,
    Retry,
    Replan,
}

/// What a parsed reply can signal about where to go next. Matched against a
/// phase's `exits`; anything unmatched is an illegal transition the machine
/// repairs or fails deterministically (ADR-010).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExitCondition {
    PlanProduced,
    ToolResultReceived,
    VerdictPass,
    VerdictFail,
    VerdictRetry,
    VerdictReplan,
    AnswerProduced,
}

/// Where an exit leads. `Answer` is a terminal, not a phase — modeling it
/// here keeps `PhaseId` honest (there is no "Answer document" to configure).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PhaseExit {
    To(PhaseId),
    Answer,
}

/// One phase, fully described (ADR-010's record, field for field). Static
/// data in v1, validated in `cargo test`; the interpreter in `step` stays
/// thin — a phase needing bespoke code is a design smell to surface.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PhaseConfig {
    pub phase: PhaseId,
    /// Which sections the paper contains, at what fidelity. Subsets the
    /// canonical order, never reorders it (DOMAIN §2).
    pub sections: Vec<(SectionId, Fidelity)>,
    pub contract: ResponseContract,
    pub tools: ToolScope,
    pub budget: Budget,
    /// The ONLY legal next phases; everything else is handled by the
    /// machine, never by prose.
    pub exits: Vec<(ExitCondition, PhaseExit)>,
}

/// The v1 phase set: Work/Verify default with Plan-on-demand and Answer as
/// the cheap exit (RESEARCH phase-cut softening of §9's symmetric cut —
/// changing this back is a config edit, which is the point of Option C).
pub fn v1_phases() -> Vec<PhaseConfig> {
    todo!("G4")
}
