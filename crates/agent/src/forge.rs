//! The forge pipeline (§7), as agent behavior and as a module. Each stage
//! emits an Event and is individually inspectable and abortable; user
//! approval arrives AS an Event — a gate, never inferred (momentum is not
//! permission).

use serde::{Deserialize, Serialize};

use kernel::Event;
use module::Manifest;

use crate::effect::Effect;

/// The named stages, in pipeline order (§7's arrow diagram, typed). An enum
/// so "which gate are we at" is state, not narration, and skipping a gate is
/// unrepresentable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ForgeStage {
    Propose,
    PlanApproval,
    Generate,
    StaticValidate,
    /// All capabilities denied (§7) — proves the module runs before it is
    /// trusted with anything.
    DryRun,
    ContractTest,
    /// Sandboxed-iframe render preview (ADR-008: per-element sandbox).
    Preview,
    /// What it asks for, and why — rendered from the literal grant list
    /// (ADR-006).
    CapabilityReview,
    UserApproval,
    Install,
    Verify,
    Announce,
}

/// The generated candidate: manifest + Rhai source (self-improvement rung
/// L2). Both are data, which is why rollback is deletion (§7).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Draft {
    pub manifest: Manifest,
    pub source: String,
}

/// One run of the pipeline — plain data, same discipline as `AgentState`, so
/// an in-flight forge survives a refresh at whichever gate it stopped.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForgeRun {
    pub stage: ForgeStage,
    /// What Scout proposed, verbatim — provenance for every later gate.
    pub proposal: String,
    /// Present from Generate onward.
    pub draft: Option<Draft>,
}

/// The forge's own manifest — the pipeline is itself a module (§7) and
/// registers through the same install path as everything it installs (I9,
/// demonstrated rather than claimed).
pub fn forge_manifest() -> Manifest {
    todo!("G4")
}

/// Advance one run by one event (approval, test result, denial…). Same
/// shape as `step` for the same reasons: pure, effect-emitting, replayable;
/// gates hold until their event arrives.
pub fn forge_step(run: ForgeRun, input: Event) -> (ForgeRun, Vec<Effect>) {
    let _ = (run, input);
    todo!("G4")
}
