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
    pub max_tokens: Option<u32>,
}

/// One saved provider profile: a user-chosen name over the form fields.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct NamedProfile {
    pub name: String,
    pub form: ProviderProfileForm,
}

/// Every saved profile plus which one runs are routed to. Each profile
/// persists under its own store key; `active` persists as a pref.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ProfileSet {
    pub profiles: Vec<NamedProfile>,
    pub active: String,
}

impl ProfileSet {
    /// The form runs use: the active profile, else the first, else empty.
    pub fn active_form(&self) -> ProviderProfileForm {
        self.profiles
            .iter()
            .find(|p| p.name == self.active)
            .or_else(|| self.profiles.first())
            .map(|p| p.form.clone())
            .unwrap_or_default()
    }

    pub fn get(&self, name: &str) -> Option<&NamedProfile> {
        self.profiles.iter().find(|p| p.name == name)
    }

    /// Insert or replace by name; the saved profile becomes active.
    pub fn upsert(&mut self, name: &str, form: ProviderProfileForm) {
        match self.profiles.iter_mut().find(|p| p.name == name) {
            Some(existing) => existing.form = form,
            None => self.profiles.push(NamedProfile {
                name: name.to_string(),
                form,
            }),
        }
        self.active = name.to_string();
    }

    /// Remove by name; if it was active, activation falls to the first left.
    pub fn remove(&mut self, name: &str) {
        self.profiles.retain(|p| p.name != name);
        if self.active == name {
            self.active = self
                .profiles
                .first()
                .map(|p| p.name.clone())
                .unwrap_or_default();
        }
    }
}

pub(super) fn profile_to_json(form: &ProviderProfileForm) -> Value {
    json!({
        "base_url": form.base_url,
        "model": form.model,
        "api_key": form.api_key,
        "temperature": form.temperature,
        "max_tokens": form.max_tokens,
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
        max_tokens: value
            .get("max_tokens")
            .and_then(Value::as_u64)
            .map(|t| t as u32),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_set_upsert_activate_remove() {
        let mut set = ProfileSet::default();
        assert_eq!(set.active_form(), ProviderProfileForm::default());
        let local = ProviderProfileForm {
            base_url: "http://127.0.0.1:8873/v1".into(),
            model: "gemma-4-12B-it-qat-mxfp8".into(),
            ..Default::default()
        };
        set.upsert("omlx", local.clone());
        set.upsert(
            "cloud",
            ProviderProfileForm {
                base_url: "https://api.openai.com/v1".into(),
                ..Default::default()
            },
        );
        assert_eq!(set.active, "cloud");
        set.active = "omlx".into();
        assert_eq!(set.active_form(), local);
        // Upsert an existing name replaces in place, no duplicate.
        set.upsert("omlx", ProviderProfileForm::default());
        assert_eq!(set.profiles.len(), 2);
        // Removing the active profile falls back to the first remaining.
        set.remove("omlx");
        assert_eq!(set.active, "cloud");
        set.remove("cloud");
        assert_eq!(set.active, "");
        assert_eq!(set.active_form(), ProviderProfileForm::default());
    }

    #[test]
    fn unknown_active_falls_back_to_first_profile() {
        let mut set = ProfileSet::default();
        set.upsert(
            "a",
            ProviderProfileForm {
                model: "m".into(),
                ..Default::default()
            },
        );
        set.active = "ghost".into();
        assert_eq!(set.active_form().model, "m");
    }

    #[test]
    fn profile_round_trips_through_json() {
        let form = ProviderProfileForm {
            base_url: "http://localhost:1234/v1".into(),
            model: "qwen".into(),
            api_key: "sk-local".into(),
            temperature: Some(0.5),
            max_tokens: Some(2048),
        };
        assert_eq!(profile_from_json(&profile_to_json(&form)), form);
        assert_eq!(
            profile_from_json(&json!({})),
            ProviderProfileForm::default()
        );
    }
}
