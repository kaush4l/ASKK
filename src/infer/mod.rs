//! # Inference component
//!
//! One generic call: [`infer`]`(model, prompt) -> text`. The model is looked up **by name at call
//! time** in `data/models.json`, so editing or switching models takes effect on the next call
//! without restart.
//!
//! A [`Model`] has one identifier, `name` (also the id sent to the provider), plus how to reach it:
//! `connector`, optional `base_url`, optional `key_env` (the *name* of an env var holding the key;
//! keys are never stored).
//!
//! | connector | request |
//! | --- | --- |
//! | `openai` | POST `{base_url}/chat/completions` (oMLX, LM Studio, vLLM, OpenAI) |
//! | `openai-responses` | POST `{base_url}/responses` |
//! | `anthropic` | POST `{base_url}/v1/messages` |
//! | `cli` | runs `command` (e.g. `["claude","-p","{prompt}"]`, `["copilot","-p","{prompt}"]`); `{prompt}`/`{model}` are filled, no `{prompt}` = sent on stdin |
//! | `echo` | returns the prompt (tests) |
//!
//! [`discover_models`] lists the names a server offers (`GET {base_url}/models`) so the UI can add
//! them with one click.
use dioxus::prelude::*;
use serde::{Deserialize, Serialize};

#[cfg(feature = "server")]
mod connectors;

pub const CONNECTORS: &[&str] = &["openai", "openai-responses", "anthropic", "cli", "echo"];

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Model {
    pub name: String,
    pub connector: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub base_url: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub key_env: String,
    /// `cli` only: program and args.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub command: Vec<String>,
}

/// Contents of `data/models.json`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Models {
    /// Name of the model used when a caller names none.
    #[serde(default)]
    pub default: String,
    #[serde(default)]
    pub models: Vec<Model>,
}

#[cfg_attr(not(feature = "server"), allow(dead_code))]
impl Models {
    pub fn find(&self, name: &str) -> Option<&Model> {
        let name = if name.is_empty() { &self.default } else { name };
        self.models.iter().find(|m| m.name == *name)
    }
}

#[cfg(feature = "server")]
pub fn models_path() -> std::path::PathBuf {
    crate::api::data_dir().join("models.json")
}

/// `data/models.json` (seeded from `defaults/models.json`); empty when missing.
#[cfg(feature = "server")]
pub async fn load() -> Models {
    tokio::fs::read_to_string(models_path()).await.ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// The engine-facing runtime: resolves the model by name at call time.
#[cfg(feature = "server")]
pub struct ModelsInfer;

#[cfg(feature = "server")]
impl crate::core::Infer for ModelsInfer {
    fn complete(&self, model: &str, prompt: String) -> crate::core::Fut<Result<String, String>> {
        let model = model.to_string();
        Box::pin(async move {
            let models = load().await;
            let m = models.find(&model).ok_or_else(|| format!("no model named '{model}' (and no default)"))?.clone();
            connectors::complete(&m, &prompt).await
        })
    }
}

#[server]
pub async fn list_models() -> Result<Models, ServerFnError> {
    Ok(load().await)
}

#[server]
pub async fn save_models(models: Models) -> Result<(), ServerFnError> {
    let path = models_path();
    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir).await.map_err(|e| ServerFnError::new(e.to_string()))?;
    }
    let text = serde_json::to_string_pretty(&models).map_err(|e| ServerFnError::new(e.to_string()))?;
    tokio::fs::write(path, text).await.map_err(|e| ServerFnError::new(e.to_string()))?;
    Ok(())
}

#[server]
pub async fn discover_models(connector: String, base_url: String, key_env: String) -> Result<Vec<String>, ServerFnError> {
    let probe = Model { name: String::new(), connector, base_url, key_env, command: vec![] };
    connectors::discover(&probe).await.map_err(ServerFnError::new)
}

/// The generic infer: resolve `model` by name now, send `prompt`, return text.
#[server]
pub async fn infer(model: String, prompt: String) -> Result<String, ServerFnError> {
    use crate::core::Infer;
    ModelsInfer.complete(&model, prompt).await.map_err(ServerFnError::new)
}
