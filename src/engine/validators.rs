use crate::state::{AgentRun, ToolResult};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ValidationOutcome {
    pub ok: bool,
    pub feedback: String,
}

impl ValidationOutcome {
    pub fn passed() -> Self {
        Self {
            ok: true,
            feedback: String::new(),
        }
    }

    pub fn failed(feedback: impl Into<String>) -> Self {
        Self {
            ok: false,
            feedback: feedback.into(),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct ValidatorRegistry;

impl ValidatorRegistry {
    pub fn validate_tool_result(
        &self,
        tool_name: &str,
        result: &ToolResult,
        run: &mut AgentRun,
    ) -> ValidationOutcome {
        let outcome = if !result.ok {
            ValidationOutcome::failed(format!(
                "Tool result rejected for {tool_name}: {}",
                result.content
            ))
        } else if result.content.trim().is_empty() {
            ValidationOutcome::failed(format!(
                "Tool result rejected for {tool_name}: empty tool observation"
            ))
        } else {
            ValidationOutcome::passed()
        };
        record_validation(run, &outcome);
        outcome
    }

    pub fn validate_final_answer(&self, answer: &str, run: &mut AgentRun) -> ValidationOutcome {
        let trimmed = answer.trim();
        let outcome = if trimmed.is_empty() {
            ValidationOutcome::failed("Final answer rejected: answer is empty.")
        } else if run.tool_results.iter().any(|result| result.ok)
            && !answer_uses_recorded_evidence(trimmed, &run.tool_results)
        {
            ValidationOutcome::failed(
                "Final answer rejected: answer does not reference recorded evidence from validated tool results.",
            )
        } else {
            ValidationOutcome::passed()
        };
        record_validation(run, &outcome);
        outcome
    }
}

fn record_validation(run: &mut AgentRun, outcome: &ValidationOutcome) {
    run.scratchpad.verification.attempts = run.scratchpad.verification.attempts.saturating_add(1);
    run.scratchpad.verification.status = if outcome.ok {
        "passed".to_string()
    } else {
        "failed".to_string()
    };
    run.scratchpad.verification.last_result = if outcome.ok {
        "passed".to_string()
    } else {
        outcome.feedback.clone()
    };
    if !outcome.ok {
        run.scratchpad
            .verification
            .failures
            .push(outcome.feedback.clone());
    }
}

fn answer_uses_recorded_evidence(answer: &str, results: &[ToolResult]) -> bool {
    let answer = normalize_for_evidence_match(answer);
    if results.iter().filter(|result| result.ok).any(|result| {
        result.content.chars().count() > 120 && lexical_overlap(&answer, &result.content) >= 2
    }) {
        return true;
    }

    results
        .iter()
        .filter(|result| result.ok)
        .flat_map(|result| evidence_fragments(&result.content))
        .any(|fragment| answer.contains(&normalize_for_evidence_match(&fragment)))
}

fn lexical_overlap(answer: &str, evidence: &str) -> usize {
    let answer_tokens = evidence_tokens(answer);
    evidence_tokens(evidence)
        .into_iter()
        .filter(|token| {
            answer_tokens
                .iter()
                .any(|answer_token| answer_token == token)
        })
        .count()
}

fn evidence_tokens(value: &str) -> Vec<String> {
    normalize_for_evidence_match(value)
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|token| token.len() >= 5)
        .map(ToString::to_string)
        .collect()
}

fn evidence_fragments(content: &str) -> Vec<String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let mut fragments = Vec::new();
    if trimmed.chars().count() >= 6 {
        fragments.push(trimmed.to_string());
    }
    fragments.extend(
        trimmed
            .split(['\n', '.', ';'])
            .map(str::trim)
            .filter(|fragment| fragment.chars().count() >= 6)
            .map(ToString::to_string),
    );
    fragments
}

fn normalize_for_evidence_match(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{AgentRun, RunLane, RunStatus, ToolResult};

    fn minimal_run() -> AgentRun {
        AgentRun {
            id: "run-1".to_string(),
            goal: "answer with evidence".to_string(),
            status: RunStatus::Running,
            lane: RunLane::BoundedTask,
            scratchpad: Default::default(),
            messages: Vec::new(),
            events: Vec::new(),
            tool_calls: Vec::new(),
            tool_results: Vec::new(),
            final_answer: String::new(),
            created_at: "now".to_string(),
        }
    }

    #[test]
    fn tool_result_validator_rejects_failed_tool_observation() {
        let registry = ValidatorRegistry;
        let mut run = minimal_run();
        let result = ToolResult {
            call_id: "call-1".to_string(),
            ok: false,
            content: "network error".to_string(),
        };

        let validation = registry.validate_tool_result("web_search", &result, &mut run);

        assert!(!validation.ok);
        assert!(validation.feedback.contains("web_search"));
        assert_eq!(run.scratchpad.verification.status, "failed");
        assert_eq!(run.scratchpad.verification.failures.len(), 1);
    }

    #[test]
    fn final_answer_validator_requires_evidence_when_tools_were_used() {
        let registry = ValidatorRegistry;
        let mut run = minimal_run();
        run.tool_results.push(ToolResult {
            call_id: "call-1".to_string(),
            ok: true,
            content: "2 + 2 = 4".to_string(),
        });

        let validation = registry.validate_final_answer("The answer is seven.", &mut run);

        assert!(!validation.ok);
        assert!(validation.feedback.contains("recorded evidence"));
    }

    #[test]
    fn final_answer_validator_accepts_answer_grounded_in_recorded_tool_result() {
        let registry = ValidatorRegistry;
        let mut run = minimal_run();
        run.tool_results.push(ToolResult {
            call_id: "call-1".to_string(),
            ok: true,
            content: "2 + 2 = 4".to_string(),
        });

        let validation =
            registry.validate_final_answer("The recorded evidence says 2 + 2 = 4.", &mut run);

        assert!(validation.ok);
        assert_eq!(run.scratchpad.verification.status, "passed");
    }

    #[test]
    fn final_answer_validator_allows_summaries_of_large_tool_results() {
        let registry = ValidatorRegistry;
        let mut run = minimal_run();
        run.tool_results.push(ToolResult {
            call_id: "call-1".to_string(),
            ok: true,
            content: "A very long web search result containing many source snippets, URLs, descriptions, rankings, and surrounding context that the model may legitimately summarize without repeating an exact sentence.".to_string(),
        });

        let validation = registry.validate_final_answer(
            "The search evidence contains source snippets and rankings, so a concise summary is supported.",
            &mut run,
        );

        assert!(validation.ok);
    }
}
