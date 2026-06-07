//! Extracting a tool invocation from a model response. Accepts both the JSON
//! `{"name":..,"arguments":..}` shape and the inline `tool_name({...})` call shape,
//! tolerating smart quotes and extra wrapping parens.

use serde_json::{Value, json};

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
        Ok(Value::String(query)) => json!({ "query": query }),
        Ok(value) => value,
        Err(_) => json!({ "query": args_text }),
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
        let calls = parse_tool_calls(
            "web_search({\u{201c}query\u{201d}:\u{201c}OpenAI news\u{201d},\u{201c}count\u{201d}:3})",
        );

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
}
