//! Decompose one-shot → delegate loop (call_agent fan-out) → synthesize one-shot.
//! This replaces the bespoke wave-scheduling orchestrator: parallel fan-out is the
//! existing concurrent tool dispatch when the model emits several call_agent calls
//! in one turn.

use crate::responses::{ParsedResponse, ResponseKind};

use super::{LoopMode, Phase, PhaseOutcome, Routing, Strategy, ToolPolicy};

pub struct OrchestrateStrategy;

static PHASES: [Phase; 3] = [
    Phase {
        name: "decompose",
        response_kind: ResponseKind::TaskBreakdown,
        prompt_frame: "DECOMPOSE phase: break the goal into self-contained sub-tasks. For each, suggest which sub-agent should do it and which strategy fits (react, plan-act-review, skills-work-critique). Do not execute anything yet.",
        tool_policy: ToolPolicy::NoTools,
        loop_mode: LoopMode::OneShot,
        list_skill_library: false,
    },
    Phase {
        name: "delegate",
        response_kind: ResponseKind::ReAct,
        prompt_frame: "DELEGATE phase: hand each sub-task to a sub-agent with call_agent({\"agent\":...,\"query\":...,\"strategy\":...}). Emit several call_agent calls in one turn when tasks are independent — they run concurrently. Track progress in files if useful. Answer only when every sub-task has a result.",
        tool_policy: ToolPolicy::Subset(&["call_agent", "file_read", "file_write", "file_list"]),
        loop_mode: LoopMode::Loop { max_turns: 0 },
        list_skill_library: false,
    },
    Phase {
        name: "synthesize",
        response_kind: ResponseKind::ReAct,
        prompt_frame: "SYNTHESIZE phase: produce the final coherent answer to the original goal from the sub-task results above. Set action: answer.",
        tool_policy: ToolPolicy::NoTools,
        loop_mode: LoopMode::OneShot,
        list_skill_library: false,
    },
];

impl Strategy for OrchestrateStrategy {
    fn id(&self) -> &'static str {
        "orchestrate"
    }

    fn description(&self) -> &'static str {
        "Decompose the goal, delegate sub-tasks to sub-agents as tools, synthesize."
    }

    fn phases(&self) -> &'static [Phase] {
        &PHASES
    }

    fn route(&self, from: usize, _outcome: &PhaseOutcome) -> Routing {
        if from + 1 < self.phases().len() {
            Routing::Next
        } else {
            Routing::Done
        }
    }

    fn artifact(&self, outcome: &PhaseOutcome) -> Option<(String, String)> {
        match &outcome.response {
            ParsedResponse::TaskBreakdown(breakdown) if outcome.phase == "decompose" => Some((
                "task breakdown".to_string(),
                breakdown
                    .tasks
                    .iter()
                    .enumerate()
                    .map(|(i, task)| format!("{}. {task}", i + 1))
                    .collect::<Vec<_>>()
                    .join("\n"),
            )),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::responses::TaskBreakdownResponse;

    #[test]
    fn phases_run_forward_and_breakdown_becomes_artifact() {
        let strategy = OrchestrateStrategy;
        let breakdown = PhaseOutcome {
            phase: "decompose",
            response: ParsedResponse::TaskBreakdown(TaskBreakdownResponse {
                observation: "two parts".to_string(),
                tasks: vec!["research X (researcher, react)".to_string()],
            }),
            turns_used: 1,
        };
        assert_eq!(strategy.route(0, &breakdown), Routing::Next);
        let (name, content) = strategy.artifact(&breakdown).expect("artifact");
        assert_eq!(name, "task breakdown");
        assert!(content.contains("1. research X"));
        assert_eq!(strategy.route(2, &breakdown), Routing::Done);
    }
}
