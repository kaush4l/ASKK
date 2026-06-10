//! Provider pillar (one of the four core types: Engine, Tool, **Provider**,
//! Capability).
//!
//! An LLM provider implements [`InferenceProvider`]: it turns an
//! [`InferenceRequest`] (soul + agent role + skills + tool manifest + transcript)
//! into a parsed [`ReActResponse`]. The trait carries the common flow as default
//! methods (streaming falls back to non-streaming), so a concrete provider overrides
//! only what differs — the agent loop never changes.
//!
//! - [`openai`] — the one concrete provider today ([`OpenAiCompatibleInference`]),
//!   which speaks the OpenAI-compatible chat-completions API, so any BYOK endpoint
//!   works. A new vendor is a new file here implementing the trait.
//! - [`registry`] — the id → cached-impl seam: a short `"provider/model"`
//!   identifier is normalized and resolved to a cached [`InferenceProvider`], so the
//!   runtime LLM is interchangeable behind a stable handle.
//! - [`transport`] — the shared, provider-agnostic HTTP/SSE plumbing and error
//!   mapping that concrete providers build on.

mod openai;
mod registry;
mod transport;

pub use openai::OpenAiCompatibleInference;
pub use registry::get_or_create;
// The id-normalization seam is public for sibling units (the engine/orchestrator
// will resolve models by short id); it looks unused from this crate until they wire
// it, so allow that here — same convention as `state::mod`'s sibling re-exports.
#[allow(unused_imports)]
pub use registry::{DEFAULT_PROVIDER, ModelIdentifier, normalize_model_identifier};
pub use transport::{list_models, test_chat};

use crate::responses::ReActResponse;
use crate::state::{AppResult, Message, ProviderConfig, Skill, ToolSpec};

/// A sub-agent the running agent can see and delegate to. This is the
/// "code object → LLM information" view of an [`Agent`](crate::state::Agent): just
/// the name and a one-line description, rendered into the prompt's sub-agent roster
/// by [`crate::agent_prompt`].
#[derive(Clone, Debug, PartialEq)]
pub struct SubAgentInfo {
    pub name: String,
    pub description: String,
}

#[derive(Clone, Debug)]
pub struct InferenceRequest {
    pub agent_name: String,
    pub agent_role: String,
    pub soul: String,
    pub skills: Vec<Skill>,
    pub goal: String,
    pub history: Vec<Message>,
    pub tools: Vec<ToolSpec>,
    /// Sub-agents this run can delegate to (the roster the orchestrator/agent
    /// "sees"). Empty for a single-agent run with no peers.
    pub sub_agents: Vec<SubAgentInfo>,
    /// The current date/time, read once at request-build time (via
    /// [`crate::state::now_iso`]) and rendered into the prompt's `## CONTEXT` block so
    /// the agent can reason about "now" — e.g. how recent a news search should be.
    pub now: String,
    /// The fully rendered response-format instruction block (schema-specific).
    /// Computed by the engine from the active phase's `ResponseKind` +
    /// negotiated `ResponseFormat`; providers place it last, never compute it.
    pub format_instructions: String,
    /// Multimodal content parts (image/audio) attached alongside the rendered
    /// text — the request is one "big sheet of paper" that can carry more than
    /// strings. Collected by the core engine at render time; a provider that
    /// cannot ship a part ignores it (the OpenAI-compatible provider does, and
    /// the field is empty everywhere today).
    // Read by a provider once a modality mapping lands; until then only the
    // core engine writes it, so the dead-code lint would otherwise fire.
    #[allow(dead_code)]
    pub parts: Vec<crate::core::Part>,
}

#[derive(Clone, Debug)]
pub struct InferenceOutput<T> {
    pub raw_text: String,
    pub parsed: T,
}

pub trait InferenceProvider {
    async fn invoke_react(
        &self,
        config: &ProviderConfig,
        request: InferenceRequest,
    ) -> AppResult<InferenceOutput<ReActResponse>>;

    async fn invoke_react_streaming(
        &self,
        config: &ProviderConfig,
        request: InferenceRequest,
        _on_partial_answer: &mut dyn FnMut(String),
    ) -> AppResult<InferenceOutput<ReActResponse>> {
        self.invoke_react(config, request).await
    }
}

/// Select the provider implementation for a config, resolved through the cached
/// [`registry`] keyed by the config's model identifier (see
/// [`normalize_model_identifier`]). Today every identifier maps to the
/// OpenAI-compatible provider, but the normalize-and-cache seam is real, so a future
/// vendor switch is a localized change in [`registry`] rather than here.
///
/// Returns the impl by value (it is a zero-sized handle, cheap to clone); the
/// registry retains the cached entry so repeated calls reuse one built impl.
pub fn get_implementation(config: &ProviderConfig) -> OpenAiCompatibleInference {
    (*get_or_create(&config.model)).clone()
}
