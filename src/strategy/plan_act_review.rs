//! Plan one-shot → act loop → review one-shot, with a bounded revise back-edge.

use crate::responses::{ParsedResponse, ResponseKind};

use super::{LoopMode, Phase, PhaseOutcome, Routing, Strategy, ToolPolicy};

pub struct PlanActReviewStrategy;

const PLAN_IDX: usize = 0;
const ACT_IDX: usize = 1;
const REVIEW_IDX: usize = 2;

static PHASES: [Phase; 3] = [
    Phase {
        name: "plan",
        response_kind: ResponseKind::Plan,
        prompt_frame: "PLAN phase: produce a concrete plan for the goal below. Do not execute anything yet.",
        tool_policy: ToolPolicy::NoTools,
        loop_mode: LoopMode::OneShot,
        list_skill_library: false,
    },
    Phase {
        name: "act",
        response_kind: ResponseKind::ReAct,
        prompt_frame: "ACT phase: execute the plan. Use tools as needed and answer when done.",
        tool_policy: ToolPolicy::Inherit,
        loop_mode: LoopMode::Loop { max_turns: 0 },
        list_skill_library: false,
    },
    Phase {
        name: "review",
        response_kind: ResponseKind::Critique,
        prompt_frame: "REVIEW phase: judge whether the work above actually meets the goal. Verdict 'pass' or 'revise' with specific feedback.",
        tool_policy: ToolPolicy::NoTools,
        loop_mode: LoopMode::OneShot,
        list_skill_library: false,
    },
];

impl Strategy for PlanActReviewStrategy {
    fn id(&self) -> &'static str {
        "plan-act-review"
    }

    fn description(&self) -> &'static str {
        "Plan first, act in a tool loop, then a critique pass that can send work back."
    }

    fn phases(&self) -> &'static [Phase] {
        &PHASES
    }

    fn route(&self, from: usize, outcome: &PhaseOutcome) -> Routing {
        match (from, &outcome.response) {
            (PLAN_IDX, _) => Routing::Next,
            (ACT_IDX, _) => Routing::Next,
            (REVIEW_IDX, ParsedResponse::Critique(critique)) => {
                if critique.verdict == crate::responses::CritiqueVerdict::Revise {
                    Routing::Back(ACT_IDX)
                } else {
                    Routing::Done
                }
            }
            _ => Routing::Done,
        }
    }

    fn artifact(&self, outcome: &PhaseOutcome) -> Option<(String, String)> {
        match &outcome.response {
            ParsedResponse::Plan(plan) if outcome.phase == "plan" => Some((
                "plan".to_string(),
                plan.plan
                    .iter()
                    .enumerate()
                    .map(|(i, step)| format!("{}. {step}", i + 1))
                    .collect::<Vec<_>>()
                    .join("\n"),
            )),
            ParsedResponse::Critique(critique) if outcome.phase == "review" => {
                if critique.feedback.trim().is_empty() {
                    None
                } else {
                    Some(("feedback".to_string(), critique.feedback.clone()))
                }
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::responses::{CritiqueResponse, CritiqueVerdict, PlanResponse};

    fn outcome(phase: &'static str, response: ParsedResponse) -> PhaseOutcome {
        PhaseOutcome {
            phase,
            response,
            turns_used: 1,
        }
    }

    #[test]
    fn revise_routes_back_to_act_with_feedback_artifact() {
        let strategy = PlanActReviewStrategy;
        let review = outcome(
            "review",
            ParsedResponse::Critique(CritiqueResponse {
                verdict: CritiqueVerdict::Revise,
                feedback: "tests missing".to_string(),
            }),
        );
        assert_eq!(strategy.route(REVIEW_IDX, &review), Routing::Back(ACT_IDX));
        assert_eq!(
            strategy.artifact(&review),
            Some(("feedback".to_string(), "tests missing".to_string()))
        );
    }

    #[test]
    fn pass_routes_done_and_plan_becomes_artifact() {
        let strategy = PlanActReviewStrategy;
        let review = outcome(
            "review",
            ParsedResponse::Critique(CritiqueResponse {
                verdict: CritiqueVerdict::Pass,
                feedback: String::new(),
            }),
        );
        assert_eq!(strategy.route(REVIEW_IDX, &review), Routing::Done);

        let plan = outcome(
            "plan",
            ParsedResponse::Plan(PlanResponse {
                observation: "o".to_string(),
                plan: vec!["read".to_string(), "write".to_string()],
                risks: vec![],
            }),
        );
        assert_eq!(strategy.route(PLAN_IDX, &plan), Routing::Next);
        let (name, content) = strategy.artifact(&plan).expect("plan artifact");
        assert_eq!(name, "plan");
        assert!(content.contains("1. read"));
    }
}
