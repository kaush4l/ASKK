//! [`ResponseKind`] — the id-keyed dispatch for structured response schemas. A
//! strategy phase names its schema by kind; the engine asks the kind for
//! format instructions and for parsing. Adding a response type = one
//! `define_response!` invocation + one variant here + one arm in each match.

use serde::{Deserialize, Serialize};

use super::phase_responses::{
    CritiqueResponse, PlanResponse, SkillSelectionResponse, SummaryResponse, TaskBreakdownResponse,
};
use super::react::ReActResponse;
use super::{ParseOutcome, ResponseFormat, StructuredResponse};

// Consumed by the strategy layer (Tasks 4+); suppress dead-code until then.
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResponseKind {
    ReAct,
    Plan,
    Critique,
    SkillSelection,
    TaskBreakdown,
    Summary,
}

/// A parsed phase response, tagged by kind. Strategies route on this.
#[allow(dead_code)]
#[derive(Clone, Debug, PartialEq)]
pub enum ParsedResponse {
    ReAct(ReActResponse),
    Plan(PlanResponse),
    Critique(CritiqueResponse),
    SkillSelection(SkillSelectionResponse),
    TaskBreakdown(TaskBreakdownResponse),
    Summary(SummaryResponse),
}

#[allow(dead_code)]
impl ResponseKind {
    /// The format-instruction block for this schema (always appended last in the
    /// rendered prompt).
    pub fn instructions(self, format: ResponseFormat) -> String {
        match self {
            Self::ReAct => ReActResponse::instructions(format),
            Self::Plan => PlanResponse::instructions(format),
            Self::Critique => CritiqueResponse::instructions(format),
            Self::SkillSelection => SkillSelectionResponse::instructions(format),
            Self::TaskBreakdown => TaskBreakdownResponse::instructions(format),
            Self::Summary => SummaryResponse::instructions(format),
        }
    }

    /// Parse raw model text into this kind's schema (JSON -> TOON -> fallback).
    pub fn parse(self, raw: &str) -> ParsedResponse {
        match self {
            Self::ReAct => ParsedResponse::ReAct(ReActResponse::from_raw(raw)),
            Self::Plan => ParsedResponse::Plan(PlanResponse::from_raw(raw)),
            Self::Critique => ParsedResponse::Critique(CritiqueResponse::from_raw(raw)),
            Self::SkillSelection => {
                ParsedResponse::SkillSelection(SkillSelectionResponse::from_raw(raw))
            }
            Self::TaskBreakdown => {
                ParsedResponse::TaskBreakdown(TaskBreakdownResponse::from_raw(raw))
            }
            Self::Summary => ParsedResponse::Summary(SummaryResponse::from_raw(raw)),
        }
    }

    /// Which format the raw reply actually parsed as, for negotiation scoring.
    pub fn parsed_format(self, raw: &str) -> ParseOutcome {
        match self {
            Self::ReAct => ReActResponse::parsed_format(raw),
            Self::Plan => PlanResponse::parsed_format(raw),
            Self::Critique => CritiqueResponse::parsed_format(raw),
            Self::SkillSelection => SkillSelectionResponse::parsed_format(raw),
            Self::TaskBreakdown => TaskBreakdownResponse::parsed_format(raw),
            Self::Summary => SummaryResponse::parsed_format(raw),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_parse_round_trips_each_variant_tag() {
        assert!(matches!(
            ResponseKind::Plan.parse("plan: [a]"),
            ParsedResponse::Plan(_)
        ));
        assert!(matches!(
            ResponseKind::ReAct.parse("action: answer\nresponse: hi"),
            ParsedResponse::ReAct(_)
        ));
        assert!(matches!(
            ResponseKind::Summary.parse("summary: s"),
            ParsedResponse::Summary(_)
        ));
    }

    #[test]
    fn kind_instructions_name_the_kinds_fields() {
        let text = ResponseKind::Critique.instructions(ResponseFormat::Toon);
        assert!(text.contains("verdict"));
        assert!(text.contains("feedback"));
        assert!(!text.contains("observation"));
    }
}
