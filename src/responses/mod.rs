//! Response-format pillar: the contract for turning a model's raw text into a typed
//! struct, and the format engine that does it.
//!
//! [`StructuredResponse`] is the "abstract parent": a concrete response declares its
//! [`fields`](StructuredResponse::fields) and how to build itself
//! [`from_fields`](StructuredResponse::from_fields); it inherits the cascade parser
//! [`from_raw`](StructuredResponse::from_raw) (JSON → TOON → fallback) and the prompt
//! [`instructions`](StructuredResponse::instructions). Adding a new response contract
//! is one `impl`; adding a new wire format is one arm in the cascade here.
//!
//! - [`react`] — the [`ReActResponse`](react::ReActResponse) contract (the loop's turn)
//! - [`critic`] — the verification-critic contract
//! - [`tool_calls`] — extracting a tool invocation from a response

use crate::state::AppResult;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

mod critic;
mod react;
mod tool_calls;

pub use critic::VerificationCriticResponse;
pub use react::{ReActAction, ReActResponse};
pub use tool_calls::parse_tool_calls;

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

pub fn response_to_result<T: StructuredResponse>(raw: &str) -> AppResult<T> {
    let parsed = T::from_raw(raw);
    Ok(parsed)
}

// ---------------------------------------------------------------------------
// Format engine: prompt-instruction builders and the JSON/TOON readers shared by
// every `StructuredResponse`. Private to this module; the contract submodules use
// the field-extraction helpers below via `super::`.
// ---------------------------------------------------------------------------

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

fn clean_key(raw: &str) -> String {
    raw.trim()
        .trim_start_matches(['-', '*', ' '])
        .trim_matches('*')
        .trim()
        .to_lowercase()
}

// Streams the final-answer text as it arrives. Used by the SSE path in
// `inference::transport`, which only compiles on the wasm target, so the host build
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

// ---------------------------------------------------------------------------
// Field-extraction helpers shared by the contract submodules (`react`, `critic`).
// Private here; visible to those descendants via `super::`.
// ---------------------------------------------------------------------------

fn string_field(fields: &BTreeMap<String, Value>, key: &str) -> String {
    fields
        .get(key)
        .map(|value| match value {
            Value::String(text) => strip_wrapping_quotes(text),
            _ => value.to_string(),
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

#[cfg(test)]
mod tests {
    use super::*;

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
