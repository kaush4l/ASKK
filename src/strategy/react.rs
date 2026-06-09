//! `react` — the degenerate single-phase strategy reproducing the original
//! ReAct loop exactly. The parity baseline and the default for every agent.

use crate::responses::ResponseKind;

use super::{LoopMode, Phase, PhaseOutcome, Routing, Strategy, ToolPolicy};

pub struct ReactStrategy;

static REACT_PHASES: [Phase; 1] = [Phase {
    name: "act",
    response_kind: ResponseKind::ReAct,
    prompt_frame: "",
    tool_policy: ToolPolicy::Inherit,
    loop_mode: LoopMode::Loop { max_turns: 0 },
    list_skill_library: false,
}];

impl Strategy for ReactStrategy {
    fn id(&self) -> &'static str {
        "react"
    }

    fn description(&self) -> &'static str {
        "Single ReAct loop: observe, think, act with tools, answer."
    }

    fn phases(&self) -> &'static [Phase] {
        &REACT_PHASES
    }

    fn route(&self, _from: usize, _outcome: &PhaseOutcome) -> Routing {
        Routing::Done
    }
}
