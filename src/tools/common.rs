//! Pure helpers shared across tool modules: argument extraction from a JSON `Value`
//! and a char-safe truncation. Kept free of I/O so they are trivially host-testable.

use crate::state::AppResult;
use serde_json::Value;

/// Read a required, non-empty string argument, or return a clear error naming the key.
pub(crate) fn string_arg(args: &Value, key: &str) -> AppResult<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("Missing required string argument `{key}`"))
}

/// Read an optional integer argument, accepting either a JSON number or a numeric
/// string (models often emit `"count":"5"`).
pub(crate) fn integer_arg(args: &Value, key: &str) -> Option<i64> {
    args.get(key).and_then(|value| {
        value
            .as_i64()
            .or_else(|| value.as_str().and_then(|text| text.parse::<i64>().ok()))
    })
}

/// Copy `key` from `args` (or `fallback`) into `body` as a trimmed string when present.
pub(crate) fn merge_optional_string(
    args: &Value,
    body: &mut Value,
    key: &str,
    fallback: Option<&str>,
) {
    let value = args
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .or_else(|| fallback.map(str::trim));
    if let Some(value) = value {
        body[key] = Value::String(value.to_string());
    }
}

/// Truncate to at most `max_chars` characters (not bytes), appending an ellipsis.
pub(crate) fn truncate(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut output = value.chars().take(max_chars).collect::<String>();
    output.push_str("...");
    output
}
