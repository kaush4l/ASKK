use crate::responses::{response_to_result, ReActResponse, ResponseFormat, StructuredResponse};
use crate::state::{
    default_soul_prompt, AppResult, Message, ProviderAuthMode, ProviderConfig, Skill, ToolSpec,
};
use gloo_net::http::Request;
use serde::{Deserialize, Serialize};
use serde_json::json;

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
}

impl OpenAiCompatibleInference {
    async fn invoke_text(
        &self,
        config: &ProviderConfig,
        request: &InferenceRequest,
    ) -> AppResult<String> {
        let messages = self.normalize_messages(request)?;
        let body = json!({
            "model": config.model,
            "messages": messages,
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
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

You run inside a client-only browser Wasm prototype. All tools are precompiled and execute inside the browser.

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

async fn send_chat_completion(
    config: &ProviderConfig,
    body: serde_json::Value,
) -> AppResult<ChatResponse> {
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
}
