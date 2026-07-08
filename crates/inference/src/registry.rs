//! Provider selection: `"provider/model"` id → cached adapter instance.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

use askk_core::provider::{Provider, ProviderError};

use crate::anthropic::Anthropic;
use crate::openai_compat::OpenAiCompat;
use crate::transport::Transport;

#[derive(Debug, Clone, PartialEq, Default)]
pub struct ProviderProfile {
    /// Profile id — the `provider` half of a `"provider/model"` model id.
    pub id: String,
    pub base_url: String,
    pub api_key: String,
    /// Default model; the model half of the id overrides it.
    pub model: String,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

/// Split `"provider/model"`; both halves must be non-empty.
pub fn parse_model_id(id: &str) -> Result<(&str, &str), ProviderError> {
    id.split_once('/')
        .filter(|(provider, model)| !provider.is_empty() && !model.is_empty())
        .ok_or_else(|| {
            ProviderError::BadRequest(format!("model id '{id}' must be 'provider/model'"))
        })
}

pub struct ProviderRegistry {
    transport: Rc<dyn Transport>,
    profiles: BTreeMap<String, ProviderProfile>,
    cache: RefCell<BTreeMap<String, Rc<dyn Provider>>>,
}

impl ProviderRegistry {
    pub fn new(transport: Rc<dyn Transport>) -> Self {
        Self {
            transport,
            profiles: BTreeMap::new(),
            cache: RefCell::new(BTreeMap::new()),
        }
    }

    pub fn add_profile(&mut self, profile: ProviderProfile) {
        self.profiles.insert(profile.id.clone(), profile);
    }

    /// Resolve + construct + cache one provider instance per full model id.
    pub fn get(&self, model_id: &str) -> Result<Rc<dyn Provider>, ProviderError> {
        if let Some(provider) = self.cache.borrow().get(model_id) {
            return Ok(provider.clone());
        }
        let (provider_name, model) = parse_model_id(model_id)?;
        let profile = self.profiles.get(provider_name).ok_or_else(|| {
            ProviderError::BadRequest(format!("unknown provider profile '{provider_name}'"))
        })?;
        // Anthropic gets its native adapter; everything else speaks the
        // OpenAI-compatible dialect (the ecosystem default).
        let instance: Rc<dyn Provider> =
            if provider_name == "anthropic" || profile.base_url.contains("anthropic") {
                Rc::new(Anthropic::new(
                    model_id,
                    &profile.base_url,
                    &profile.api_key,
                    model,
                    self.transport.clone(),
                ))
            } else {
                Rc::new(OpenAiCompat::new(
                    model_id,
                    &profile.base_url,
                    &profile.api_key,
                    model,
                    self.transport.clone(),
                ))
            };
        self.cache
            .borrow_mut()
            .insert(model_id.to_string(), instance.clone());
        Ok(instance)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::MockTransport;

    fn registry() -> ProviderRegistry {
        let mut registry = ProviderRegistry::new(Rc::new(MockTransport::new()));
        registry.add_profile(ProviderProfile {
            id: "openai".into(),
            base_url: "https://api.openai.com/v1".into(),
            api_key: "sk".into(),
            model: "gpt-4o-mini".into(),
            ..Default::default()
        });
        registry.add_profile(ProviderProfile {
            id: "anthropic".into(),
            base_url: "https://api.anthropic.com".into(),
            api_key: "sk-ant".into(),
            model: "claude-sonnet-4-5".into(),
            ..Default::default()
        });
        registry
    }

    #[test]
    fn parses_provider_slash_model() {
        assert_eq!(
            parse_model_id("openai/gpt-4o").unwrap(),
            ("openai", "gpt-4o")
        );
        for bad in ["gpt-4o", "openai/", "/m", ""] {
            assert!(matches!(
                parse_model_id(bad),
                Err(ProviderError::BadRequest(_))
            ));
        }
    }

    #[test]
    fn constructs_and_caches_per_full_id() {
        let registry = registry();
        let a = registry.get("openai/gpt-4o").unwrap();
        let b = registry.get("openai/gpt-4o").unwrap();
        assert!(Rc::ptr_eq(&a, &b)); // cached, not rebuilt
        assert_eq!(a.id(), "openai/gpt-4o");
        let c = registry.get("openai/gpt-4o-mini").unwrap();
        assert!(!Rc::ptr_eq(&a, &c)); // different model = different instance
    }

    #[test]
    fn anthropic_profile_gets_the_anthropic_adapter() {
        let registry = registry();
        let provider = registry.get("anthropic/claude-sonnet-4-5").unwrap();
        assert_eq!(provider.id(), "anthropic/claude-sonnet-4-5");
    }

    #[test]
    fn unknown_profile_is_a_typed_error() {
        match registry().get("nope/model") {
            Err(ProviderError::BadRequest(m)) => assert!(m.contains("nope")),
            Err(other) => panic!("expected BadRequest, got {other}"),
            Ok(_) => panic!("expected an error"),
        }
    }
}
