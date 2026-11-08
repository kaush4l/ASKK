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
//! Runtimes: `cli` (any command: `["claude","-p","{prompt}"]`, `["copilot","-p","{prompt}"]`;
//! no `{prompt}` = stdin) and `echo` are mechanisms in code. Every HTTP runtime (OpenAI chat
//! completions, OpenAI Responses, Anthropic, oMLX, …) is a [`Runtime`] entry in
//! `data/runtimes.json`.
//!
//! [`discover_models`] lists the names a server offers (`GET {base_url}/models`) with their
//! context windows, so the UI can add them with one click.
//!
//! Tokens: `max_tokens` (default [`MAX_TOKENS`] = 32k) caps each reply; `context` is the window.
//! When `context` is 0 it is read from the runtime's models listing (pointers in
//! `Runtime::context`) once and cached; engines refocus at 90% of it.
use dioxus::prelude::*;
use serde::{Deserialize, Serialize};

#[cfg(feature = "server")]
mod connectors;

/// Runtimes that are mechanisms in code; the rest come from `data/runtimes.json`.
#[cfg_attr(not(feature = "server"), allow(dead_code))]
pub const BUILT_IN: &[&str] = &["cli", "echo"];

/// An HTTP runtime as data: `POST {base_url}{path}` with `body` (`{model}`/`{prompt}` filled),
/// auth from the model's `key_env` (`auth`: `bearer` or a header name), reply text at the first
/// matching JSON pointer in `reply`; `models` = GET path listing models (`data[].id`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "server"), allow(dead_code))]
pub struct Runtime {
    pub name: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub auth: String,
    #[serde(default)]
    pub headers: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    pub body: serde_json::Value,
    #[serde(default)]
    pub reply: Vec<String>,
    #[serde(default)]
    pub models: String,
    /// JSON pointers, inside one entry of the models listing, to its context window in tokens
    /// (`/max_input_tokens`, `/context_length`, `/max_model_len`, …).
    #[serde(default)]
    pub context: Vec<String>,
}

/// A model a server offers, with its context window when the server reports it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Found {
    pub name: String,
    pub context: u32,
}

/// Output cap per reply when a model sets none.
pub const MAX_TOKENS: u32 = 32_000;

fn max_tokens() -> u32 {
    MAX_TOKENS
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

/// Every runtime name a model can use.
#[server]
pub async fn connectors() -> Result<Vec<String>, ServerFnError> {
    let mut v: Vec<String> = BUILT_IN.iter().map(|s| s.to_string()).collect();
    v.extend(connectors::runtimes().into_iter().map(|r| r.name));
    Ok(v)
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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
    /// Output cap per reply, sent as `{max_tokens}` in the runtime body.
    #[serde(default = "max_tokens")]
    pub max_tokens: u32,
    /// Context window in tokens. 0 = ask the runtime (models listing), else unknown.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub context: u32,
}

impl Default for Model {
    fn default() -> Self {
        Self { name: String::new(), connector: String::new(), base_url: String::new(), key_env: String::new(), command: vec![], max_tokens: MAX_TOKENS, context: 0 }
    }
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
    fn context(&self, model: &str) -> crate::core::Fut<usize> {
        let model = model.to_string();
        Box::pin(async move {
            match load().await.find(&model) {
                Some(m) => connectors::context(m).await as usize,
                None => 0,
            }
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
pub async fn discover_models(connector: String, base_url: String, key_env: String) -> Result<Vec<Found>, ServerFnError> {
    let probe = Model { connector, base_url, key_env, ..Default::default() };
    connectors::discover(&probe).await.map_err(ServerFnError::new)
}

/// The generic infer: resolve `model` by name now, send `prompt`, return text.
#[server]
pub async fn infer(model: String, prompt: String) -> Result<String, ServerFnError> {
    use crate::core::Infer;
    ModelsInfer.complete(&model, prompt).await.map_err(ServerFnError::new)
}
