//! Anthropic Messages API adapter: system string, messages, tools with
//! input_schema, tool_use blocks → native tool calls.

use std::rc::Rc;

use futures::future::LocalBoxFuture;
use serde_json::{json, Value};

use askk_core::provider::{Provider, ProviderError};
use askk_core::request::{InferenceReply, InferenceRequest, Role, ToolCall};

use crate::openai_compat::{parse_usage, split_sections, status_to_error, transport_to_error};
use crate::transport::{HttpRequest, Transport};

pub const ANTHROPIC_VERSION: &str = "2023-06-01";
const DEFAULT_MAX_TOKENS: u32 = 1024; // the API requires max_tokens

pub struct Anthropic {
    id: String,
    base_url: String,
    api_key: String,
    model: String,
    transport: Rc<dyn Transport>,
}

impl Anthropic {
    pub fn new(
        id: &str,
        base_url: &str,
        api_key: &str,
        model: &str,
        transport: Rc<dyn Transport>,
    ) -> Self {
        Self {
            id: id.into(),
            base_url: base_url.trim_end_matches('/').into(),
            api_key: api_key.into(),
            model: model.into(),
            transport,
        }
    }
}

/// Pure body builder. Anthropic only has user/assistant roles, so tool and
/// system history map to user turns; user-input sections close the message
/// list. Multimodal parts are dropped here.
// ponytail: image blocks + SSE streaming deferred until the web transport
// lands; openai_compat::assemble_stream is the pattern to copy.
pub fn build_body(req: &InferenceRequest, model: &str) -> Value {
    let (system, user_inputs) = split_sections(req);
    let mut messages = Vec::new();
    for message in &req.history {
        let role = match message.role {
            Role::Assistant => "assistant",
            Role::User | Role::System | Role::Tool => "user",
        };
        messages.push(json!({"role": role, "content": message.content}));
    }
    for input in user_inputs {
        messages.push(json!({"role": "user", "content": input}));
    }
    let mut body = json!({
        "model": model,
        "max_tokens": req.config.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS),
        "messages": messages,
    });
    if !system.is_empty() {
        body["system"] = json!(system);
    }
    if let Some(temperature) = req.config.temperature {
        body["temperature"] = json!(temperature);
    }
    if !req.tools.is_empty() {
        let tools: Vec<Value> = req
            .tools
            .iter()
            .map(|spec| {
                json!({
                    "name": spec.name,
                    "description": spec.description,
                    "input_schema": spec.input_schema,
                })
            })
            .collect();
        body["tools"] = Value::Array(tools);
    }
    body
}

/// Pure reply parser: text blocks concatenate; tool_use blocks become
/// native tool calls.
pub fn parse_reply(value: &Value) -> Result<InferenceReply, ProviderError> {
    let Some(blocks) = value["content"].as_array() else {
        return Err(ProviderError::Malformed(
            "reply has no content array".into(),
        ));
    };
    let mut text = String::new();
    let mut native_tool_calls = Vec::new();
    for block in blocks {
        match block["type"].as_str() {
            Some("text") => text.push_str(block["text"].as_str().unwrap_or_default()),
            Some("tool_use") => native_tool_calls.push(ToolCall {
                id: block["id"].as_str().unwrap_or_default().into(),
                name: block["name"].as_str().unwrap_or_default().into(),
                args: block["input"].clone(),
            }),
            _ => {}
        }
    }
    Ok(InferenceReply {
        text,
        native_tool_calls,
        usage: parse_usage(&value["usage"], "input_tokens", "output_tokens"),
    })
}

impl Provider for Anthropic {
    fn id(&self) -> &str {
        &self.id
    }

    fn infer<'a>(
        &'a self,
        req: &'a InferenceRequest,
        on_delta: &'a mut dyn FnMut(&str),
    ) -> LocalBoxFuture<'a, Result<InferenceReply, ProviderError>> {
        Box::pin(async move {
            let http = HttpRequest {
                method: "POST".into(),
                url: format!("{}/v1/messages", self.base_url),
                headers: vec![
                    ("content-type".into(), "application/json".into()),
                    ("x-api-key".into(), self.api_key.clone()),
                    ("anthropic-version".into(), ANTHROPIC_VERSION.into()),
                ],
                body: build_body(req, &self.model).to_string(),
            };
            let resp = self
                .transport
                .send(http)
                .await
                .map_err(|e| transport_to_error(e, &self.base_url))?;
            if let Some(err) = status_to_error(&resp, &self.base_url) {
                return Err(err);
            }
            let value: Value = serde_json::from_str(&resp.body)
                .map_err(|e| ProviderError::Malformed(e.to_string()))?;
            let reply = parse_reply(&value)?;
            if !reply.text.is_empty() {
                on_delta(&reply.text); // non-streaming: one delta, full text
            }
            Ok(reply)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::MockTransport;
    use askk_core::request::{InferenceConfig, Message, SectionKind};
    use askk_core::tool::{Effect, ToolSpec};
    use futures::executor::block_on;

    fn request() -> InferenceRequest {
        InferenceRequest {
            sections: vec![
                (SectionKind::Identity, "You are X.".into()),
                (SectionKind::UserInput, "hello".into()),
            ],
            history: vec![
                Message::new(Role::Tool, "observation"),
                Message::new(Role::Assistant, "earlier"),
            ],
            tools: vec![ToolSpec {
                name: "read".into(),
                description: "read a file".into(),
                input_schema: json!({"type": "object"}),
                effect: Effect::Pure,
            }],
            config: InferenceConfig {
                max_tokens: Some(2048),
                temperature: Some(0.5), // exactly representable as f32
                ..Default::default()
            },
            ..Default::default()
        }
    }

    #[test]
    fn build_body_golden() {
        let body = build_body(&request(), "claude-sonnet-4-5");
        assert_eq!(body["model"], "claude-sonnet-4-5");
        assert_eq!(body["max_tokens"], 2048);
        assert!(body["system"].as_str().unwrap().contains("You are X."));
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages[0]["role"], "user"); // tool role mapped down
        assert_eq!(messages[1]["role"], "assistant");
        assert_eq!(messages[2], json!({"role": "user", "content": "hello"}));
        assert_eq!(body["tools"][0]["input_schema"]["type"], "object");
        assert_eq!(body["temperature"], 0.5);
    }

    #[test]
    fn max_tokens_defaults_when_unset() {
        let mut req = request();
        req.config.max_tokens = None;
        assert_eq!(build_body(&req, "m")["max_tokens"], DEFAULT_MAX_TOKENS);
    }

    #[test]
    fn parse_reply_text_and_tool_use_blocks() {
        let fixture = json!({
            "content": [
                {"type": "text", "text": "let me check. "},
                {"type": "tool_use", "id": "tu_1", "name": "read",
                 "input": {"path": "x.rs"}},
                {"type": "text", "text": "done."}
            ],
            "usage": {"input_tokens": 7, "output_tokens": 3}
        });
        let reply = parse_reply(&fixture).unwrap();
        assert_eq!(reply.text, "let me check. done.");
        assert_eq!(reply.native_tool_calls[0].id, "tu_1");
        assert_eq!(reply.native_tool_calls[0].args, json!({"path": "x.rs"}));
        assert_eq!(reply.usage.unwrap().output_tokens, 3);
    }

    #[test]
    fn parse_reply_without_content_is_malformed() {
        assert!(matches!(
            parse_reply(&json!({"type": "error"})),
            Err(ProviderError::Malformed(_))
        ));
    }

    #[test]
    fn infer_sends_anthropic_headers_and_maps_auth() {
        let transport = Rc::new(MockTransport::new());
        transport.push_ok(200, r#"{"content": [{"type": "text", "text": "hi"}]}"#);
        let provider = Anthropic::new(
            "anthropic/claude-sonnet-4-5",
            "https://api.anthropic.com",
            "sk-ant",
            "claude-sonnet-4-5",
            transport.clone(),
        );
        let mut deltas = String::new();
        let reply = block_on(provider.infer(&request(), &mut |d| deltas.push_str(d))).unwrap();
        assert_eq!(reply.text, "hi");
        assert_eq!(deltas, "hi");
        {
            // scope the borrow: the next infer needs to record its request
            let sent = transport.requests.borrow();
            assert_eq!(sent[0].url, "https://api.anthropic.com/v1/messages");
            assert!(sent[0]
                .headers
                .iter()
                .any(|(k, v)| k == "x-api-key" && v == "sk-ant"));
            assert!(sent[0]
                .headers
                .iter()
                .any(|(k, v)| k == "anthropic-version" && v == ANTHROPIC_VERSION));
        }

        transport.push_ok(401, "");
        let err = block_on(provider.infer(&request(), &mut |_| {})).unwrap_err();
        assert_eq!(err, ProviderError::Auth);
    }
}
