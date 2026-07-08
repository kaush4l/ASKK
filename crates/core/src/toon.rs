//! TOON — token-oriented object notation. Line-based `field: value` format
//! small models emit more reliably than JSON. Fallback wire format (ADR-002).
//!
//! Decode is key-aware: only lines opening with a *known* field name are
//! treated as keys; everything else is continuation text of the current field.
//! Tolerant by design: quote stripping, trailing commas, inline `[a, b]` lists.

use serde_json::{Map, Value};

/// Encode a field map as TOON text. Lists become `field:` + `- item` lines.
pub fn encode(fields: &Map<String, Value>) -> String {
    let mut out = String::new();
    for (key, value) in fields {
        match value {
            Value::Array(items) => {
                out.push_str(key);
                out.push_str(":\n");
                for item in items {
                    out.push_str("- ");
                    out.push_str(&scalar(item));
                    out.push('\n');
                }
            }
            other => {
                out.push_str(key);
                out.push_str(": ");
                out.push_str(&scalar(other));
                out.push('\n');
            }
        }
    }
    out
}

fn scalar(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// Key-aware decode. Unknown `word:` lines are continuation text, so colons
/// inside values (URLs, prose) never split a field.
pub fn decode(text: &str, known_keys: &[&str]) -> Map<String, Value> {
    let mut map = Map::new();
    // (key, continuation lines, dash-list items)
    let mut current: Option<(String, Vec<String>, Vec<String>)> = None;
    for line in text.lines() {
        if let Some((key, rest)) = key_line(line, known_keys) {
            if let Some(entry) = current.take() {
                close(&mut map, entry);
            }
            let rest = rest.trim();
            let mut lines = Vec::new();
            if !rest.is_empty() {
                lines.push(rest.to_string());
            }
            current = Some((key, lines, Vec::new()));
        } else if let Some((_, lines, items)) = current.as_mut() {
            let trimmed = line.trim();
            if let Some(item) = trimmed.strip_prefix("- ") {
                items.push(strip_quotes(item).to_string());
            } else if trimmed == "-" {
                items.push(String::new());
            } else if !trimmed.is_empty() {
                lines.push(trimmed.to_string());
            }
        }
    }
    if let Some(entry) = current.take() {
        close(&mut map, entry);
    }
    map
}

/// A line opens a field iff its head (before the first `:`) is a known key,
/// tolerating quotes/backticks/bold markers around the key.
fn key_line<'a>(line: &'a str, known_keys: &[&str]) -> Option<(String, &'a str)> {
    let trimmed = line.trim_start();
    let (head, rest) = trimmed.split_once(':')?;
    // Strip quotes/markdown around the key, plus `{` so the first line of
    // truncated JSON (`{"action": ...`) is still recovered.
    let head = head
        .trim()
        .trim_matches(&['"', '\'', '*', '`', '{'][..])
        .trim();
    let key = known_keys.iter().find(|k| head.eq_ignore_ascii_case(k))?;
    Some(((*key).to_string(), rest))
}

fn close(map: &mut Map<String, Value>, entry: (String, Vec<String>, Vec<String>)) {
    let (key, lines, items) = entry;
    if !items.is_empty() {
        map.insert(
            key,
            Value::Array(items.into_iter().map(Value::String).collect()),
        );
        return;
    }
    let joined = lines.join("\n");
    let cleaned = joined.trim().trim_end_matches(',').trim();
    let value = strip_quotes(cleaned);
    if let Some(inner) = value.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
        let items: Vec<Value> = if inner.trim().is_empty() {
            Vec::new()
        } else {
            inner
                .split(',')
                .map(|item| Value::String(strip_quotes(item.trim()).to_string()))
                .collect()
        };
        map.insert(key, Value::Array(items));
    } else {
        map.insert(key, Value::String(value.to_string()));
    }
}

fn strip_quotes(s: &str) -> &str {
    let s = s.trim();
    for quote in ['"', '\''] {
        if s.len() >= 2 && s.starts_with(quote) && s.ends_with(quote) {
            return &s[1..s.len() - 1];
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const KEYS: &[&str] = &["action", "tool", "response", "steps"];

    #[test]
    fn happy_path_fields() {
        let map = decode("action: tool\ntool: search\nresponse: done", KEYS);
        assert_eq!(map["action"], json!("tool"));
        assert_eq!(map["tool"], json!("search"));
        assert_eq!(map["response"], json!("done"));
    }

    #[test]
    fn multiline_value_joins_continuations() {
        let map = decode(
            "response: first line\nsecond line\nnote: still the response",
            KEYS,
        );
        assert_eq!(
            map["response"],
            json!("first line\nsecond line\nnote: still the response")
        );
    }

    #[test]
    fn dash_list_and_inline_list() {
        let map = decode("steps:\n- one\n- two", KEYS);
        assert_eq!(map["steps"], json!(["one", "two"]));
        let map = decode("steps: [a, \"b\"]", KEYS);
        assert_eq!(map["steps"], json!(["a", "b"]));
    }

    #[test]
    fn garbage_yields_empty_map() {
        assert!(decode("no keys here\njust prose", KEYS).is_empty());
        assert!(decode("", KEYS).is_empty());
    }

    #[test]
    fn tolerates_quoted_keys_and_values() {
        // Looks like truncated JSON lines — still recovered.
        let map = decode("\"action\": \"answer\",\n\"response\": \"hi\"", KEYS);
        assert_eq!(map["action"], json!("answer"));
        assert_eq!(map["response"], json!("hi"));
    }

    #[test]
    fn unknown_key_lines_are_continuation_text() {
        let map = decode("response: see https://example.com: port 8080", KEYS);
        assert_eq!(map["response"], json!("see https://example.com: port 8080"));
    }

    #[test]
    fn encode_round_trips_through_decode() {
        let mut fields = Map::new();
        fields.insert("action".into(), json!("tool"));
        fields.insert("steps".into(), json!(["a", "b"]));
        let text = encode(&fields);
        let back = decode(&text, KEYS);
        assert_eq!(back["action"], json!("tool"));
        assert_eq!(back["steps"], json!(["a", "b"]));
    }
}
