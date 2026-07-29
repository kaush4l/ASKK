//! OpenAI-compatible wire format: the request-body writer and reply reader.
//!
//! PROVISIONAL (G4 discovery): the G3 freeze said "the exact JSON shape per
//! provider is serialization detail applied when the request body is
//! written" but gave that writer no home. It lives here because provider
//! quirks live only in `context` (§8.1); `core::execute_effect` calls these
//! and `ModelPort` moves the bytes without interpreting them.

use serde_json::{json, Value};

use crate::render::{ContentPart, Message, Role};

fn role_str(role: Role) -> &'static str {
    match role {
        Role::System => "system",
        Role::User => "user",
        Role::Assistant => "assistant",
    }
}

/// One neutral part → the OpenAI content-part union.
fn part_json(p: &ContentPart) -> Value {
    match p {
        ContentPart::Text { text } => json!({"type": "text", "text": text}),
        ContentPart::Image {
            media_type,
            data_base64,
        } => json!({"type": "image_url",
            "image_url": {"url": format!("data:{media_type};base64,{data_base64}")}}),
        ContentPart::Audio {
            media_type,
            data_base64,
        } => json!({"type": "input_audio", "input_audio": {"data": data_base64,
            "format": media_type.split('/').next_back().unwrap_or("wav")}}),
        ContentPart::File {
            name,
            media_type,
            data_base64,
        } => json!({"type": "file", "file": {"filename": name,
            "file_data": format!("data:{media_type};base64,{data_base64}")}}),
    }
}

/// The `/v1/chat/completions` request body. Text-only messages collapse to
/// plain string content (widest local-server compatibility); mixed content
/// uses the array form. `stream: false` — streaming is core-driven chaining
/// over completed replies (ADR-002), not SSE.
pub fn openai_request_body(messages: &[Message], model: &str) -> String {
    let msgs: Vec<Value> = messages
        .iter()
        .map(|m| {
            let all_text = m
                .content
                .iter()
                .all(|p| matches!(p, ContentPart::Text { .. }));
            let content: Value = if all_text {
                m.content
                    .iter()
                    .map(|p| match p {
                        ContentPart::Text { text } => text.as_str(),
                        _ => unreachable!(),
                    })
                    .collect::<Vec<_>>()
                    .join("")
                    .into()
            } else {
                Value::Array(m.content.iter().map(part_json).collect())
            };
            json!({"role": role_str(m.role), "content": content})
        })
        .collect();
    json!({"model": model, "stream": false, "messages": msgs}).to_string()
}

/// Extract the assistant text from a chat-completion reply body. `None` when
/// the body isn't a recognizable completion — the caller surfaces that as a
/// typed model error, never a fake reply.
pub fn openai_reply_text(body_json: &str) -> Option<String> {
    let v: Value = serde_json::from_str(body_json).ok()?;
    let content = v.get("choices")?.get(0)?.get("message")?.get("content")?;
    match content {
        Value::String(s) => Some(s.clone()),
        Value::Array(parts) => Some(
            parts
                .iter()
                .filter_map(|p| p.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join(""),
        ),
        _ => None,
    }
}
