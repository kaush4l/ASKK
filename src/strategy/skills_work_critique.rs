//! Select relevant skills one-shot → work loop with those skills → critique with a
//! bounded revise back-edge.

use crate::responses::{ParsedResponse, ResponseKind};

use super::{LoopMode, Phase, PhaseOutcome, Routing, Strategy, ToolPolicy};

pub struct SkillsWorkCritiqueStrategy;

const SKILLS_IDX: usize = 0;
const WORK_IDX: usize = 1;
const CRITIQUE_IDX: usize = 2;

static PHASES: [Phase; 3] = [
    Phase {
        name: "skills",
        response_kind: ResponseKind::SkillSelection,
        prompt_frame: "SKILL SELECTION phase: from the skill library below, pick the skills relevant to the goal. Pick none if none fit.",
        tool_policy: ToolPolicy::NoTools,
        loop_mode: LoopMode::OneShot,
        list_skill_library: true,
    },
    Phase {
        name: "work",
        response_kind: ResponseKind::ReAct,
        prompt_frame: "WORK phase: do the goal, guided by the selected skills.",
        tool_policy: ToolPolicy::Inherit,
        loop_mode: LoopMode::Loop { max_turns: 0 },
        list_skill_library: false,
    },
    Phase {
        name: "critique",
        response_kind: ResponseKind::Critique,
        prompt_frame: "CRITIQUE phase: judge whether the work above meets the goal. Verdict 'pass' or 'revise' with specific feedback.",
        tool_policy: ToolPolicy::NoTools,
        loop_mode: LoopMode::OneShot,
        list_skill_library: false,
    },
];

impl Strategy for SkillsWorkCritiqueStrategy {
    fn id(&self) -> &'static str {
        "skills-work-critique"
    }

    fn description(&self) -> &'static str {
        "Pick relevant skills, work the goal with them, then a critique pass."
    }

    fn phases(&self) -> &'static [Phase] {
        &PHASES
    }

    fn route(&self, from: usize, outcome: &PhaseOutcome) -> Routing {
        match (from, &outcome.response) {
            (SKILLS_IDX, _) | (WORK_IDX, _) => Routing::Next,
            (CRITIQUE_IDX, ParsedResponse::Critique(critique)) => {
                if critique.verdict == crate::responses::CritiqueVerdict::Revise {
                    Routing::Back(WORK_IDX)
                } else {
                    Routing::Done
                }
            }
            _ => Routing::Done,
        }
    }

    fn artifact(&self, outcome: &PhaseOutcome) -> Option<(String, String)> {
        match &outcome.response {
            ParsedResponse::SkillSelection(selection) if outcome.phase == "skills" => Some((
                "selected skills".to_string(),
                if selection.selected_skills.is_empty() {
                    "none".to_string()
                } else {
                    selection.selected_skills.join(", ")
                },
            )),
            ParsedResponse::Critique(critique) if outcome.phase == "critique" => {
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
    use crate::responses::{CritiqueResponse, CritiqueVerdict, SkillSelectionResponse};

    fn outcome(phase: &'static str, response: ParsedResponse) -> PhaseOutcome {
        PhaseOutcome {
            phase,
            response,
            turns_used: 1,
        }
    }

    #[test]
    fn revise_routes_back_to_work() {
        let strategy = SkillsWorkCritiqueStrategy;
        let critique = outcome(
            "critique",
            ParsedResponse::Critique(CritiqueResponse {
                verdict: CritiqueVerdict::Revise,
                feedback: "incomplete".to_string(),
            }),
        );
        assert_eq!(
            strategy.route(CRITIQUE_IDX, &critique),
            Routing::Back(WORK_IDX)
        );
    }

    #[test]
    fn skill_selection_becomes_artifact() {
        let strategy = SkillsWorkCritiqueStrategy;
        let selection = outcome(
            "skills",
            ParsedResponse::SkillSelection(SkillSelectionResponse {
                selected_skills: vec!["research".to_string()],
                reason: "needs sources".to_string(),
            }),
        );
        assert_eq!(strategy.route(SKILLS_IDX, &selection), Routing::Next);
        assert_eq!(
            strategy.artifact(&selection),
            Some(("selected skills".to_string(), "research".to_string()))
        );
    }
}
