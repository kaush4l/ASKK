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
        if let Some(fields) = parse_json_object(raw) {
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

#[derive(Clone, Copy, Debug)]
pub enum ResponseFormat {
    Json,
    Toon,
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

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Tool => "tool",
            Self::Answer => "answer",
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
    let text = response_text.trim();
    if let Ok(value) = serde_json::from_str::<Value>(text) {
        if let Some(tool) = value.get("tool").and_then(Value::as_str) {
            return vec![ParsedToolCall {
                name: tool.to_string(),
                args: value
                    .get("args")
                    .cloned()
                    .unwrap_or(Value::Object(Default::default())),
            }];
        }
    }

    let Some(open_idx) = text.find('(') else {
        return Vec::new();
    };
    let Some(close_idx) = text.rfind(')') else {
        return Vec::new();
    };
    if close_idx <= open_idx {
        return Vec::new();
    }

    let name = text[..open_idx].trim();
    if name.is_empty()
        || !name
            .chars()
            .all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
    {
        return Vec::new();
    }
    let args_text = text[open_idx + 1..close_idx].trim();
    let args = serde_json::from_str::<Value>(args_text)
        .unwrap_or_else(|_| serde_json::json!({ "query": args_text }));
    vec![ParsedToolCall {
        name: name.to_string(),
        args,
    }]
}

pub fn response_to_result<T: StructuredResponse>(raw: &str) -> AppResult<T> {
    let parsed = T::from_raw(raw);
    Ok(parsed)
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
2. For tool use, set `action: tool` and put the full invocation in `response`, for example `memory_search({{"query":"browser"}})`.
3. For final output, set `action: answer` and put the answer in `response`.
4. Do not put a tool name in `action`; only `tool` or `answer` are valid."#
    )
}

fn parse_json_object(raw: &str) -> Option<BTreeMap<String, Value>> {
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
                    let value = serde_json::from_str::<Value>(json).ok()?;
                    let object = value.as_object()?;
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
        .and_then(|value| match value {
            Value::String(text) => Some(strip_wrapping_quotes(text)),
            _ => Some(value.to_string()),
        })
        .unwrap_or_default()
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
