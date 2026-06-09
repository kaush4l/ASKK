//! The [`ReActResponse`] contract: one turn of the ReAct loop — observation,
//! thinking, plan, and either a tool action or a final answer.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{ResponseField, StructuredResponse, list_field, string_field};

#[cfg(test)]
use super::{ParseOutcome, ResponseFormat};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum ReActAction {
    Tool,
    Answer,
}

impl ReActAction {
    fn from_value(value: Option<&Value>) -> Self {
        match value.and_then(Value::as_str).unwrap_or("answer").trim() {
            "tool" => Self::Tool,
            _ => Self::Answer,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ReActResponse {
    pub observation: String,
    pub thinking: String,
    pub plan: Vec<String>,
    pub action: ReActAction,
    pub response: String,
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

impl StructuredResponse for ReActResponse {
    fn fields() -> &'static [ResponseField] {
        &[
            ResponseField {
                name: "observation",
                type_name: "string",
                description: "One short sentence about current context, key facts, or constraints.",
            },
            ResponseField {
                name: "thinking",
                type_name: "string",
                description: "Concise reasoning that is safe to show in the run timeline.",
            },
            ResponseField {
                name: "plan",
                type_name: "list",
                description: "0-3 short, concrete next steps. Use [] when obvious.",
            },
            ResponseField {
                name: "action",
                type_name: "tool | answer",
                description: "'tool' to invoke a compiled tool, 'answer' for final response text.",
            },
            ResponseField {
                name: "response",
                type_name: "string",
                description: "If action='tool': tool_name({\"key\":\"value\"}). If action='answer': final answer.",
            },
        ]
    }

    fn from_fields(mut fields: BTreeMap<String, Value>, raw: &str) -> Self {
        normalize_invalid_action(&mut fields);
        Self {
            observation: string_field(&fields, "observation"),
            thinking: string_field(&fields, "thinking"),
            plan: list_field(&fields, "plan"),
            action: ReActAction::from_value(fields.get("action")),
            response: string_field(&fields, "response").trim().to_string(),
        }
        .with_raw_fallback(raw)
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
}
