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
    let message = v.get("choices")?.get(0)?.get("message")?;
    let text = match message.get("content") {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Array(parts)) => Some(
            parts
                .iter()
                .filter_map(|p| p.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join(""),
        ),
        _ => None,
    };
    match text.filter(|t| !t.trim().is_empty()) {
        Some(text) => Some(text),
        // A reply with NO content but native `tool_calls`. This build asks for
        // calls as text (the Python's layout rule is a text rule), but a
        // provider may answer in its own tool-call shape anyway — omlx does,
        // for a prompt whose affordances mention tools. Reading that as "no
        // reply" would discard a call the model really made and stall the turn
        // on "unrecognizable completion body". Rendered into the ONE call
        // syntax the parser reads, so nothing downstream learns a second one.
        None => native_calls(message),
    }
}

/// `tool_calls` as the text this build's parser already understands: one call
/// per line, which is also the layout rule's "these run in order".
fn native_calls(message: &Value) -> Option<String> {
    let calls = message.get("tool_calls")?.as_array()?;
    let lines: Vec<String> = calls
        .iter()
        .filter_map(|call| {
            let f = call.get("function")?;
            // Providers namespace the name (`tools:list_agents`); the toolbox
            // knows the bare one, and an unknown tool is refused in words.
            let name = f.get("name")?.as_str()?.rsplit(':').next()?;
            let args = match f.get("arguments") {
                Some(Value::String(s)) if !s.trim().is_empty() => s.trim().to_string(),
                Some(Value::Object(o)) => Value::Object(o.clone()).to_string(),
                _ => "{}".to_string(),
            };
            Some(format!("{name}({args})"))
        })
        .collect();
    match lines.is_empty() {
        true => None,
        false => Some(lines.join("\n")),
    }
}
