//! Phases as data (ADR-010 Option C). A phase is a named configuration of
//! the paper and nearly nothing else (§9); keeping it data keeps the
//! phase-cut question open as a config question and lets the forge one day
//! propose phase changes through the same gates as any module.

use serde::{Deserialize, Serialize};

use context::Budget;
use kernel::{PhaseId, ToolId};

/// Which capabilities a phase exposes. `None` is structural, not refused:
/// `render` receives it and emits no tool schema at all — Plan and Verify
/// cannot act even if the model asks (ADR-010).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ToolScope {
    None,
    /// Everything THIS agent's `agent.md` gave it. The per-agent decision is
    /// the frontmatter's (Python: `tools:` is the toolkit); the phase's job is
    /// only to say whether this phase may act at all.
    All,
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
    pub contract: ResponseContract,
    pub tools: ToolScope,
    pub budget: Budget,
    /// The ONLY legal next phases; everything else is handled by the
    /// machine, never by prose.
    pub exits: Vec<(ExitCondition, PhaseExit)>,
}

/// WHAT ONE WORKING TURN'S PAPER MAY COST. **PROVISIONAL (§17)** — 4096 was
/// too small for the agent that actually ships, and it was failing silently.
///
/// Measured 2026-08-23, `main` with its shipped peer `critic` loaded, in
/// `work`, asked "what is in this folder?": the paper wanted 4174 tokens before
/// a conversation existed, so the ladder pointered `## history`, pointered
/// `## space` and ELIDED `## observations` — on every single turn. The agent's
/// own prose tells it to read `## observations`; the budget was deleting the
/// block. `crates/agent/tests/prompt.rs` fails on exactly that now, by name.
///
/// 8192 and not more: the standing paper is ~4.2k (soul 2187 + affordances
/// ~1450 + environment 370), `compact_at: 8` means the window must hold eight
/// turns beside it, and doubling leaves ~4k for them while keeping the whole
/// prompt inside a 16k context — the floor for the local models this page is
/// pointed at. A number chosen against a MEASURED model context would be
/// better than one chosen against this arithmetic; that measurement is the
/// owner's to take, which is why this is marked provisional and not settled.
const WORK_BUDGET: Budget = Budget { max_tokens: 8192 };

/// The v1 phase set: Work/Verify default with Plan-on-demand and Answer as
/// the cheap exit (RESEARCH phase-cut softening of §9's symmetric cut —
/// changing this back is a config edit, which is the point of Option C).
pub fn v1_phases() -> Vec<PhaseConfig> {
    vec![
        // Work: one conversational turn that may act. The contract is
        // ToolEnvelope — prose is still a legal reply and ends the turn (the
        // cheap exit), tool calls run and come back as observations. `All`
        // means "this agent's own toolbox", which `agent.md`'s `tools:` key
        // decides; `render` builds the affordances section from exactly that
        // toolbox, so no ad-hoc prompt string can name a tool the agent was
        // not given (ADR-010, I13). A hardcoded list here was the bug the
        // Agents card exposed: the file said `tools:` and nothing read it.
        PhaseConfig {
            phase: PhaseId::Work,
            contract: ResponseContract::ToolEnvelope,
            tools: ToolScope::All,
            budget: WORK_BUDGET,
            exits: vec![
                (ExitCondition::ToolResultReceived, PhaseExit::To(PhaseId::Work)),
                (ExitCondition::AnswerProduced, PhaseExit::Answer),
            ],
        },
        // Verify: configured but unreachable until Work emits tool effects.
        PhaseConfig {
            phase: PhaseId::Verify,
            contract: ResponseContract::Verdict,
            tools: ToolScope::None,
            budget: Budget { max_tokens: 2048 },
            exits: vec![
                (ExitCondition::VerdictPass, PhaseExit::Answer),
                (ExitCondition::VerdictRetry, PhaseExit::To(PhaseId::Work)),
                (ExitCondition::VerdictReplan, PhaseExit::To(PhaseId::Plan)),
            ],
        },
    ]
}
