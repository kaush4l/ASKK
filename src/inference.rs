use crate::responses::{
    ReActResponse, ResponseFormat, StructuredResponse, VerificationCriticResponse,
    response_to_result,
};
use crate::state::{
    AppResult, Message, ProviderAuthMode, ProviderConfig, Skill, ToolSpec, default_soul_prompt,
};
use gloo_net::http::Request;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::{JsCast, JsValue};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_futures::JsFuture;

#[derive(Clone, Debug)]
pub struct InferenceRequest {
    pub agent_name: String,
    pub agent_role: String,
    pub soul: String,
    pub skills: Vec<Skill>,
    pub goal: String,
    pub history: Vec<Message>,
    pub tools: Vec<ToolSpec>,
    pub response_format: ResponseFormat,
}

#[derive(Clone, Debug)]
pub struct InferenceOutput<T> {
    pub raw_text: String,
    pub parsed: T,
}

pub trait InferenceProvider {
    // Part of the provider API; not called by the minimal loop yet.
    #[allow(dead_code)]
    fn provider_name(&self) -> &'static str;

    async fn invoke_react(
        &self,
        config: &ProviderConfig,
        request: InferenceRequest,
    ) -> AppResult<InferenceOutput<ReActResponse>>;

    async fn invoke_react_streaming(
        &self,
        config: &ProviderConfig,
        request: InferenceRequest,
        _on_partial_answer: &mut dyn FnMut(String),
    ) -> AppResult<InferenceOutput<ReActResponse>> {
        self.invoke_react(config, request).await
    }

    // Verification critic. Dormant until the verification loop is wired in.
    #[allow(dead_code)]
    async fn invoke_critic(
        &self,
        config: &ProviderConfig,
        request: InferenceRequest,
    ) -> AppResult<InferenceOutput<VerificationCriticResponse>> {
        let output = self.invoke_react(config, request).await?;
        let parsed = response_to_result::<VerificationCriticResponse>(&output.parsed.response)?;
        Ok(InferenceOutput {
            raw_text: output.raw_text,
            parsed,
        })
    }
}

#[derive(Clone, Debug, Default)]
pub struct OpenAiCompatibleInference;

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: AssistantMessage,
}

#[derive(Debug, Deserialize)]
struct AssistantMessage {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Vec<ModelEntry>,
}

#[derive(Debug, Deserialize)]
struct ModelEntry {
    id: String,
}

#[derive(Debug, Serialize)]
struct WireMessage {
    role: String,
    content: String,
}

impl InferenceProvider for OpenAiCompatibleInference {
    fn provider_name(&self) -> &'static str {
        "openai-compatible"
    }

    async fn invoke_react(
        &self,
        config: &ProviderConfig,
        request: InferenceRequest,
    ) -> AppResult<InferenceOutput<ReActResponse>> {
        let raw_text = self.invoke_text(config, &request).await?;
        let parsed = response_to_result::<ReActResponse>(&raw_text)?;
        Ok(InferenceOutput { raw_text, parsed })
    }

    async fn invoke_react_streaming(
        &self,
        config: &ProviderConfig,
        request: InferenceRequest,
        on_partial_answer: &mut dyn FnMut(String),
    ) -> AppResult<InferenceOutput<ReActResponse>> {
        match self
            .invoke_text_streaming(config, &request, on_partial_answer)
            .await
        {
            Ok(raw_text) => {
                let parsed = response_to_result::<ReActResponse>(&raw_text)?;
                Ok(InferenceOutput { raw_text, parsed })
            }
            Err(_) => self.invoke_react(config, request).await,
        }
    }

    async fn invoke_critic(
        &self,
        config: &ProviderConfig,
        request: InferenceRequest,
    ) -> AppResult<InferenceOutput<VerificationCriticResponse>> {
        let raw_text = self.invoke_critic_text(config, &request).await?;
        let parsed = response_to_result::<VerificationCriticResponse>(&raw_text)?;
        Ok(InferenceOutput { raw_text, parsed })
    }
}

impl OpenAiCompatibleInference {
    async fn invoke_text(
        &self,
        config: &ProviderConfig,
        request: &InferenceRequest,
    ) -> AppResult<String> {
        let messages = self.normalize_messages(request)?;
        let mut body = json!({
            "model": config.model,
            "messages": messages,
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
        });
        if let Some(top_p) = config.top_p {
            body["top_p"] = json!(top_p);
        }

        let parsed = send_chat_completion(config, body).await?;
        assistant_content(parsed)
    }

    async fn invoke_text_streaming(
        &self,
        config: &ProviderConfig,
        request: &InferenceRequest,
        on_partial_answer: &mut dyn FnMut(String),
    ) -> AppResult<String> {
        let messages = self.normalize_messages(request)?;
        let mut body = json!({
            "model": config.model,
            "messages": messages,
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
            "stream": true,
        });
        if let Some(top_p) = config.top_p {
            body["top_p"] = json!(top_p);
        }

        send_chat_completion_stream(config, body, on_partial_answer).await
    }

    #[allow(dead_code)]
    async fn invoke_critic_text(
        &self,
        config: &ProviderConfig,
        request: &InferenceRequest,
    ) -> AppResult<String> {
        let messages = self.normalize_critic_messages(request)?;
        let body = json!({
            "model": config.model,
            "messages": messages,
            "temperature": 0,
            "max_tokens": config.max_tokens.min(700),
        });

        let parsed = send_chat_completion(config, body).await?;
        assistant_content(parsed)
    }

    fn normalize_messages(&self, request: &InferenceRequest) -> AppResult<Vec<WireMessage>> {
        let tool_manifest = serde_json::to_string_pretty(&request.tools)
            .map_err(|err| format!("Unable to serialize tool manifest: {err}"))?;
        let response_instructions = ReActResponse::instructions(request.response_format);
        let soul_prompt = if request.soul.trim().is_empty() {
            default_soul_prompt()
        } else {
            request.soul.trim().to_string()
        };
        let skill_prompt = format_skill_prompt(&request.skills);
        let system = format!(
            r#"{soul_prompt}

You are {agent_name}.

Role:
{agent_role}

You run inside a client-only browser Wasm prototype. The runner is a ReAct loop: each turn you must choose either one tool call or a final answer. If a tool observation is returned in the conversation history, use it to decide the next turn.

Use `action: tool` only when the next best step is to call a compiled tool. Put exactly one invocation in `response`, such as `web_search({{"query":"Dioxus 0.7 signals","count":5}})`.

Use `web_search` when the goal needs current public information, source discovery, or web evidence. Good parameters are `query`, optional `count` from 1 to 10, and optional `country`, `language`, `freshness`, `date_after`, or `date_before`.

Use `action: answer` when you have enough information or when further tool use is unlikely to help.

All tools are precompiled and execute inside the browser or the local ASKK bridge.

Available compiled tools:
{tool_manifest}

Workspace skills:
{skill_prompt}

{response_instructions}"#,
            soul_prompt = soul_prompt,
            agent_name = request.agent_name,
            agent_role = request.agent_role,
            skill_prompt = skill_prompt,
        );

        let mut messages = vec![WireMessage {
            role: "system".to_string(),
            content: system,
        }];
        if request.history.is_empty() {
            // Single-shot fallback: no transcript supplied, send the goal directly.
            messages.push(WireMessage {
                role: "user".to_string(),
                content: format!("Goal: {}", request.goal),
            });
        } else {
            // The engine supplies the full ordered conversation (prior turns, the
            // current query, then this run's ReAct turns).
            messages.extend(request.history.iter().map(history_wire_message));
        }
        Ok(messages)
    }

    #[allow(dead_code)]
    fn normalize_critic_messages(&self, request: &InferenceRequest) -> AppResult<Vec<WireMessage>> {
        let response_instructions =
            VerificationCriticResponse::instructions(request.response_format);
        let soul_prompt = if request.soul.trim().is_empty() {
            default_soul_prompt()
        } else {
            request.soul.trim().to_string()
        };
        let skill_prompt = format_skill_prompt(&request.skills);
        let system = format!(
            r#"{soul_prompt}

You are {agent_name}.

Role:
{agent_role}

You are a verifier. Decide whether the worker result satisfies the user's goal using only the supplied worker result, evidence, and checks. Prefer deterministic evidence. Do not call tools. Return `passed: true` only when the answer is supported by the evidence and no required work remains.

Workspace skills:
{skill_prompt}

{response_instructions}"#,
            soul_prompt = soul_prompt,
            agent_name = request.agent_name,
            agent_role = request.agent_role,
            skill_prompt = skill_prompt,
        );

        let mut messages = vec![
            WireMessage {
                role: "system".to_string(),
                content: system,
            },
            WireMessage {
                role: "user".to_string(),
                content: request.goal.clone(),
            },
        ];
        messages.extend(request.history.iter().map(history_wire_message));
        Ok(messages)
    }
}

fn history_wire_message(message: &Message) -> WireMessage {
    match message.role.as_str() {
        "assistant" => WireMessage {
            role: "assistant".to_string(),
            content: message.content.clone(),
        },
        "tool" => WireMessage {
            role: "user".to_string(),
            content: format!("Tool observation:\n{}", message.content),
        },
        "user" => WireMessage {
            role: "user".to_string(),
            content: message.content.clone(),
        },
        _ => WireMessage {
            role: "user".to_string(),
            content: format!("{}:\n{}", message.role, message.content),
        },
    }
}

fn format_skill_prompt(skills: &[Skill]) -> String {
    let enabled = skills
        .iter()
        .filter(|skill| skill.enabled && !skill.content.trim().is_empty())
        .map(|skill| format!("## {}\n{}", skill.name.trim(), skill.content.trim()))
        .collect::<Vec<_>>();
    if enabled.is_empty() {
        "No workspace skills are enabled.".to_string()
    } else {
        enabled.join("\n\n")
    }
}

pub fn get_implementation(_config: &ProviderConfig) -> OpenAiCompatibleInference {
    OpenAiCompatibleInference
}

pub async fn list_models(config: &ProviderConfig) -> AppResult<Vec<String>> {
    let endpoint = models_endpoint(config)?;
    let mut request = Request::get(&endpoint);
    if let Some(auth_header) = authorization_header(config)? {
        request = request.header("Authorization", &auth_header);
    }

    let response = request
        .send()
        .await
        .map_err(|err| transport_error("model listing", &endpoint, &format!("{err:?}")))?;

    if !response.ok() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unable to read provider error body".to_string());
        return Err(http_status_error("model listing", status, &text));
    }

    let parsed: ModelsResponse = response
        .json()
        .await
        .map_err(|err| format!("Unable to parse model listing response: {err:?}"))?;
    let mut models = parsed
        .data
        .into_iter()
        .map(|model| model.id)
        .filter(|id| !id.trim().is_empty())
        .collect::<Vec<_>>();
    models.sort();
    models.dedup();
    Ok(models)
}

pub async fn test_chat(config: &ProviderConfig) -> AppResult<String> {
    let body = json!({
        "model": config.model,
        "messages": [
            {
                "role": "user",
                "content": "Reply with OK only."
            }
        ],
        "temperature": 0,
        "max_tokens": 8,
    });

    let parsed = send_chat_completion(config, body).await?;
    let text = assistant_content(parsed)?;
    Ok(format!("Test chat succeeded. Assistant returned: {text}"))
}

pub fn normalize_base_url(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Provider base URL is empty.".to_string());
    }
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err(format!(
            "Provider base URL must start with http:// or https://: {trimmed}"
        ));
    }

    let Some((scheme, rest)) = trimmed.split_once("://") else {
        return Err(format!("Provider base URL is invalid: {trimmed}"));
    };
    let Some(host) = rest.split('/').next() else {
        return Err(format!("Provider base URL is invalid: {trimmed}"));
    };
    if host.trim().is_empty() {
        return Err(format!("Provider base URL is missing a host: {trimmed}"));
    }

    let mut normalized = format!("{scheme}://{rest}");
    if normalized.ends_with("/chat/completions") {
        normalized.truncate(normalized.len() - "/chat/completions".len());
    }
    if normalized.ends_with("/models") {
        normalized.truncate(normalized.len() - "/models".len());
    }

    Ok(normalized.trim_end_matches('/').to_string())
}

pub fn chat_completions_endpoint(config: &ProviderConfig) -> AppResult<String> {
    endpoint(config, "chat/completions")
}

pub fn models_endpoint(config: &ProviderConfig) -> AppResult<String> {
    endpoint(config, "models")
}

fn endpoint(config: &ProviderConfig, path: &str) -> AppResult<String> {
    Ok(format!(
        "{}/{}",
        normalize_base_url(&config.base_url)?,
        path
    ))
}

fn authorization_header(config: &ProviderConfig) -> AppResult<Option<String>> {
    match config.auth_mode {
        ProviderAuthMode::Bearer => {
            let key = config.api_key.trim();
            if key.is_empty() {
                return Err(
                    "Provider API key is empty. Enter a bearer token, or set Auth to No auth for local OpenAI-compatible providers."
                        .to_string(),
                );
            }
            Ok(Some(format!("Bearer {key}")))
        }
        ProviderAuthMode::None => Ok(None),
    }
}

async fn send_chat_completion(config: &ProviderConfig, body: Value) -> AppResult<ChatResponse> {
    if config.model.trim().is_empty() {
        return Err(
            "Provider model is empty. Enter a model id or choose one from List Models.".to_string(),
        );
    }

    let endpoint = chat_completions_endpoint(config)?;
    let mut request = Request::post(&endpoint).header("Content-Type", "application/json");
    if let Some(auth_header) = authorization_header(config)? {
        request = request.header("Authorization", &auth_header);
    }

    let response = request
        .body(body.to_string())
        .map_err(|err| format!("Unable to create provider request: {err:?}"))?
        .send()
        .await
        .map_err(|err| transport_error("chat completion", &endpoint, &format!("{err:?}")))?;

    if !response.ok() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unable to read provider error body".to_string());
        return Err(http_status_error("chat completion", status, &text));
    }

    response
        .json()
        .await
        .map_err(|err| format!("Unable to parse provider response: {err:?}"))
}

#[cfg(target_arch = "wasm32")]
async fn send_chat_completion_stream(
    config: &ProviderConfig,
    body: Value,
    on_partial_answer: &mut dyn FnMut(String),
) -> AppResult<String> {
    if config.model.trim().is_empty() {
        return Err(
            "Provider model is empty. Enter a model id or choose one from List Models.".to_string(),
        );
    }

    let endpoint = chat_completions_endpoint(config)?;
    let mut request = Request::post(&endpoint).header("Content-Type", "application/json");
    if let Some(auth_header) = authorization_header(config)? {
        request = request.header("Authorization", &auth_header);
    }

    let response = request
        .body(body.to_string())
        .map_err(|err| format!("Unable to create streaming provider request: {err:?}"))?
        .send()
        .await
        .map_err(|err| {
            transport_error("streaming chat completion", &endpoint, &format!("{err:?}"))
        })?;

    if !response.ok() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unable to read provider error body".to_string());
        return Err(http_status_error(
            "streaming chat completion",
            status,
            &text,
        ));
    }

    let stream = response
        .body()
        .ok_or_else(|| "Provider did not return a streaming response body.".to_string())?;
    let reader = web_sys::ReadableStreamDefaultReader::new(&stream)
        .map_err(js_error("Unable to read provider stream"))?;
    let decoder =
        web_sys::TextDecoder::new().map_err(js_error("Unable to create stream decoder"))?;
    let mut buffer = String::new();
    let mut raw_text = String::new();

    loop {
        let chunk = JsFuture::from(reader.read())
            .await
            .map_err(js_error("Unable to read provider stream chunk"))?;
        let done = js_sys::Reflect::get(&chunk, &JsValue::from_str("done"))
            .ok()
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        if done {
            break;
        }
        let value = js_sys::Reflect::get(&chunk, &JsValue::from_str("value"))
            .map_err(js_error("Provider stream chunk did not contain a value"))?;
        if value.is_undefined() || value.is_null() {
            continue;
        }
        let bytes = js_sys::Uint8Array::new(&value);
        let text = decoder
            .decode_with_js_u8_array(&bytes)
            .map_err(js_error("Unable to decode provider stream chunk"))?
            .replace("\r\n", "\n");
        buffer.push_str(&text);
        if drain_sse_events(&mut buffer, &mut raw_text, on_partial_answer)? {
            break;
        }
    }

    if raw_text.trim().is_empty() {
        return Err("Provider stream ended without assistant content.".to_string());
    }
    Ok(raw_text)
}

#[cfg(not(target_arch = "wasm32"))]
async fn send_chat_completion_stream(
    _config: &ProviderConfig,
    _body: Value,
    _on_partial_answer: &mut dyn FnMut(String),
) -> AppResult<String> {
    Err("Streaming is only available in the browser runtime.".to_string())
}

#[cfg(target_arch = "wasm32")]
fn drain_sse_events(
    buffer: &mut String,
    raw_text: &mut String,
    on_partial_answer: &mut dyn FnMut(String),
) -> AppResult<bool> {
    while let Some(idx) = buffer.find("\n\n") {
        let event = buffer[..idx].to_string();
        buffer.drain(..idx + 2);
        if process_sse_event(&event, raw_text, on_partial_answer)? {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(target_arch = "wasm32")]
fn process_sse_event(
    event: &str,
    raw_text: &mut String,
    on_partial_answer: &mut dyn FnMut(String),
) -> AppResult<bool> {
    for line in event.lines() {
        let line = line.trim_start();
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data == "[DONE]" {
            return Ok(true);
        }
        if let Some(delta) = stream_delta_content(data)? {
            raw_text.push_str(&delta);
            if let Some(partial) = crate::responses::partial_react_answer_text(raw_text) {
                on_partial_answer(partial);
            }
        }
    }
    Ok(false)
}

#[cfg(target_arch = "wasm32")]
fn stream_delta_content(data: &str) -> AppResult<Option<String>> {
    let value = serde_json::from_str::<Value>(data)
        .map_err(|err| format!("Unable to parse provider stream event: {err}"))?;
    Ok(value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| {
            choice
                .get("delta")
                .and_then(|delta| delta.get("content"))
                .or_else(|| {
                    choice
                        .get("message")
                        .and_then(|message| message.get("content"))
                })
        })
        .and_then(Value::as_str)
        .map(str::to_string))
}

#[cfg(target_arch = "wasm32")]
fn js_error(context: &'static str) -> impl FnOnce(JsValue) -> String {
    move |value| {
        let detail = value
            .dyn_ref::<js_sys::Error>()
            .map(|error| error.message().as_string().unwrap_or_default())
            .or_else(|| value.as_string())
            .unwrap_or_else(|| format!("{value:?}"));
        format!("{context}: {detail}")
    }
}

fn assistant_content(response: ChatResponse) -> AppResult<String> {
    response
        .choices
        .first()
        .and_then(|choice| choice.message.content.clone())
        .filter(|content| !content.trim().is_empty())
        .ok_or_else(|| "Provider response did not include assistant content.".to_string())
}

fn transport_error(action: &str, endpoint: &str, raw: &str) -> String {
    format!(
        "Provider {action} request could not reach {endpoint}. Confirm the provider is running and allows this page origin through CORS. If direct localhost or LAN access fails from GitHub Pages, run the ASKK local bridge on the browser machine and use http://127.0.0.1:8874/v1. Browser fetch details: {raw}"
    )
}

fn http_status_error(action: &str, status: u16, body: &str) -> String {
    let body = body.trim();
    let detail = if body.is_empty() {
        "Provider returned an empty error body.".to_string()
    } else {
        format!("Provider error body: {body}")
    };
    let hint = match status {
        401 | 403 => {
            "Authentication failed. Check the API key, or set Auth to No auth for local providers that do not require a token."
        }
        404 => {
            "Endpoint or model was not found. Confirm the base URL includes /v1 and the model id exists."
        }
        400 | 422 if body.to_lowercase().contains("model") => {
            "The provider rejected the model. Use List Models and pick an available id."
        }
        _ => {
            "The provider returned an HTTP error. Check the base URL, model id, request limits, and provider logs."
        }
    };
    format!("Provider {action} returned HTTP {status}. {hint} {detail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(base_url: &str) -> ProviderConfig {
        ProviderConfig {
            base_url: base_url.to_string(),
            model: "test-model".to_string(),
            api_key: "test-key".to_string(),
            auth_mode: ProviderAuthMode::Bearer,
            persist_api_key: false,
            temperature: 0.2,
            max_tokens: 32,
            ..ProviderConfig::default()
        }
    }

    #[test]
    fn normalizes_base_urls() {
        assert_eq!(
            normalize_base_url(" https://api.openai.com/v1/ ").unwrap(),
            "https://api.openai.com/v1"
        );
        assert_eq!(
            normalize_base_url("http://localhost:11434/v1/chat/completions").unwrap(),
            "http://localhost:11434/v1"
        );
        assert_eq!(
            normalize_base_url("http://localhost:1234/v1/models").unwrap(),
            "http://localhost:1234/v1"
        );
    }

    #[test]
    fn rejects_invalid_base_urls() {
        assert!(normalize_base_url("").is_err());
        assert!(normalize_base_url("localhost:11434/v1").is_err());
        assert!(normalize_base_url("https:///v1").is_err());
    }

    #[test]
    fn builds_openai_compatible_endpoints() {
        let config = config("http://localhost:11434/v1/");
        assert_eq!(
            chat_completions_endpoint(&config).unwrap(),
            "http://localhost:11434/v1/chat/completions"
        );
        assert_eq!(
            models_endpoint(&config).unwrap(),
            "http://localhost:11434/v1/models"
        );
    }

    #[test]
    fn auth_header_respects_auth_mode() {
        let mut config = config("http://localhost:1234/v1");
        assert_eq!(
            authorization_header(&config).unwrap(),
            Some("Bearer test-key".to_string())
        );

        config.auth_mode = ProviderAuthMode::None;
        config.api_key.clear();
        assert_eq!(authorization_header(&config).unwrap(), None);

        config.auth_mode = ProviderAuthMode::Bearer;
        assert!(authorization_header(&config).is_err());
    }

    #[test]
    fn agent_calls_include_soul_prompt_before_role() {
        let request = InferenceRequest {
            agent_name: "Planner".to_string(),
            agent_role: "Plan carefully.".to_string(),
            soul: "Shared behavior.".to_string(),
            skills: vec![Skill {
                id: "care".to_string(),
                name: "Care".to_string(),
                content: "Work carefully.".to_string(),
                enabled: true,
                source_path: None,
            }],
            goal: "Ship it.".to_string(),
            history: Vec::new(),
            tools: Vec::new(),
            response_format: ResponseFormat::Toon,
        };

        let messages = OpenAiCompatibleInference
            .normalize_messages(&request)
            .unwrap();
        let system = &messages[0].content;

        assert!(system.starts_with("Shared behavior."));
        assert!(
            system.find("You are Planner.").unwrap() > system.find("Shared behavior.").unwrap()
        );
        assert!(system.contains("Role:\nPlan carefully."));
        assert!(system.contains("## Care\nWork carefully."));
    }

    #[test]
    fn tool_history_is_sent_as_user_context() {
        let request = InferenceRequest {
            agent_name: "Researcher".to_string(),
            agent_role: "Research.".to_string(),
            soul: "Shared behavior.".to_string(),
            skills: Vec::new(),
            goal: "Find current info.".to_string(),
            history: vec![
                Message {
                    role: "assistant".to_string(),
                    content: "response: web_search({\"query\":\"askk\"})".to_string(),
                },
                Message {
                    role: "tool".to_string(),
                    content: "web_search -> {\"success\":true}".to_string(),
                },
            ],
            tools: Vec::new(),
            response_format: ResponseFormat::Toon,
        };

        let messages = OpenAiCompatibleInference
            .normalize_messages(&request)
            .unwrap();
        // With a transcript supplied, the conversation follows the system message
        // directly (no separate "Goal:" turn): system, assistant, tool-as-user.
        assert_eq!(messages[0].role, "system");
        assert_eq!(messages[1].role, "assistant");
        assert_eq!(messages[2].role, "user");
        assert!(messages[2].content.starts_with("Tool observation:\n"));
    }

    #[test]
    fn empty_history_falls_back_to_goal_message() {
        let request = InferenceRequest {
            agent_name: "Planner".to_string(),
            agent_role: "Plan.".to_string(),
            soul: "Shared behavior.".to_string(),
            skills: Vec::new(),
            goal: "Ship it.".to_string(),
            history: Vec::new(),
            tools: Vec::new(),
            response_format: ResponseFormat::Toon,
        };

        let messages = OpenAiCompatibleInference
            .normalize_messages(&request)
            .unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1].role, "user");
        assert_eq!(messages[1].content, "Goal: Ship it.");
    }
}
