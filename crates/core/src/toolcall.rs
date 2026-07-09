//! Turning a model reply into tool calls (react-family). Small models emit
//! calls in several shapes — MCP `{"name","arguments"}`, one per line, a JSON
//! array, or the natural `toolname: {args}` — so these helpers are forgiving.
//! Split out of `contract.rs` to keep that file under the ADR-012 line cap.

use serde_json::{json, Map, Value};

use crate::contract::{extract_json_object, Action};
use crate::request::ToolCall;

/// One MCP-style call object → ToolCall: `{"name": ..., "arguments": {...}}`
/// (the shape MCP `tools/call` uses, so MCP-standard tools plug in as-is).
pub(crate) fn parse_mcp_call(value: &Value) -> Option<ToolCall> {
    let obj = value.as_object()?;
    let name = obj.get("name").and_then(Value::as_str)?.trim().to_string();
    if name.is_empty() {
        return None;
    }
    let args = obj
        .get("arguments")
        .cloned()
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}));
    Some(ToolCall {
        // Placeholder id: parse is pure, so the run loop assigns the
        // unique run-qualified id before absorb/dispatch.
        id: "call_0".into(),
        name,
        args,
    })
}

/// Is `s` a bare identifier a tool could be named with?
fn is_ident(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Scan raw reply text for tool calls in either shape a model emits, walking
/// every balanced top-level JSON object in order:
///
/// - MCP: a `{"name": ..., "arguments": {...}}` object; or
/// - natural: a `toolname: {json-args}` block, where `toolname` is any
///   identifier that is NOT one of the contract's own field names.
pub(crate) fn scan_tool_calls(text: &str, field_names: &[&str]) -> Vec<ToolCall> {
    let mut calls = Vec::new();
    let mut rest = text;
    while let Some(obj_str) = extract_json_object(rest) {
        // Position of this object within `rest` (extract_json_object returns a
        // slice of it), so we can look at the text just before it.
        let start = obj_str.as_ptr() as usize - rest.as_ptr() as usize;
        let before = &rest[..start];
        if let Ok(value) = serde_json::from_str::<Value>(obj_str) {
            if let Some(call) = parse_mcp_call(&value) {
                calls.push(call); // MCP `{"name","arguments"}`
            } else if let Some(name) = preceding_tool_name(before, field_names) {
                // `toolname: {args}` — the object IS the args.
                let args = if value.is_object() { value } else { json!({}) };
                calls.push(ToolCall {
                    id: "call_0".into(),
                    name,
                    args,
                });
            }
        }
        let advance = start + obj_str.len();
        rest = &rest[advance..];
    }
    calls
}

/// The `toolname:` label immediately preceding a JSON args object, if any —
/// the last `ident:` token in `before`, provided it is not a contract field.
fn preceding_tool_name(before: &str, field_names: &[&str]) -> Option<String> {
    let trimmed = before.trim_end().trim_end_matches(':').trim_end();
    let name = trimmed
        .rsplit(|c: char| c.is_whitespace() || c == '{' || c == ',')
        .next()?
        .trim();
    // The label must have actually ended in a colon (a `key:` line).
    if !before.trim_end().ends_with(':') || !is_ident(name) {
        return None;
    }
    if field_names.contains(&name) {
        return None;
    }
    Some(name.to_string())
}

/// Tool calls from the `answer` field: one MCP-style JSON object per line
/// (several lines = parallel calls), or a single JSON array of them.
fn calls_from_answer(answer: &str) -> Vec<ToolCall> {
    if let Ok(Value::Array(items)) = serde_json::from_str::<Value>(answer.trim()) {
        return items.iter().filter_map(parse_mcp_call).collect();
    }
    answer
        .lines()
        .filter_map(|line| {
            let object = extract_json_object(line)?;
            parse_mcp_call(&serde_json::from_str::<Value>(object).ok()?)
        })
        .collect()
}

/// Action derivation (react v2): `action` is the switch. `tool` → the call is
/// MCP-style (`{"name","arguments"}`), ideally in `answer` but models often
/// drop it on a bare line — so when `answer` yields nothing we scan the whole
/// raw reply for the call(s). `answer` (any non-call content) is the final
/// text, falling back to the raw reply.
pub(crate) fn derive_action(fields: &Map<String, Value>, raw_text: &str) -> Action {
    let answer = fields
        .get("answer")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if fields.get("action").and_then(Value::as_str) == Some("tool") {
        let calls = calls_from_answer(&answer);
        if !calls.is_empty() {
            return Action::ToolCalls(calls);
        }
        // Forgiving fallback: the model put the call on a bare line instead of
        // under `answer:`. Scan the raw reply for the call(s).
        let calls = scan_tool_calls(raw_text, &field_names(fields));
        if !calls.is_empty() {
            return Action::ToolCalls(calls);
        }
    }
    if answer.is_empty() {
        return Action::Answer(raw_text.trim().to_string());
    }
    Action::Answer(answer)
}

fn field_names(fields: &Map<String, Value>) -> Vec<&str> {
    fields.keys().map(String::as_str).collect()
}
