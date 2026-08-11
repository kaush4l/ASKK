//! The configured endpoint: base URL, key, model name — and the bookkeeping
//! around them. Pure (no browser, host-tested): this is where a secret gets
//! lost, and losing one silently is exactly what the tests below refuse.
//! `model.rs` owns the wire; this owns what is on it.

use kernel::ModelError;

/// One configured endpoint. `api_key` leaves this process only in the
/// `Authorization` header of a call. There is no default base URL: an
/// unconfigured install has no endpoint and says so (I15) rather than POSTing
/// at whatever `/v1` resolves to on its host.
#[derive(Clone, Default)]
pub struct Endpoint {
    base_url: String,
    api_key: String,
    /// The model name the provider expects. Empty = send what the core asked
    /// for, which is what a local server (omlx, llama.cpp) ignores anyway.
    model: String,
}

impl Endpoint {
    /// Point at an endpoint (settings, a user action — never a module grant).
    /// `api_key: None` KEEPS the stored key: the settings field is write-only
    /// (a secret is never round-tripped through the DOM), so a blank field
    /// means "unchanged", and only an explicit `Some("")` clears it.
    pub fn set(&mut self, base_url: &str, api_key: Option<&str>, model: &str) {
        self.base_url = base_url.trim().trim_end_matches('/').to_string();
        self.model = model.trim().to_string();
        if let Some(key) = api_key {
            self.api_key = key.trim().to_string();
        }
    }

    /// The stored record — the one place the key is serialized.
    pub fn profile_json(&self) -> String {
        serde_json::json!({
            "base_url": self.base_url, "api_key": self.api_key, "model": self.model
        })
        .to_string()
    }

    /// Load that record back (boot). An unreadable record leaves the endpoint
    /// unconfigured rather than failing boot (I15).
    pub fn load_profile(&mut self, raw: &str) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) {
            let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or_default();
            self.set(s("base_url"), Some(s("api_key")), s("model"));
        }
    }

    /// What the settings pane shows: the base URL, whether a key is set, and
    /// the model name — never the key itself.
    pub fn summary(&self) -> (String, bool, String) {
        (
            self.base_url.clone(),
            !self.api_key.is_empty(),
            self.model.clone(),
        )
    }

    /// The base URL, or the typed "nothing is configured" error — the
    /// first-run path is a sentence, not a request that cannot work.
    pub fn base(&self) -> Result<&str, ModelError> {
        if self.base_url.is_empty() {
            return Err(ModelError::EndpointUnknown {
                endpoint: "model".into(),
            });
        }
        Ok(&self.base_url)
    }

    pub fn api_key(&self) -> &str {
        &self.api_key
    }

    /// Stamp the configured model name into the core's request body. The model
    /// name is the adapter's job, like a credential: the core never knows which
    /// concrete model answered. Empty = leave the core's own name alone.
    pub fn with_model_name(&self, body_json: &str) -> String {
        if self.model.is_empty() {
            return body_json.to_string();
        }
        serde_json::from_str::<serde_json::Value>(body_json)
            .map(|mut v| {
                v["model"] = serde_json::Value::String(self.model.clone());
                v.to_string()
            })
            .unwrap_or_else(|_| body_json.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored_key(e: &Endpoint) -> String {
        serde_json::from_str::<serde_json::Value>(&e.profile_json()).unwrap()["api_key"]
            .as_str()
            .unwrap()
            .to_string()
    }

    /// The bug `ux-walker` found: Save with the (write-only, never
    /// repopulated) key field blank must NOT wipe the stored key.
    #[test]
    fn blank_key_field_preserves_the_stored_key() {
        let mut e = Endpoint::default();
        e.set("https://api.example.com/v1", Some("sk-secret"), "");
        e.set("https://other.example.com/v1", None, "gpt-4o-mini");
        assert_eq!(stored_key(&e), "sk-secret");
        assert_eq!(
            e.summary(),
            ("https://other.example.com/v1".into(), true, "gpt-4o-mini".into())
        );
    }

    /// Clearing is explicit, and possible.
    #[test]
    fn explicit_empty_key_clears_it() {
        let mut e = Endpoint::default();
        e.set("https://api.example.com/v1", Some("sk-secret"), "");
        e.set("https://api.example.com/v1", Some(""), "");
        assert_eq!(stored_key(&e), "");
        assert!(!e.summary().1);
    }

    /// A reload restores the key from storage — the one legitimate way it
    /// comes back, since the DOM never holds it.
    #[test]
    fn profile_round_trips_through_storage() {
        let mut e = Endpoint::default();
        e.set("https://api.example.com/v1/", Some("sk-secret"), "m1");
        let mut reloaded = Endpoint::default();
        reloaded.load_profile(&e.profile_json());
        assert_eq!(stored_key(&reloaded), "sk-secret");
        // Trailing slash normalized once, at the boundary.
        assert_eq!(reloaded.base().unwrap(), "https://api.example.com/v1");
    }

    /// An unconfigured install has no endpoint to call.
    #[test]
    fn unconfigured_endpoint_is_a_typed_error() {
        assert_eq!(
            Endpoint::default().base().unwrap_err(),
            ModelError::EndpointUnknown {
                endpoint: "model".into()
            }
        );
    }

    /// The adapter stamps the model name when configured, and leaves the
    /// core's own body alone when it is not.
    #[test]
    fn model_name_is_stamped_only_when_configured() {
        let mut e = Endpoint::default();
        e.set("https://api.example.com/v1", None, "");
        assert_eq!(e.with_model_name(r#"{"model":"local"}"#), r#"{"model":"local"}"#);
        e.set("https://api.example.com/v1", None, "gpt-4o-mini");
        assert!(e.with_model_name(r#"{"model":"local"}"#).contains("gpt-4o-mini"));
    }
}
