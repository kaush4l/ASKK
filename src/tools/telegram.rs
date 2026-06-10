//! `telegram_send` — send a Telegram message via the Bot API.
//!
//! Requires `confirmed: true` as an explicit approval gate. The agent must
//! always show the text to the user and receive approval before calling with
//! `confirmed=true`. This enforces CLAUDE.md invariant 7 (every outbound write
//! passes an approval gate).

use crate::state::AppSnapshot;
use crate::tools::common::string_arg;
use crate::tools::{ToolDescriptor, ToolFuture, ToolSpec};
use serde_json::{Value, json};

pub(crate) fn descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: ToolSpec {
            name: "telegram_send".into(),
            description: "Send a Telegram message. IMPORTANT: always show the text to the user \
                           and ask for approval before calling with confirmed=true. \
                           Requires bot_token and chat_id on the Tools page."
                .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "text":      { "type": "string",  "description": "Message text (Markdown OK)" },
                    "confirmed": { "type": "boolean", "description": "Must be true to actually send" }
                },
                "required": ["text"]
            }),
        },
        handler: handle,
    }
}

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
/// Parse the Telegram Bot API sendMessage response.
pub(crate) fn parse_send_result(json: &Value) -> Result<String, String> {
    if json.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        let id = json
            .pointer("/result/message_id")
            .and_then(Value::as_u64)
            .map(|n| n.to_string())
            .unwrap_or_else(|| "?".into());
        Ok(format!("Sent (message_id: {id})."))
    } else {
        let desc = json
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        Err(format!("Telegram error: {desc}"))
    }
}

fn handle<'a>(snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let text = string_arg(args, "text")?;
        let confirmed = args
            .get("confirmed")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !confirmed {
            return Ok(format!(
                "PREVIEW (not sent): \"{text}\"\nCall again with confirmed=true to send."
            ));
        }
        let bot_token = snapshot.tool_config.telegram.bot_token.clone();
        let chat_id = snapshot.tool_config.telegram.chat_id.clone();
        if bot_token.is_empty() {
            return Err("Telegram bot_token not configured. Add it on the Tools page.".into());
        }
        if chat_id.is_empty() {
            return Err("Telegram chat_id not configured. Add it on the Tools page.".into());
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = (&bot_token, &chat_id, &text);
            Err("telegram_send requires the browser (WASM).".into())
        }
        #[cfg(target_arch = "wasm32")]
        {
            use gloo_net::http::Request;
            let url = format!("https://api.telegram.org/bot{bot_token}/sendMessage");
            let body = json!({
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "Markdown"
            });
            let resp = Request::post(&url)
                .header("Content-Type", "application/json")
                .body(body.to_string())
                .map_err(|e| format!("Telegram build: {e}"))?
                .send()
                .await
                .map_err(|e| format!("Telegram send: {e}"))?;
            let j: Value = resp
                .json()
                .await
                .map_err(|e| format!("Telegram parse: {e}"))?;
            parse_send_result(&j)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ok_response() {
        let json: Value =
            serde_json::from_str(r#"{"ok":true,"result":{"message_id":42}}"#).unwrap();
        assert!(parse_send_result(&json).unwrap().contains("42"));
    }

    #[test]
    fn parse_error_response() {
        let json: Value =
            serde_json::from_str(r#"{"ok":false,"description":"chat not found"}"#).unwrap();
        assert!(
            parse_send_result(&json)
                .unwrap_err()
                .contains("chat not found")
        );
    }
}
