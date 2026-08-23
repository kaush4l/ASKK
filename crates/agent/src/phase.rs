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
///
/// **`PlanSteps` AND `Verdict` WERE DELETED (2026-08-23), WITH THE `Verdict`
/// ENUM AND THE FIVE `ExitCondition` VARIANTS THAT ONLY SERVED THEM.** They
/// were the last of the PHASE machine that the STAGE machine superseded, and
/// none of them had a construction site: `grep -rn 'Verdict::' crates` returned
/// 0 across the whole tree, and `PlanSteps`/`PlanProduced` had had none since
/// before that. `reply.rs` answered both with `todo!("Plan/Verify contracts")`
/// — a panic that was unreachable only because no `PhaseConfig` happened to
/// name them, which is an accident and not a design.
///
/// **WHAT DID NOT GO WITH THEM, AND WHY THAT IS NOT A LOSS.** `project` still
/// plans, verifies and critiques — as STAGES (`strategy::Route::stages`,
/// `public/stages/*.md`), read as prose and tool calls like every other stage,
/// with the criteria in a file a person can edit without a rebuild. The typed
/// pair was the OLD way of doing what the tree already does the new way; the
/// deletion removes a mechanism and keeps the capability, which is the shape
/// this project's simplicity law asks an increment to have.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ResponseContract {
    /// Exactly one tool envelope (Work).
    ToolEnvelope,
    /// Prose to the user — the cheap exit every graph must have
    /// (RESEARCH phase-cut).
    Answer,
}

/// What a parsed reply can signal about where to go next. Matched against a
/// phase's `exits`; anything unmatched is an illegal transition the machine
/// repairs or fails deterministically (ADR-010).
///
/// **STILL DEAD, AND STATED RATHER THAN QUIETLY LEFT (I16).** Both surviving
/// variants are CONSTRUCTED — in `v1_phases` below — and neither is ever READ:
/// `grep -rn 'exits' crates` finds the field's declaration, its one write, and
/// no reader anywhere. So the whole exit table is config nothing consults, the
/// same defect class as the vocabulary just deleted. It is not deleted HERE
/// because removing it removes the last of the phase machine — `PhaseConfig`,
/// `PhaseId`, `ask::config`, `state.phase` — and that is a different increment
/// with a stored-state migration in it (`AgentState` is `Deserialize`d from the
/// log). Labelled, measured, and handed on rather than half-done.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExitCondition {
    ToolResultReceived,
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

/// The v1 phase set. ONE ENTRY, and the shrinking is the record.
///
/// **`Verify` WAS DELETED FROM HERE (2026-08-23), WITH ITS 2048-TOKEN BUDGET.**
/// It was configuration nothing could read, which under this project's
/// simplicity law is the same defect class as a type with no construction site.
/// The measurement, re-runnable: `grep -rn 'state\.phase' crates` returns two
/// reads (`ask.rs:26`, `ask.rs:83`) and one test assertion, and **no
/// assignment** — `AgentState::phase` is set once in `state::opening` and never
/// moved again, because the STAGE machine (`stages`, `strategy`) superseded the
/// phase machine and left the field behind. `ask::config` finds a config by
/// `c.phase == state.phase`, so only `Work` was ever reachable.
///
/// It was not merely dead, which is why deleting beat labelling. Its
/// `VerdictReplan` exit led `To(PhaseId::Plan)`, and **there has never been a
/// `Plan` entry in this list** — so had anything ever reached it, the next call
/// would have hit `ask::config`'s `.expect("current phase is configured")` and
/// panicked the turn. Keeping unreachable config would have preserved a
/// panic-in-waiting as though it were a plan.
///
/// **THE CASCADE IT LEFT BEHIND IS NOW DONE (2026-08-23).** That deletion left
/// `ResponseContract::{PlanSteps, Verdict}`, every `Verdict`, five
/// `ExitCondition` variants and `core::App.phases` with zero construction sites
/// or zero readers, and named the four files a follow-on would have to open.
/// All four are opened above and in `reply.rs`, `lib.rs` and `crates/core`: the
/// vocabulary is gone, the `todo!("Plan/Verify contracts")` panic with it, and
/// `App.phases` — written here at boot and read by nothing — with them.
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
    ]
}
