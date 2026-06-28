//! Response contracts for strategy phases: plan, critique, skill selection, task
//! breakdown, and history summarization. All declared via [`define_response!`];
//! the base trait supplies parsing and JSON/TOON instructions.

use super::define_response;

define_response! {
    /// Output of a planning phase.
    pub struct PlanResponse {
        observation: text => "What is known about the task and its constraints.",
        plan: list => "Ordered, concrete steps (3 to 7 items).",
        risks: list => "What could go wrong or needs verification. Use [] when none.",
    }
}

define_response! {
    /// Verdict from a review/critique phase.
    pub struct CritiqueResponse {
        verdict: (choice CritiqueVerdict { Pass = "pass", Revise = "revise" } default Pass, "pass | revise") => "'pass' when the work meets the goal, 'revise' to send it back with feedback.",
        feedback: text => "If verdict='revise': specific, actionable feedback. Empty when passing.",
    }
}

define_response! {
    /// Skills chosen for the work phase.
    pub struct SkillSelectionResponse {
        selected_skills: list => "Names of the skills relevant to this goal. Use [] when none fit.",
        reason: text => "One sentence on why these skills fit the goal.",
    }
}

define_response! {
    /// Task decomposition from the orchestrator's decompose phase.
    pub struct TaskBreakdownResponse {
        observation: text => "What the goal needs and which specialists fit.",
        tasks: list => "Self-contained sub-tasks, each naming a suggested agent and strategy in parentheses.",
    }
}

define_response! {
    /// Compaction summary of older conversation history.
    pub struct SummaryResponse {
        summary: text => "Dense summary of the earlier conversation: decisions, key facts, file paths, tool results.",
        open_threads: list => "Unresolved questions or pending work items. Use [] when none.",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::responses::StructuredResponse;

    #[test]
    fn critique_verdict_parses_from_toon() {
        let parsed = CritiqueResponse::from_raw("verdict: revise\nfeedback: missing tests");
        assert_eq!(parsed.verdict, CritiqueVerdict::Revise);
        assert_eq!(parsed.feedback, "missing tests");
    }

    #[test]
    fn list_fields_parse_bracket_and_json_array_forms() {
        let bracket = PlanResponse::from_raw("observation: o\nplan: [read, edit]\nrisks: []");
        assert_eq!(bracket.plan, vec!["read".to_string(), "edit".to_string()]);

        let json =
            PlanResponse::from_raw(r#"{"observation":"o","plan":["read","edit"],"risks":[]}"#);
        assert_eq!(json.plan, vec!["read".to_string(), "edit".to_string()]);
    }

    #[test]
    fn phase_type_fallback_parse_yields_empty_fields() {
        // Unstructured prose has no known fields; the fallback path stores the raw
        // text under a nonexistent `response` key, so all fields stay empty/default.
        let parsed = CritiqueResponse::from_raw("just some prose with no fields");
        assert_eq!(parsed.verdict, CritiqueVerdict::Pass);
        assert!(parsed.feedback.is_empty());
    }

    #[test]
    fn plan_response_parses_toon() {
        let parsed = PlanResponse::from_raw(
            "observation: small task\nplan:\n1. read the file\n2. edit it\nrisks: []",
        );
        assert_eq!(parsed.observation, "small task");
        assert_eq!(parsed.plan.len(), 2);
        assert!(parsed.risks.is_empty());
    }

    #[test]
    fn critique_response_parses_json_and_choice_defaults_to_pass() {
        let parsed =
            CritiqueResponse::from_raw(r#"{"verdict":"revise","feedback":"missing tests"}"#);
        assert_eq!(parsed.verdict, CritiqueVerdict::Revise);
        assert_eq!(parsed.feedback, "missing tests");

        let fallback = CritiqueResponse::from_raw(r#"{"verdict":"??","feedback":""}"#);
        assert_eq!(fallback.verdict, CritiqueVerdict::Pass);
    }

    #[test]
    fn summary_fallback_parse_yields_empty_summary() {
        // Prose with no fields hits the fallback path: the engine must treat an
        // empty summary as "do not compact" (guarded in maybe_compact).
        let parsed = SummaryResponse::from_raw("here is a long prose reply with no fields");
        assert!(parsed.summary.is_empty());
    }

    #[test]
    fn summary_and_breakdown_and_skills_parse() {
        let summary =
            SummaryResponse::from_raw("summary: did things\nopen_threads: [verify output]");
        assert_eq!(summary.summary, "did things");
        assert_eq!(summary.open_threads, vec!["verify output".to_string()]);

        let breakdown = TaskBreakdownResponse::from_raw(
            "observation: two independent parts\ntasks:\n1. research X (researcher, react)\n2. build Y (coder, plan-act-review)",
        );
        assert_eq!(breakdown.tasks.len(), 2);

        let skills = SkillSelectionResponse::from_raw(
            "selected_skills: [research]\nreason: goal needs sources",
        );
        assert_eq!(skills.selected_skills, vec!["research".to_string()]);
    }
}
