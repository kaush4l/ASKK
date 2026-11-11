//! Answers: model connectors.
//!
//! Plain functions over the core: no UI library, no wire. Whoever asks (a Dioxus window, the
//! `/ask` route, the tab's own page) gets the same answer, and an error is one sentence.
use super::*;
use crate::api::say;
use crate::core::models::Model;
use crate::host::infer::{connectors, load, ModelsInfer};

pub async fn list_models() -> Result<Models, String> {
    Ok(load().await)
}

pub async fn save_models(models: Models) -> Result<(), String> {
    let text = serde_json::to_string_pretty(&models).map_err(|e| say(e.to_string()))?;
    crate::core::store::data().put(&crate::core::manifest::manifest().models, &text).map_err(say)
}

pub async fn discover_models(method: String, base_url: String, token_env: String) -> Result<Vec<Found>, String> {
    let probe = Model { method, base_url, token_env, ..Default::default() };
    connectors::discover(&probe).await.map_err(say)
}

/// The generic infer: resolve `model` by name now, send `prompt`, return text.
pub async fn infer(model: String, prompt: String) -> Result<String, String> {
    use crate::core::Infer;
    ModelsInfer.complete(&model, prompt, Default::default()).await.map_err(say)
}
