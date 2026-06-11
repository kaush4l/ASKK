//! The in-browser provider: Gemma 4 running locally via the vendored
//! transformers.js runtime (`capabilities::local_ai`), no network call and no
//! API key. Selected with a `local/...` model identifier — e.g. `local/e2b`,
//! `local/e4b`, or a full ONNX repo id like
//! `local/onnx-community/gemma-4-E2B-it-ONNX`.
//!
//! Generation must reach the page thread (the runtime lives there), so the
//! call goes through [`crate::worker::page_proxy::run_page_op`] and works from
//! both inline and worker-hosted runs. Streaming falls back to the trait's
//! non-streaming default for now — the runtime streams deltas, but they are
//! not yet forwarded across the page-op channel.

use serde_json::json;

use super::{InferenceOutput, InferenceProvider, InferenceRequest};
use crate::capabilities::local_ai::DEFAULT_LLM_MODEL;
use crate::capabilities::page_ops::PageOp;
use crate::responses::{ReActResponse, response_to_result};
use crate::state::{AppResult, Message, ProviderConfig};
use crate::worker::page_proxy::run_page_op;

#[derive(Clone, Debug, Default)]
pub struct LocalGemmaInference;

impl InferenceProvider for LocalGemmaInference {
    async fn invoke_react(
        &self,
        config: &ProviderConfig,
        request: InferenceRequest,
    ) -> AppResult<InferenceOutput<ReActResponse>> {
        let messages = compose_messages(&request)?;
        let envelope = run_page_op(PageOp::Generate {
            model: Some(resolve_model(&config.model)),
            messages,
            max_tokens: config.max_tokens,
            temperature: config.temperature,
        })
        .await?;
        let parsed: serde_json::Value = serde_json::from_str(&envelope)
            .map_err(|err| format!("local model returned a non-JSON envelope: {err}"))?;
        let raw_text = parsed
            .get("text")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string();
        let parsed = response_to_result::<ReActResponse>(&raw_text)?;
        Ok(InferenceOutput { raw_text, parsed })
    }
}

/// Map the user-facing `local/<name>` model id onto a Hugging Face ONNX repo.
/// Short aliases cover the browser-feasible Gemma 4 variants; anything
/// containing a `/` is passed through as a repo id.
fn resolve_model(configured: &str) -> String {
    let id = super::normalize_model_identifier(configured);
    let name = id.model.trim();
    match name.to_ascii_lowercase().as_str() {
        "" | "gemma" | "gemma-4" | "e2b" | "gemma-4-e2b" | "gemma-4-e2b-it" => {
            DEFAULT_LLM_MODEL.to_string()
        }
        "e4b" | "gemma-4-e4b" | "gemma-4-e4b-it" => {
            "onnx-community/gemma-4-E4B-it-ONNX".to_string()
        }
        _ if name.contains('/') => name.to_string(),
        other => format!("onnx-community/{other}"),
    }
}

/// Compose the `[{role, content}]` transcript. Same order the OpenAI-compatible
/// provider ships (see `openai.rs::normalize_messages`, the source of truth):
/// rendered system prompt → conversation → response-format instructions last.
fn compose_messages(request: &InferenceRequest) -> AppResult<serde_json::Value> {
    let system = crate::agent_prompt::render_system_prompt(request)?;
    let mut messages = vec![json!({ "role": "system", "content": system })];
    if request.history.is_empty() {
        messages.push(json!({ "role": "user", "content": format!("Goal: {}", request.goal) }));
    } else {
        for message in &request.history {
            messages.push(wire_message(message));
        }
    }
    messages.push(json!({ "role": "user", "content": request.format_instructions }));
    Ok(serde_json::Value::Array(messages))
}

fn wire_message(message: &Message) -> serde_json::Value {
    match message.role.as_str() {
        "assistant" => json!({ "role": "assistant", "content": message.content }),
        "tool" => json!({
            "role": "user",
            "content": format!("Tool observation:\n{}", message.content)
        }),
        "user" => json!({ "role": "user", "content": message.content }),
        other => json!({
            "role": "user",
            "content": format!("{other}:\n{}", message.content)
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_aliases_resolve_to_onnx_repos() {
        assert_eq!(resolve_model("local/e2b"), DEFAULT_LLM_MODEL);
        assert_eq!(
            resolve_model("local/E4B"),
            "onnx-community/gemma-4-E4B-it-ONNX"
        );
        assert_eq!(resolve_model("local/"), DEFAULT_LLM_MODEL);
        assert_eq!(
            resolve_model("local/onnx-community/gemma-4-E2B-it-ONNX"),
            "onnx-community/gemma-4-E2B-it-ONNX"
        );
        assert_eq!(
            resolve_model("local/whisper-test"),
            "onnx-community/whisper-test"
        );
    }
}
