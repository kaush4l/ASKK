//! Shared, provider-agnostic HTTP/SSE transport for chat-completions endpoints:
//! base-URL normalization, auth headers, the blocking and streaming request paths,
//! SSE parsing, and human-readable error mapping. Concrete providers (see
//! [`openai`](super::openai)) build their request body and call in here.

use crate::state::{AppResult, ProviderAuthMode, ProviderConfig};
use gloo_net::http::Request;
use serde::Deserialize;
use serde_json::{Value, json};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::{JsCast, JsValue};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_futures::JsFuture;

#[derive(Debug, Deserialize)]
pub(crate) struct ChatResponse {
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

pub(crate) fn normalize_base_url(raw: &str) -> AppResult<String> {
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

pub(crate) fn chat_completions_endpoint(config: &ProviderConfig) -> AppResult<String> {
    endpoint(config, "chat/completions")
}

fn models_endpoint(config: &ProviderConfig) -> AppResult<String> {
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

pub(crate) async fn send_chat_completion(
    config: &ProviderConfig,
    body: Value,
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

#[cfg(target_arch = "wasm32")]
pub(crate) async fn send_chat_completion_stream(
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
pub(crate) async fn send_chat_completion_stream(
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

pub(crate) fn assistant_content(response: ChatResponse) -> AppResult<String> {
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
}
