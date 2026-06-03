use crate::responses::{response_to_result, ReActResponse, ResponseFormat, StructuredResponse};
use crate::state::{AppResult, Message, ProviderConfig, ToolSpec};
use gloo_net::http::Request;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Clone, Debug)]
pub struct InferenceRequest {
    pub agent_name: String,
    pub agent_role: String,
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
    fn provider_name(&self) -> &'static str;

    async fn invoke_react(
        &self,
        config: &ProviderConfig,
        request: InferenceRequest,
    ) -> AppResult<InferenceOutput<ReActResponse>>;
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
}

impl OpenAiCompatibleInference {
    async fn invoke_text(
        &self,
        config: &ProviderConfig,
        request: &InferenceRequest,
    ) -> AppResult<String> {
        if config.api_key.trim().is_empty() {
            return Err(
                "Provider API key is empty. Enter a prototype/testing key in Provider Settings."
                    .to_string(),
            );
        }

        let endpoint = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
        let messages = self.normalize_messages(request)?;
        let body = json!({
            "model": config.model,
            "messages": messages,
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
        });

        let response = Request::post(&endpoint)
            .header("Authorization", &format!("Bearer {}", config.api_key))
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .map_err(|err| format!("Unable to create provider request: {err:?}"))?
            .send()
            .await
            .map_err(|err| format!("Provider request failed: {err:?}"))?;

        if !response.ok() {
            let status = response.status();
            let text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read provider error body".to_string());
            return Err(format!("Provider returned HTTP {status}: {text}"));
        }

        let parsed: ChatResponse = response
            .json()
            .await
            .map_err(|err| format!("Unable to parse provider response: {err:?}"))?;

        parsed
            .choices
            .first()
            .and_then(|choice| choice.message.content.clone())
            .filter(|content| !content.trim().is_empty())
            .ok_or_else(|| "Provider response did not include assistant content.".to_string())
    }

    fn normalize_messages(&self, request: &InferenceRequest) -> AppResult<Vec<WireMessage>> {
        let tool_manifest = serde_json::to_string_pretty(&request.tools)
            .map_err(|err| format!("Unable to serialize tool manifest: {err}"))?;
        let response_instructions = ReActResponse::instructions(request.response_format);
        let system = format!(
            r#"You are {agent_name}.

Role:
{agent_role}

You run inside a client-only browser Wasm prototype. All tools are precompiled and execute inside the browser.

Available compiled tools:
{tool_manifest}

{response_instructions}"#,
            agent_name = request.agent_name,
            agent_role = request.agent_role,
        );

        let mut messages = vec![
            WireMessage {
                role: "system".to_string(),
                content: system,
            },
            WireMessage {
                role: "user".to_string(),
                content: format!("Goal: {}", request.goal),
            },
        ];
        messages.extend(request.history.iter().map(|message| WireMessage {
            role: message.role.clone(),
            content: message.content.clone(),
        }));
        Ok(messages)
    }
}

pub fn get_implementation(_config: &ProviderConfig) -> OpenAiCompatibleInference {
    OpenAiCompatibleInference
}
