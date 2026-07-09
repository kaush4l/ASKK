//! OpenAI-compatible chat/completions adapter. Body building and reply
//! parsing are pure functions; the Transport is injected (ADR-009).

use std::cell::RefCell;
use std::rc::Rc;

use futures::future::LocalBoxFuture;
use serde_json::{json, Value};

use askk_core::contract::OutputMode;
use askk_core::provider::{Provider, ProviderError};
use askk_core::request::{InferenceReply, InferenceRequest, Role, SectionKind, ToolCall, Usage};

use crate::transport::{HttpRequest, HttpResponse, SseAssembler, Transport, TransportError};

pub struct OpenAiCompat {
    id: String,
    base_url: String,
    api_key: String,
    model: String,
    transport: Rc<dyn Transport>,
}

impl OpenAiCompat {
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

pub(crate) fn role_str(role: Role) -> &'static str {
    match role {
        Role::System => "system",
        Role::User => "user",
        Role::Assistant => "assistant",
        Role::Tool => "tool",
    }
}

/// Sections (except user input) become one system message; user-input
/// sections become the trailing user message. The provider maps — it never
/// composes prompt text (ADR-002).
pub(crate) fn split_sections(req: &InferenceRequest) -> (String, Vec<&str>) {
    let mut system = String::new();
    let mut user_inputs = Vec::new();
    for (kind, text) in &req.sections {
        if *kind == SectionKind::UserInput {
            user_inputs.push(text.as_str());
        } else {
            if !system.is_empty() {
                system.push_str("\n\n");
            }
            system.push_str(&format!("## {}\n{}", kind.name(), text));
        }
    }
    (system, user_inputs)
}

/// Pure body builder — golden-tested, no I/O.
pub fn build_body(req: &InferenceRequest, model: &str) -> Value {
    let (system, user_inputs) = split_sections(req);
    let mut messages = Vec::new();
    if !system.is_empty() {
        messages.push(json!({"role": "system", "content": system}));
    }
    for message in &req.history {
        messages.push(json!({"role": role_str(message.role), "content": message.content}));
    }
    for input in user_inputs {
        messages.push(json!({"role": "user", "content": input}));
    }
    let mut body = json!({"model": model, "messages": messages});
    if !req.tools.is_empty() {
        let tools: Vec<Value> = req
            .tools
            .iter()
            .map(|spec| {
                json!({"type": "function", "function": {
                    "name": spec.name,
                    "description": spec.description,
                    "parameters": spec.input_schema,
                }})
            })
            .collect();
        body["tools"] = Value::Array(tools);
    }
    if let Some(temperature) = req.config.temperature {
        body["temperature"] = json!(temperature);
    }
    if let Some(max_tokens) = req.config.max_tokens {
        body["max_tokens"] = json!(max_tokens);
    }
    if req.contract.mode == OutputMode::Json {
        body["response_format"] = json!({"type": "json_object"});
    }
    // Always request SSE; servers that ignore it fall back to the buffered
    // JSON path in `infer`. include_usage puts usage on the final chunk.
    body["stream"] = json!(true);
    body["stream_options"] = json!({"include_usage": true});
    body
}

/// Pure reply parser: content + native tool_calls + usage.
pub fn parse_reply(value: &Value) -> Result<InferenceReply, ProviderError> {
    let message = &value["choices"][0]["message"];
    if message.is_null() {
        return Err(ProviderError::Malformed(
            "reply has no choices[0].message".into(),
        ));
    }
    let text = message["content"].as_str().unwrap_or_default().to_string();
    let mut native_tool_calls = Vec::new();
    if let Some(calls) = message["tool_calls"].as_array() {
        for call in calls {
            let name = call["function"]["name"].as_str().unwrap_or_default();
            let raw_args = call["function"]["arguments"].as_str().unwrap_or("{}");
            native_tool_calls.push(ToolCall {
                id: call["id"].as_str().unwrap_or_default().into(),
                name: name.into(),
                args: serde_json::from_str(raw_args).unwrap_or_else(|_| json!({})),
            });
        }
    }
    Ok(InferenceReply {
        text,
        native_tool_calls,
        usage: parse_usage(&value["usage"], "prompt_tokens", "completion_tokens"),
    })
}

pub(crate) fn parse_usage(value: &Value, in_key: &str, out_key: &str) -> Option<Usage> {
    Some(Usage {
        input_tokens: value[in_key].as_u64()?,
        output_tokens: value[out_key].as_u64().unwrap_or(0),
    })
}

/// HTTP status → typed provider error; hints are actionable (URL/CORS/key).
pub(crate) fn status_to_error(resp: &HttpResponse, base_url: &str) -> Option<ProviderError> {
    match resp.status {
        200..=299 => None,
        401 | 403 => Some(ProviderError::Auth),
        408 | 504 => Some(ProviderError::Timeout),
        429 => Some(ProviderError::RateLimited {
            retry_after_ms: resp
                .header("retry-after")
                .and_then(|v| v.trim().parse::<u64>().ok())
                .map(|secs| secs * 1000),
        }),
        400 | 404 | 422 => Some(ProviderError::BadRequest(resp.body.clone())),
        status => Some(ProviderError::Unreachable {
            hint: format!(
                "HTTP {status} from {base_url}; check the base URL, the API key, \
                 and that the endpoint allows CORS from this origin"
            ),
        }),
    }
}

pub(crate) fn transport_to_error(err: TransportError, base_url: &str) -> ProviderError {
    match err {
        TransportError::Timeout => ProviderError::Timeout,
        TransportError::Connect(message) => ProviderError::Unreachable {
            hint: format!(
                "could not reach {base_url}: {message}; check the base URL, \
                 CORS headers on the endpoint, and the API key"
            ),
        },
    }
}

/// Streamed reply accumulator: content deltas pass through `on_delta` as
/// they arrive; tool_call deltas merge by index (id/name land once,
/// arguments concatenate); usage rides the final chunk.
#[derive(Default)]
pub(crate) struct StreamAcc {
    pub saw_event: bool,
    text: String,
    usage: Option<Usage>,
    calls: Vec<PartialCall>,
}

#[derive(Default)]
struct PartialCall {
    id: String,
    name: String,
    args: String,
}

impl StreamAcc {
    pub(crate) fn absorb(&mut self, data: &str, on_delta: &mut dyn FnMut(&str)) {
        if data == "[DONE]" {
            self.saw_event = true;
            return;
        }
        let Ok(value) = serde_json::from_str::<Value>(data) else {
            return; // tolerate keepalives / partial junk
        };
        self.saw_event = true;
        let delta = &value["choices"][0]["delta"];
        if let Some(chunk) = delta["content"].as_str() {
            if !chunk.is_empty() {
                self.text.push_str(chunk);
                on_delta(chunk);
            }
        }
        if let Some(calls) = delta["tool_calls"].as_array() {
            for call in calls {
                let index = call["index"].as_u64().unwrap_or(0) as usize;
                while self.calls.len() <= index {
                    self.calls.push(PartialCall::default());
                }
                let slot = &mut self.calls[index];
                if let Some(id) = call["id"].as_str() {
                    if !id.is_empty() {
                        slot.id = id.into();
                    }
                }
                if let Some(name) = call["function"]["name"].as_str() {
                    if !name.is_empty() {
                        slot.name = name.into();
                    }
                }
                if let Some(args) = call["function"]["arguments"].as_str() {
                    slot.args.push_str(args);
                }
            }
        }
        if let Some(u) = parse_usage(&value["usage"], "prompt_tokens", "completion_tokens") {
            self.usage = Some(u);
        }
    }

    pub(crate) fn into_reply(self) -> InferenceReply {
        InferenceReply {
            text: self.text,
            native_tool_calls: self
                .calls
                .into_iter()
                .filter(|c| !c.name.is_empty())
                .map(|c| ToolCall {
                    id: c.id,
                    name: c.name,
                    args: serde_json::from_str(&c.args).unwrap_or_else(|_| json!({})),
                })
                .collect(),
            usage: self.usage,
        }
    }
}

impl Provider for OpenAiCompat {
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
                url: format!("{}/chat/completions", self.base_url),
                headers: vec![
                    ("content-type".into(), "application/json".into()),
                    ("authorization".into(), format!("Bearer {}", self.api_key)),
                ],
                body: build_body(req, &self.model).to_string(),
            };
            // Deltas hit `on_delta` live as chunks arrive off the wire.
            let assembler = RefCell::new(SseAssembler::new());
            let acc = RefCell::new(StreamAcc::default());
            let deltas = RefCell::new(on_delta);
            let mut on_chunk = |chunk: &str| {
                let mut acc = acc.borrow_mut();
                let mut cb = deltas.borrow_mut();
                for event in assembler.borrow_mut().feed(chunk) {
                    acc.absorb(&event.data, &mut **cb);
                }
            };
            let resp = self
                .transport
                .send_stream(http, &mut on_chunk)
                .await
                .map_err(|e| transport_to_error(e, &self.base_url))?;
            if let Some(err) = status_to_error(&resp, &self.base_url) {
                return Err(err);
            }
            for event in assembler.borrow_mut().finish() {
                acc.borrow_mut()
                    .absorb(&event.data, &mut **deltas.borrow_mut());
            }
            let acc = acc.into_inner();
            if acc.saw_event {
                return Ok(acc.into_reply());
            }
            // Server ignored stream:true and sent one buffered JSON reply.
            let value: Value = serde_json::from_str(&resp.body)
                .map_err(|e| ProviderError::Malformed(e.to_string()))?;
            let reply = parse_reply(&value)?;
            if !reply.text.is_empty() {
                (**deltas.borrow_mut())(&reply.text); // one delta, full text
            }
            Ok(reply)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::MockTransport;
    use askk_core::request::{InferenceConfig, Message};
    use askk_core::tool::{Effect, ToolSpec};
    use futures::executor::block_on;

    fn request() -> InferenceRequest {
        InferenceRequest {
            sections: vec![
                (SectionKind::Identity, "You are X.".into()),
                (SectionKind::UserInput, "hello".into()),
            ],
            history: vec![Message::new(Role::Assistant, "earlier")],
            tools: vec![ToolSpec {
                name: "read".into(),
                description: "read a file".into(),
                input_schema: json!({"type": "object"}),
                effect: Effect::Pure,
            }],
            config: InferenceConfig {
                temperature: Some(0.5),
                max_tokens: Some(100),
                ..Default::default()
            },
            ..Default::default()
        }
    }

    #[test]
    fn build_body_golden() {
        let body = build_body(&request(), "gpt-4o-mini");
        assert_eq!(body["model"], "gpt-4o-mini");
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0]["role"], "system");
        assert!(messages[0]["content"]
            .as_str()
            .unwrap()
            .contains("## identity\nYou are X."));
        assert_eq!(messages[1]["role"], "assistant");
        assert_eq!(messages[2], json!({"role": "user", "content": "hello"}));
        assert_eq!(body["tools"][0]["function"]["name"], "read");
        assert_eq!(body["temperature"], 0.5);
        assert_eq!(body["max_tokens"], 100);
        assert!(body.get("response_format").is_none());
        assert_eq!(body["stream"], true);
        assert_eq!(body["stream_options"]["include_usage"], true);
    }

    #[test]
    fn json_mode_sets_response_format() {
        let mut req = request();
        req.contract.mode = OutputMode::Json;
        let body = build_body(&req, "m");
        assert_eq!(body["response_format"]["type"], "json_object");
    }

    #[test]
    fn parse_reply_content_tool_calls_and_usage() {
        let fixture = json!({
            "choices": [{"message": {
                "content": "thinking...",
                "tool_calls": [{"id": "c1", "type": "function",
                    "function": {"name": "read", "arguments": "{\"path\": \"x\"}"}}]
            }}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5}
        });
        let reply = parse_reply(&fixture).unwrap();
        assert_eq!(reply.text, "thinking...");
        assert_eq!(reply.native_tool_calls[0].name, "read");
        assert_eq!(reply.native_tool_calls[0].args, json!({"path": "x"}));
        assert_eq!(reply.usage.unwrap().input_tokens, 10);
    }

    #[test]
    fn parse_reply_without_choices_is_malformed() {
        assert!(matches!(
            parse_reply(&json!({"error": "x"})),
            Err(ProviderError::Malformed(_))
        ));
    }

    fn provider_with(status: u16, body: &str) -> (OpenAiCompat, Rc<MockTransport>) {
        let transport = Rc::new(MockTransport::new());
        transport.push_ok(status, body);
        let provider = OpenAiCompat::new(
            "openai/gpt-4o-mini",
            "https://api.openai.com/v1/",
            "sk-test",
            "gpt-4o-mini",
            transport.clone(),
        );
        (provider, transport)
    }

    #[test]
    fn infer_maps_status_errors() {
        let (provider, _) = provider_with(401, "");
        let err = block_on(provider.infer(&request(), &mut |_| {})).unwrap_err();
        assert_eq!(err, ProviderError::Auth);

        let transport = Rc::new(MockTransport::new());
        transport.push(Ok(HttpResponse {
            status: 429,
            headers: vec![("retry-after".into(), "2".into())],
            body: String::new(),
        }));
        let provider = OpenAiCompat::new("openai/m", "http://x", "k", "m", transport);
        let err = block_on(provider.infer(&request(), &mut |_| {})).unwrap_err();
        assert_eq!(
            err,
            ProviderError::RateLimited {
                retry_after_ms: Some(2000)
            }
        );
    }

    #[test]
    fn connect_failure_hints_at_url_cors_key() {
        let transport = Rc::new(MockTransport::new());
        transport.push(Err(TransportError::Connect("refused".into())));
        let provider = OpenAiCompat::new("openai/m", "http://localhost:1234", "k", "m", transport);
        match block_on(provider.infer(&request(), &mut |_| {})).unwrap_err() {
            ProviderError::Unreachable { hint } => {
                assert!(hint.contains("http://localhost:1234"));
                assert!(hint.contains("CORS"));
                assert!(hint.contains("key"));
            }
            other => panic!("expected Unreachable, got {other}"),
        }
        let transport = Rc::new(MockTransport::new());
        transport.push(Err(TransportError::Timeout));
        let provider = OpenAiCompat::new("openai/m", "http://x", "k", "m", transport);
        let err = block_on(provider.infer(&request(), &mut |_| {})).unwrap_err();
        assert_eq!(err, ProviderError::Timeout);
    }

    #[test]
    fn infer_posts_to_chat_completions_with_bearer() {
        let (provider, transport) =
            provider_with(200, r#"{"choices": [{"message": {"content": "hi"}}]}"#);
        let mut deltas = String::new();
        let reply = block_on(provider.infer(&request(), &mut |d| deltas.push_str(d))).unwrap();
        assert_eq!(reply.text, "hi");
        assert_eq!(deltas, "hi"); // non-streaming: one delta with full text
        let sent = transport.requests.borrow();
        assert_eq!(sent[0].url, "https://api.openai.com/v1/chat/completions");
        assert!(sent[0]
            .headers
            .iter()
            .any(|(k, v)| k == "authorization" && v == "Bearer sk-test"));
    }

    #[test]
    fn sse_stream_body_assembles_and_streams_deltas() {
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"he\"}}]}\n\n\
                   data: {\"choices\":[{\"delta\":{\"content\":\"llo\"}}],\
                   \"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2}}\n\n\
                   data: [DONE]\n\n";
        let (provider, _) = provider_with(200, sse);
        let mut deltas = Vec::new();
        let reply =
            block_on(provider.infer(&request(), &mut |d| deltas.push(d.to_string()))).unwrap();
        assert_eq!(reply.text, "hello");
        assert_eq!(deltas, vec!["he", "llo"]);
        assert_eq!(reply.usage.unwrap().output_tokens, 2);
    }

    #[test]
    fn streamed_tool_call_deltas_assemble_by_index() {
        let sse = concat!(
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"c1\",",
            "\"function\":{\"name\":\"read\",\"arguments\":\"{\\\"pa\"}}]}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,",
            "\"function\":{\"arguments\":\"th\\\": \\\"x\\\"}\"}}]}}]}\n\n",
            "data: [DONE]\n\n"
        );
        let (provider, _) = provider_with(200, sse);
        let reply = block_on(provider.infer(&request(), &mut |_| {})).unwrap();
        assert_eq!(reply.native_tool_calls.len(), 1);
        assert_eq!(reply.native_tool_calls[0].id, "c1");
        assert_eq!(reply.native_tool_calls[0].name, "read");
        assert_eq!(reply.native_tool_calls[0].args, json!({"path": "x"}));
    }

    #[test]
    fn stream_without_trailing_blank_line_still_lands_via_finish() {
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"tail\"}}]}";
        let (provider, _) = provider_with(200, sse);
        let mut deltas = Vec::new();
        let reply =
            block_on(provider.infer(&request(), &mut |d| deltas.push(d.to_string()))).unwrap();
        assert_eq!(reply.text, "tail");
        assert_eq!(deltas, vec!["tail"]);
    }
}
