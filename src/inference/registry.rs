//! Inference registry: id → cached provider implementation.
//!
//! The runtime LLM is interchangeable behind a short identifier. A caller names a
//! model with a `"provider/model"` string (e.g. `"openai/gpt-4o-mini"`,
//! `"lms/qwen3"`) — or a bare model name, which defaults to the `"openai"` provider
//! (`"gpt-4o-mini"` → provider `"openai"`, model `"gpt-4o-mini"`). The registry
//! normalizes that identifier and hands back a *cached* [`InferenceProvider`]
//! implementation, building one impl per `"provider/model"` key and returning the
//! same handle on every repeat. This mirrors LocalAgents `core/inference.py`'s
//! `get_implementation(model_id)` + `normalize_model_identifier`.
//!
//! This module is pure: it carries no web/transport types. Every provider today is
//! OpenAI-compatible, so the registry maps all provider ids onto a single
//! [`OpenAiCompatibleInference`] — but the *seam* (id → impl, normalized + cached)
//! is real, so adding a divergent provider later is a localized change here.
//!
//! Caching uses `thread_local!` + `RefCell`, the same single-threaded-WASM pattern
//! the rest of the crate uses for cross-call state (see `mcp::registry`,
//! `worker::client`). No extra dependency, and there are no threads to race.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use super::local_gemma::LocalGemmaInference;
use super::{InferenceOutput, InferenceProvider, InferenceRequest, OpenAiCompatibleInference};
use crate::responses::ReActResponse;
use crate::state::{AppResult, ProviderConfig};

/// The provider id that selects the in-browser runtime ([`LocalGemmaInference`]).
pub const LOCAL_PROVIDER: &str = "local";

/// The closed set of concrete provider implementations, dispatched by enum
/// (the provider trait is not object-safe — it uses `async fn`; the core wraps
/// this in its own dyn-safe handle via a blanket impl). Adding a vendor is one
/// variant + one arm in [`build_implementation`]; the loop and the engines
/// stay untouched.
#[derive(Clone, Debug)]
pub enum ProviderImpl {
    OpenAi(OpenAiCompatibleInference),
    LocalGemma(LocalGemmaInference),
}

impl InferenceProvider for ProviderImpl {
    async fn invoke_react(
        &self,
        config: &ProviderConfig,
        request: InferenceRequest,
    ) -> AppResult<InferenceOutput<ReActResponse>> {
        match self {
            Self::OpenAi(provider) => provider.invoke_react(config, request).await,
            Self::LocalGemma(provider) => provider.invoke_react(config, request).await,
        }
    }

    async fn invoke_react_streaming(
        &self,
        config: &ProviderConfig,
        request: InferenceRequest,
        on_partial_answer: &mut dyn FnMut(String),
    ) -> AppResult<InferenceOutput<ReActResponse>> {
        match self {
            Self::OpenAi(provider) => {
                provider
                    .invoke_react_streaming(config, request, on_partial_answer)
                    .await
            }
            Self::LocalGemma(provider) => {
                provider
                    .invoke_react_streaming(config, request, on_partial_answer)
                    .await
            }
        }
    }
}

/// The provider id used when an identifier carries no `"provider/"` prefix. A bare
/// model name (e.g. `"gpt-4o-mini"`) is treated as belonging to this provider, since
/// every endpoint we speak to today is OpenAI-compatible.
pub const DEFAULT_PROVIDER: &str = "openai";

/// A normalized model identifier: a lowercased provider id and the model name as
/// written. Produced by [`normalize_model_identifier`] and used as the cache key.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ModelIdentifier {
    /// Lowercased provider id (e.g. `"openai"`, `"lms"`). Never empty.
    pub provider: String,
    /// Model name exactly as supplied, trimmed (e.g. `"gpt-4o-mini"`, `"qwen3"`).
    pub model: String,
}

impl ModelIdentifier {
    /// The canonical `"provider/model"` cache key for this identifier.
    pub fn key(&self) -> String {
        format!("{}/{}", self.provider, self.model)
    }
}

/// Parse a short model identifier into a normalized `(provider, model)` pair.
///
/// Rules (mirroring LocalAgents `normalize_model_identifier`):
/// - Split on the **first** `/`: the part before is the provider, the rest is the
///   model. The provider is lowercased and trimmed; the model is trimmed but its
///   case is preserved.
/// - A bare name with no `/` (e.g. `"gpt-4o-mini"`) defaults to provider
///   [`DEFAULT_PROVIDER`].
/// - An empty or whitespace-only id, or one whose provider/model side is blank,
///   falls back to [`DEFAULT_PROVIDER`] / the trimmed remainder so a caller never
///   gets an empty provider. An entirely empty id yields the default provider with
///   an empty model, leaving model selection to the live [`ProviderConfig`].
pub fn normalize_model_identifier(raw: &str) -> ModelIdentifier {
    let raw = raw.trim();
    match raw.split_once('/') {
        Some((provider, model)) => {
            let provider = provider.trim().to_lowercase();
            let model = model.trim().to_string();
            if provider.is_empty() {
                // Leading slash (e.g. "/gpt-4o-mini"): no provider written, treat the
                // remainder as a bare model name under the default provider.
                ModelIdentifier {
                    provider: DEFAULT_PROVIDER.to_string(),
                    model,
                }
            } else {
                ModelIdentifier { provider, model }
            }
        }
        None => ModelIdentifier {
            provider: DEFAULT_PROVIDER.to_string(),
            model: raw.to_string(),
        },
    }
}

thread_local! {
    /// One cached impl per normalized `"provider/model"` key. `Rc` so callers (and
    /// tests) can observe that a repeated lookup hands back the *same* handle rather
    /// than a fresh build.
    static IMPLEMENTATIONS: RefCell<HashMap<String, Rc<ProviderImpl>>> =
        RefCell::new(HashMap::new());
}

/// Resolve a short model identifier to a cached provider implementation.
///
/// The identifier is normalized via [`normalize_model_identifier`], then looked up
/// by its `"provider/model"` key. The first lookup for a key builds the impl and
/// caches it; every later lookup for the same key returns the same [`Rc`] handle.
/// `"local/..."` ids select the in-browser Gemma runtime; every other provider
/// id maps to the OpenAI-compatible transport.
pub fn get_or_create(raw: &str) -> Rc<ProviderImpl> {
    let id = normalize_model_identifier(raw);
    let key = id.key();
    IMPLEMENTATIONS.with(|cache| {
        if let Some(existing) = cache.borrow().get(&key) {
            return Rc::clone(existing);
        }
        // Build outside the immutable borrow above, then insert. Single-threaded, so
        // no other lookup can race in between.
        let impl_handle = Rc::new(build_implementation(&id));
        cache.borrow_mut().insert(key, Rc::clone(&impl_handle));
        impl_handle
    })
}

/// Construct the provider impl for a normalized identifier — the one place a
/// vendor switch branches. `"local"` selects the in-browser Gemma runtime;
/// everything else is OpenAI-compatible (any BYOK endpoint).
fn build_implementation(id: &ModelIdentifier) -> ProviderImpl {
    if id.provider == LOCAL_PROVIDER {
        ProviderImpl::LocalGemma(LocalGemmaInference)
    } else {
        ProviderImpl::OpenAi(OpenAiCompatibleInference)
    }
}

/// Test-only: number of distinct cached `"provider/model"` keys.
#[cfg(test)]
pub(crate) fn cache_len() -> usize {
    IMPLEMENTATIONS.with(|cache| cache.borrow().len())
}

/// Test-only: drop all cached impls so a test starts from an empty registry.
#[cfg(test)]
pub(crate) fn clear_cache() {
    IMPLEMENTATIONS.with(|cache| cache.borrow_mut().clear());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_provider_and_model() {
        let id = normalize_model_identifier("openai/gpt-4o-mini");
        assert_eq!(id.provider, "openai");
        assert_eq!(id.model, "gpt-4o-mini");
        assert_eq!(id.key(), "openai/gpt-4o-mini");
    }

    #[test]
    fn bare_name_defaults_to_openai_provider() {
        let id = normalize_model_identifier("gpt-4o-mini");
        assert_eq!(id.provider, DEFAULT_PROVIDER);
        assert_eq!(id.model, "gpt-4o-mini");
        assert_eq!(id.key(), "openai/gpt-4o-mini");
    }

    #[test]
    fn provider_is_lowercased_and_model_case_preserved() {
        let id = normalize_model_identifier("LMS/Qwen3-VL");
        assert_eq!(id.provider, "lms");
        assert_eq!(id.model, "Qwen3-VL");
    }

    #[test]
    fn splits_only_on_the_first_slash() {
        // A model name may itself contain slashes (e.g. an org-scoped HF name).
        let id = normalize_model_identifier("lms/qwen/qwen3-vl-30b");
        assert_eq!(id.provider, "lms");
        assert_eq!(id.model, "qwen/qwen3-vl-30b");
    }

    #[test]
    fn trims_surrounding_whitespace() {
        let id = normalize_model_identifier("  openai / gpt-4o-mini  ");
        assert_eq!(id.provider, "openai");
        assert_eq!(id.model, "gpt-4o-mini");
    }

    #[test]
    fn empty_id_yields_default_provider_and_empty_model() {
        let id = normalize_model_identifier("   ");
        assert_eq!(id.provider, DEFAULT_PROVIDER);
        assert_eq!(id.model, "");
        assert_eq!(id.key(), "openai/");
    }

    #[test]
    fn leading_slash_treats_remainder_as_bare_model() {
        let id = normalize_model_identifier("/gpt-4o-mini");
        assert_eq!(id.provider, DEFAULT_PROVIDER);
        assert_eq!(id.model, "gpt-4o-mini");
    }

    #[test]
    fn cache_returns_same_handle_for_same_key() {
        clear_cache();
        let a = get_or_create("openai/gpt-4o-mini");
        let b = get_or_create("openai/gpt-4o-mini");
        // Same key → same cached handle, not a fresh build.
        assert!(Rc::ptr_eq(&a, &b));
        assert_eq!(cache_len(), 1);
    }

    #[test]
    fn cache_normalizes_before_keying() {
        clear_cache();
        // A bare name and its explicit-provider spelling are the same key.
        let bare = get_or_create("gpt-4o-mini");
        let explicit = get_or_create("openai/gpt-4o-mini");
        assert!(Rc::ptr_eq(&bare, &explicit));
        // Whitespace and provider case do not create a new entry.
        let messy = get_or_create("  OpenAI/gpt-4o-mini ");
        assert!(Rc::ptr_eq(&bare, &messy));
        assert_eq!(cache_len(), 1);
    }

    #[test]
    fn distinct_keys_get_distinct_entries() {
        clear_cache();
        let a = get_or_create("openai/gpt-4o-mini");
        let b = get_or_create("lms/qwen3");
        assert!(!Rc::ptr_eq(&a, &b));
        assert_eq!(cache_len(), 2);
    }
}
