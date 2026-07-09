//! Plain facade structs the UI exchanges with [`super::boot`] (ADR-013):
//! the agent-rail card and the BYOK provider profile form + its JSON wire
//! shape for the session store.

use serde_json::{json, Value};

/// What the UI's agent rail shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentCard {
    pub id: String,
    pub name: String,
    pub description: String,
}

/// The settings form. BYOK: persisted only to the local store (OPFS in the
/// browser), sent only to `base_url`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ProviderProfileForm {
    pub base_url: String,
    pub model: String,
    pub api_key: String,
    pub temperature: Option<f32>,
}

pub(super) fn profile_to_json(form: &ProviderProfileForm) -> Value {
    json!({
        "base_url": form.base_url,
        "model": form.model,
        "api_key": form.api_key,
        "temperature": form.temperature,
    })
}

/// Used by the wasm boot path (and tests); host runs start from defaults.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub(super) fn profile_from_json(value: &Value) -> ProviderProfileForm {
    let text = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    ProviderProfileForm {
        base_url: text("base_url"),
        model: text("model"),
        api_key: text("api_key"),
        temperature: value
            .get("temperature")
            .and_then(Value::as_f64)
            .map(|t| t as f32),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_round_trips_through_json() {
        let form = ProviderProfileForm {
            base_url: "http://localhost:1234/v1".into(),
            model: "qwen".into(),
            api_key: "sk-local".into(),
            temperature: Some(0.5),
        };
        assert_eq!(profile_from_json(&profile_to_json(&form)), form);
        assert_eq!(
            profile_from_json(&json!({})),
            ProviderProfileForm::default()
        );
    }
}
