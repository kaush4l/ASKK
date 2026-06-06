use crate::state::AppResult;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Debug)]
pub struct ResponseField {
    pub name: &'static str,
    pub type_name: &'static str,
    pub description: &'static str,
}

pub trait StructuredResponse: Sized {
    fn fields() -> &'static [ResponseField];
    fn from_fields(fields: BTreeMap<String, Value>, raw: &str) -> Self;

    fn instructions(format: ResponseFormat) -> String {
        match format {
            ResponseFormat::Json => json_instructions(Self::fields()),
            ResponseFormat::Toon => toon_instructions(Self::fields()),
        }
    }

    fn from_raw(raw: impl AsRef<str>) -> Self {
        let raw = raw.as_ref();
        if let Some(fields) = parse_json_object(raw, Self::fields()) {
            return Self::from_fields(fields, raw);
        }
        if let Some(fields) = parse_toon(raw, Self::fields()) {
            return Self::from_fields(fields, raw);
        }
        let mut fallback = BTreeMap::new();
        fallback.insert(
            "response".to_string(),
            Value::String(raw.trim().to_string()),
        );
        Self::from_fields(fallback, raw)
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ResponseFormat {
    Json,
    #[default]
    Toon,
}

impl ResponseFormat {
    pub fn from_form_value(value: &str) -> Self {
        match value {
            "json" => Self::Json,
            _ => Self::Toon,
        }
    }

    pub fn as_form_value(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::Toon => "toon",
        }
    }
}

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

// Verification critic response. Parsed by the (currently dormant) critic path in
// `inference.rs`; kept ready for the verification loop, so allow it to be unused.
#[allow(dead_code)]
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct VerificationCriticResponse {
    pub passed: bool,
    pub reason: String,
    pub required_changes: Vec<String>,
}

impl StructuredResponse for VerificationCriticResponse {
    fn fields() -> &'static [ResponseField] {
        &[
            ResponseField {
                name: "passed",
                type_name: "boolean",
                description: "true only when the worker result satisfies the goal using the supplied evidence.",
            },
            ResponseField {
                name: "reason",
                type_name: "string",
                description: "One concise explanation of why verification passed or failed.",
            },
            ResponseField {
                name: "required_changes",
                type_name: "list",
                description: "Concrete changes needed if failed. Use [] when passed.",
            },
        ]
    }

    fn from_fields(fields: BTreeMap<String, Value>, raw: &str) -> Self {
        let reason = string_field(&fields, "reason");
        let required_changes = list_field(&fields, "required_changes");
        Self {
            passed: bool_field(&fields, "passed"),
            reason: if reason.trim().is_empty() {
                raw.trim().to_string()
            } else {
                reason
            },
            required_changes,
        }
    }
}

impl ReActResponse {
    pub fn final_text(&self) -> String {
        first_non_empty([&self.response, &self.thinking, &self.observation])
            .unwrap_or_else(|| "No response text was produced.".to_string())
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

impl ReActResponse {
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

#[derive(Clone, Debug, PartialEq)]
pub struct ParsedToolCall {
    pub name: String,
    pub args: Value,
}

pub fn parse_tool_calls(response_text: &str) -> Vec<ParsedToolCall> {
    let normalized_text = normalize_tool_text(response_text);
    let text = normalized_text.trim();
    if let Ok(value) = serde_json::from_str::<Value>(text)
        && let Some(tool) = value
            .get("tool")
            .or_else(|| value.get("name"))
            .and_then(Value::as_str)
    {
        return vec![ParsedToolCall {
            name: tool.to_string(),
            args: value
                .get("args")
                .or_else(|| value.get("arguments"))
                .or_else(|| value.get("input"))
                .cloned()
                .unwrap_or(Value::Object(Default::default())),
        }];
    }

    parse_function_tool_call(text).into_iter().collect()
}

fn parse_function_tool_call(text: &str) -> Option<ParsedToolCall> {
    for (open_idx, _) in text.match_indices('(') {
        let name_start = text[..open_idx]
            .char_indices()
            .rev()
            .find_map(|(idx, ch)| {
                if ch == '_' || ch.is_ascii_alphanumeric() {
                    None
                } else {
                    Some(idx + ch.len_utf8())
                }
            })
            .unwrap_or(0);
        let name = text[name_start..open_idx].trim();
        if !is_tool_name(name) {
            continue;
        }
        let Some(close_idx) = matching_close_paren(text, open_idx) else {
            continue;
        };
        let args_text = strip_extra_arg_parens(text[open_idx + 1..close_idx].trim());
        let args = parse_tool_args(args_text);
        return Some(ParsedToolCall {
            name: name.to_string(),
            args,
        });
    }
    None
}

fn matching_close_paren(text: &str, open_idx: usize) -> Option<usize> {
    let mut depth = 0usize;
    for (idx, ch) in text[open_idx..].char_indices() {
        match ch {
            '(' => depth = depth.saturating_add(1),
            ')' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(open_idx + idx);
                }
            }
            _ => {}
        }
    }
    None
}

fn strip_extra_arg_parens(mut text: &str) -> &str {
    loop {
        let trimmed = text.trim();
        if !(trimmed.starts_with('(') && trimmed.ends_with(')')) {
            return trimmed;
        }
        let inner = trimmed[1..trimmed.len() - 1].trim();
        if inner.starts_with('{') || inner.starts_with('[') {
            text = inner;
            continue;
        }
        return trimmed;
    }
}

fn parse_tool_args(args_text: &str) -> Value {
    match serde_json::from_str::<Value>(args_text) {
        Ok(Value::Object(object)) => Value::Object(object),
        Ok(Value::String(query)) => serde_json::json!({ "query": query }),
        Ok(value) => value,
        Err(_) => serde_json::json!({ "query": args_text }),
    }
}

fn is_tool_name(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

fn normalize_tool_text(raw: &str) -> String {
    raw.replace(['\u{201c}', '\u{201d}'], "\"")
        .replace(['\u{2018}', '\u{2019}'], "'")
}

pub fn response_to_result<T: StructuredResponse>(raw: &str) -> AppResult<T> {
    let parsed = T::from_raw(raw);
    Ok(parsed)
}

// Streams the final-answer text as it arrives. Used by the SSE path in
// `inference.rs`, which only compiles on the wasm target, so the host build
// sees these helpers as unused.
#[allow(dead_code)]
pub fn partial_react_answer_text(raw: &str) -> Option<String> {
    let action = find_toon_field(raw, "action")?;
    let response = find_toon_field(raw, "response")?;
    if !action.value.trim().eq_ignore_ascii_case("answer") {
        return None;
    }
    if response.start <= action.start {
        return None;
    }
    Some(response.value.trim_start().to_string())
}

#[allow(dead_code)]
struct ToonField<'a> {
    start: usize,
    value: &'a str,
}

#[allow(dead_code)]
fn find_toon_field<'a>(raw: &'a str, field: &str) -> Option<ToonField<'a>> {
    let mut offset = 0usize;
    for line in raw.split_inclusive('\n') {
        let line_without_newline = line.trim_end_matches('\n').trim_end_matches('\r');
        if let Some((key, _value)) = line_without_newline.split_once(':')
            && clean_key(key) == field
        {
            let value_start = offset + key.len() + 1;
            let value_end = if field == "response" {
                raw.len()
            } else {
                offset + line_without_newline.len()
            };
            return Some(ToonField {
                start: value_start,
                value: &raw[value_start..value_end],
            });
        }
        offset += line.len();
    }
    None
}

fn json_instructions(fields: &[ResponseField]) -> String {
    let docs = fields
        .iter()
        .map(|field| {
            format!(
                "- {} ({}): {}",
                field.name, field.type_name, field.description
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "## RESPONSE FORMAT\n\nRespond with one JSON object containing these fields:\n\n{docs}\n\nOutput only the JSON object, without markdown fences."
    )
}

fn toon_instructions(fields: &[ResponseField]) -> String {
    let docs = fields
        .iter()
        .map(|field| {
            format!(
                "- {} ({}): {}",
                field.name, field.type_name, field.description
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let names = fields
        .iter()
        .map(|field| field.name)
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        r#"## RESPONSE FORMAT

Use exactly these fields, one field per block: {names}.

{docs}

Rules:
1. Field names are lowercase followed by a colon.
2. For tool use, set `action: tool` and put the full invocation in `response`, for example `web_search({{"query":"latest Dioxus 0.7 docs","count":5}})`.
3. For final output, set `action: answer` and put the answer in `response`.
4. Do not put a tool name in `action`; only `tool` or `answer` are valid."#
    )
}

fn parse_json_object(raw: &str, known_fields: &[ResponseField]) -> Option<BTreeMap<String, Value>> {
    let mut depth = 0usize;
    let mut start = None;
    for (idx, ch) in raw.char_indices() {
        match ch {
            '{' => {
                if depth == 0 {
                    start = Some(idx);
                }
                depth += 1;
            }
            '}' if depth > 0 => {
                depth -= 1;
                if depth == 0 {
                    let json = &raw[start?..=idx];
                    let Ok(value) = serde_json::from_str::<Value>(json) else {
                        continue;
                    };
                    let Some(object) = value.as_object() else {
                        continue;
                    };
                    if !object.keys().any(|key| is_known_field(key, known_fields)) {
                        continue;
                    }
                    return Some(
                        object
                            .iter()
                            .map(|(key, value)| (key.clone(), value.clone()))
                            .collect(),
                    );
                }
            }
            _ => {}
        }
    }
    None
}

fn is_known_field(key: &str, known_fields: &[ResponseField]) -> bool {
    known_fields.iter().any(|field| field.name == key)
}

fn parse_toon(raw: &str, known_fields: &[ResponseField]) -> Option<BTreeMap<String, Value>> {
    let names = known_fields
        .iter()
        .map(|field| field.name)
        .collect::<Vec<_>>();
    let lines = raw.lines().collect::<Vec<_>>();
    let mut starts = Vec::<(usize, String, String)>::new();

    for (idx, line) in lines.iter().enumerate() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = clean_key(key);
        let key = if key == "tool" {
            "response".to_string()
        } else {
            key
        };
        if names.iter().any(|name| *name == key) {
            starts.push((idx, key, value.trim().to_string()));
        }
    }

    if starts.is_empty() {
        return None;
    }

    let mut fields = BTreeMap::new();
    for (pos, (start_idx, key, first_value)) in starts.iter().enumerate() {
        let end_idx = starts
            .get(pos + 1)
            .map(|(idx, _, _)| *idx)
            .unwrap_or(lines.len());
        let mut parts = Vec::new();
        if !first_value.is_empty() {
            parts.push(first_value.clone());
        }
        parts.extend(
            lines[start_idx + 1..end_idx]
                .iter()
                .map(|line| line.trim().to_string()),
        );
        fields.insert(
            key.clone(),
            Value::String(parts.join("\n").trim().to_string()),
        );
    }
    Some(fields)
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

fn clean_key(raw: &str) -> String {
    raw.trim()
        .trim_start_matches(['-', '*', ' '])
        .trim_matches('*')
        .trim()
        .to_lowercase()
}

fn string_field(fields: &BTreeMap<String, Value>, key: &str) -> String {
    fields
        .get(key)
        .map(|value| match value {
            Value::String(text) => strip_wrapping_quotes(text),
            _ => value.to_string(),
        })
        .unwrap_or_default()
}

// Used by `VerificationCriticResponse::from_fields` (dormant critic path).
#[allow(dead_code)]
fn bool_field(fields: &BTreeMap<String, Value>, key: &str) -> bool {
    match fields.get(key) {
        Some(Value::Bool(value)) => *value,
        Some(Value::String(text)) => matches!(
            text.trim().to_ascii_lowercase().as_str(),
            "true" | "yes" | "pass" | "passed"
        ),
        Some(Value::Number(number)) => number.as_u64().is_some_and(|value| value > 0),
        _ => false,
    }
}

fn list_field(fields: &BTreeMap<String, Value>, key: &str) -> Vec<String> {
    match fields.get(key) {
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| {
                item.as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| item.to_string())
            })
            .collect(),
        Some(Value::String(text)) => parse_bracket_list(text).unwrap_or_else(|| {
            text.lines()
                .map(|line| {
                    line.trim()
                        .trim_start_matches(['-', '*', ' '])
                        .trim()
                        .to_string()
                })
                .filter(|line| !line.is_empty())
                .collect()
        }),
        _ => Vec::new(),
    }
}

fn parse_bracket_list(value: &str) -> Option<Vec<String>> {
    let trimmed = value.trim();
    if !(trimmed.starts_with('[') && trimmed.ends_with(']')) {
        return None;
    }
    let inner = trimmed[1..trimmed.len() - 1].trim();
    if inner.is_empty() {
        return Some(Vec::new());
    }
    Some(
        inner
            .split(',')
            .map(|item| strip_wrapping_quotes(item.trim()).trim().to_string())
            .filter(|item| !item.is_empty())
            .collect(),
    )
}

fn strip_wrapping_quotes(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 {
        let first = trimmed.as_bytes()[0] as char;
        let last = trimmed.as_bytes()[trimmed.len() - 1] as char;
        if (first == '"' || first == '\'') && first == last {
            return trimmed[1..trimmed.len() - 1].to_string();
        }
    }
    trimmed.to_string()
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
    fn parse_tool_call_accepts_extra_wrapped_json_args() {
        let calls =
            parse_tool_calls(r#"web_search(({"query":"top news headlines today","count":5}))"#);

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "web_search");
        assert_eq!(calls[0].args["query"], "top news headlines today");
        assert_eq!(calls[0].args["count"], 5);
    }

    #[test]
    fn parse_tool_call_finds_invocation_inside_react_text() {
        let calls = parse_tool_calls(
            r#"observation: The user wants news.
thinking: I need search.
action: tool
response: web_search({"query":"today news","count":5})"#,
        );

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "web_search");
        assert_eq!(calls[0].args["query"], "today news");
    }

    #[test]
    fn parse_tool_call_normalizes_smart_quotes() {
        let calls = parse_tool_calls("web_search({“query”:“OpenAI news”,“count”:3})");

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "web_search");
        assert_eq!(calls[0].args["query"], "OpenAI news");
        assert_eq!(calls[0].args["count"], 3);
    }

    #[test]
    fn parse_tool_call_accepts_openai_style_name_arguments_json() {
        let calls = parse_tool_calls(
            r#"{"name":"web_search","arguments":{"query":"latest AI news","count":2}}"#,
        );

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "web_search");
        assert_eq!(calls[0].args["query"], "latest AI news");
        assert_eq!(calls[0].args["count"], 2);
    }

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
    fn partial_react_answer_streams_only_final_response() {
        let raw = "observation: ok\nthinking: hidden\nplan:\n- answer\naction: answer\nresponse: visible answer";

        assert_eq!(
            partial_react_answer_text(raw),
            Some("visible answer".to_string())
        );
    }

    #[test]
    fn partial_react_answer_ignores_tool_decisions() {
        let raw = "observation: ok\naction: tool\nresponse: web_search({\"query\":\"news\"})";

        assert_eq!(partial_react_answer_text(raw), None);
    }
}
