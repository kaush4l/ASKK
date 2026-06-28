//! LLM provider connection settings and reusable inference-tuning profiles.
//!
//! - [`ProviderConfig`] is the live connection (base URL, model, auth, sampling).
//! - [`ProviderProfile`] is a saved, named connection.
//! - [`ModelProfile`] is a saved bundle of sampling knobs applied onto the active
//!   connection.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ProviderAuthMode {
    #[default]
    Bearer,
    None,
}

impl ProviderAuthMode {
    pub fn from_form_value(value: &str) -> Self {
        match value {
            "none" => Self::None,
            _ => Self::Bearer,
        }
    }

    pub fn as_form_value(self) -> &'static str {
        match self {
            Self::Bearer => "bearer",
            Self::None => "none",
        }
    }

    pub fn requires_key(self) -> bool {
        matches!(self, Self::Bearer)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ProviderConfig {
    pub base_url: String,
    pub model: String,
    pub api_key: String,
    #[serde(default)]
    pub auth_mode: ProviderAuthMode,
    pub persist_api_key: bool,
    pub temperature: f64,
    pub max_tokens: u32,
    /// Optional nucleus-sampling parameter. Sent to the provider only when set.
    #[serde(default)]
    pub top_p: Option<f64>,
    /// Total context budget for this model. Long-running agents default to 131k.
    #[serde(default = "default_context_window")]
    pub context_window: u32,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".to_string(),
            model: "gpt-4.1-mini".to_string(),
            api_key: String::new(),
            auth_mode: ProviderAuthMode::Bearer,
            persist_api_key: false,
            temperature: 0.2,
            max_tokens: default_max_tokens(),
            top_p: None,
            context_window: default_context_window(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ProviderProfile {
    pub id: String,
    pub name: String,
    pub config: ProviderConfig,
}

impl ProviderProfile {
    pub fn new(name: impl Into<String>, config: ProviderConfig) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            config,
        }
    }

    pub fn sanitized_name(name: &str, config: &ProviderConfig) -> String {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
        if !config.model.trim().is_empty() {
            return config.model.trim().to_string();
        }
        "Provider Profile".to_string()
    }
}

/// A reusable bundle of inference-tuning settings (temperature and friends) that
/// can be paired with a model to tweak behavior per agent need without changing
/// the provider connection. Applying a profile writes its values onto the active
/// [`ProviderConfig`].
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ModelProfile {
    pub id: String,
    pub name: String,
    pub temperature: f64,
    pub max_tokens: u32,
    #[serde(default)]
    pub top_p: Option<f64>,
    #[serde(default = "default_context_window")]
    pub context_window: u32,
}

impl ModelProfile {
    pub fn new(
        name: impl Into<String>,
        temperature: f64,
        max_tokens: u32,
        top_p: Option<f64>,
        context_window: u32,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            temperature,
            max_tokens,
            top_p,
            context_window,
        }
    }
}

pub fn default_model_profiles() -> Vec<ModelProfile> {
    vec![
        ModelProfile::new(
            "Precise",
            0.2,
            default_max_tokens(),
            None,
            default_context_window(),
        ),
        ModelProfile::new(
            "Balanced",
            0.5,
            default_max_tokens(),
            None,
            default_context_window(),
        ),
        ModelProfile::new(
            "Creative",
            0.8,
            default_max_tokens(),
            Some(0.95),
            default_context_window(),
        ),
    ]
}

/// Default total context budget. Long-running agents assume at least 131k tokens.
pub fn default_context_window() -> u32 {
    131_072
}

/// Default completion-token cap. Generous enough that synthesized answers are not
/// truncated, while staying well under the context window.
pub fn default_max_tokens() -> u32 {
    4_096
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn provider_auth_mode_defaults_to_bearer_for_old_config() {
        let config: ProviderConfig = serde_json::from_value(json!({
            "base_url": "https://api.openai.com/v1",
            "model": "gpt-4.1-mini",
            "api_key": "",
            "persist_api_key": false,
            "temperature": 0.2,
            "max_tokens": 900
        }))
        .unwrap();

        assert_eq!(config.auth_mode, ProviderAuthMode::Bearer);
    }
}
