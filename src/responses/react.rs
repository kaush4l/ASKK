//! The [`ReActResponse`] contract: one turn of the ReAct loop — observation,
//! thinking, plan, and either a tool action or a final answer.

use std::collections::BTreeMap;

use serde_json::Value;

use super::define_response;

#[cfg(test)]
use super::{ParseOutcome, ResponseFormat, StructuredResponse};

define_response! {
    /// One turn of the ReAct loop — observation, thinking, plan, and either a tool
    /// action or a final answer.
    pub struct ReActResponse {
        observation: text => "One short sentence about current context, key facts, or constraints.",
        thinking: text => "Concise reasoning that is safe to show in the run timeline.",
        plan: list => "0-3 short, concrete next steps. Use [] when obvious.",
        action: (choice ReActAction { Tool = "tool", Answer = "answer" } default Answer, "tool | answer") => "'tool' to invoke a compiled tool, 'answer' for final response text.",
        response: text => "If action='tool': tool_name({\"key\":\"value\"}). If action='answer': final answer.",
    }
    normalize: normalize_invalid_action,
    finish: with_raw_fallback,
}

impl ReActResponse {
    pub fn final_text(&self) -> String {
        first_non_empty([&self.response, &self.thinking, &self.observation])
            .unwrap_or_else(|| "No response text was produced.".to_string())
    }

    fn with_raw_fallback(mut self, raw: &str) -> Self {
        if self.response.trim().is_empty()
            && self.thinking.trim().is_empty()
            && self.observation.trim().is_empty()
        {
            self.response = raw.trim().to_string();
        }
        self
    }
}

fn normalize_invalid_action(fields: &mut BTreeMap<String, Value>) {
    let action = fields
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if action.is_empty() || action == "tool" || action == "answer" {
        return;
    }
    if (action.contains('(') || action.contains('{')) && !fields.contains_key("response") {
        fields.insert("response".to_string(), Value::String(action));
    }
    fields.insert("action".to_string(), Value::String("tool".to_string()));
}

fn first_non_empty(values: [&str; 3]) -> Option<String> {
    values
        .iter()
        .map(|value| value.trim())
        .find(|value| !value.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn react_response_prefers_toon_over_inner_tool_json_args() {
        let parsed = ReActResponse::from_raw(
            r#"observation: The user wants to know the current news for today.
thinking: I need to perform a web search to gather latest headlines.
plan:
1. Search for today's top news headlines.
2. Summarize the key stories found.
action: tool
response: web_search({"query":"top news headlines today","count":5})"#,
        );

        assert_eq!(parsed.action, ReActAction::Tool);
        assert_eq!(
            parsed.response,
            r#"web_search({"query":"top news headlines today","count":5})"#
        );
    }

    #[test]
    fn react_response_still_parses_json_with_known_fields() {
        let parsed = ReActResponse::from_raw(
            r#"{"observation":"ready","thinking":"done","plan":[],"action":"answer","response":"Final text"}"#,
        );

        assert_eq!(parsed.action, ReActAction::Answer);
        assert_eq!(parsed.observation, "ready");
        assert_eq!(parsed.response, "Final text");
    }

    #[test]
    fn parsed_format_reports_toon_for_toon_reply() {
        let outcome =
            ReActResponse::parsed_format("observation: ok\naction: answer\nresponse: done");
        assert_eq!(outcome, ParseOutcome::Toon);
        // A TOON reply honors a TOON request but not a JSON one.
        assert!(outcome.honors(ResponseFormat::Toon));
        assert!(!outcome.honors(ResponseFormat::Json));
    }

    #[test]
    fn parsed_format_reports_json_for_json_reply() {
        let outcome = ReActResponse::parsed_format(
            r#"{"observation":"ready","action":"answer","response":"done"}"#,
        );
        assert_eq!(outcome, ParseOutcome::Json);
        assert!(outcome.honors(ResponseFormat::Json));
        assert!(!outcome.honors(ResponseFormat::Toon));
    }

    #[test]
    fn parsed_format_reports_fallback_for_unstructured_reply() {
        // Free prose with no known field markers honors no requested format, so it
        // counts as a failure for negotiation purposes.
        let outcome = ReActResponse::parsed_format("just some prose with no fields");
        assert_eq!(outcome, ParseOutcome::Fallback);
        assert!(!outcome.honors(ResponseFormat::Toon));
        assert!(!outcome.honors(ResponseFormat::Json));
    }

    #[test]
    fn react_fields_table_is_unchanged_by_macro_migration() {
        // Golden pin: the macro migration must keep the field table — and therefore
        // the generated JSON/TOON instructions — bit-for-bit identical.
        let fields = ReActResponse::fields();
        let expected: &[(&str, &str)] = &[
            ("observation", "string"),
            ("thinking", "string"),
            ("plan", "list"),
            ("action", "tool | answer"),
            ("response", "string"),
        ];
        let actual: Vec<(&str, &str)> = fields
            .iter()
            .map(|field| (field.name, field.type_name))
            .collect();
        assert_eq!(actual, expected);
        assert!(
            fields[3]
                .description
                .contains("'tool' to invoke a compiled tool")
        );
    }
}
