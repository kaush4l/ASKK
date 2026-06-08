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
//! - [`transport`] — the shared, provider-agnostic HTTP/SSE plumbing and error
//!   mapping that concrete providers build on.

mod openai;
mod transport;

pub use openai::OpenAiCompatibleInference;
pub use transport::{list_models, test_chat};

use crate::responses::{ReActResponse, ResponseFormat};
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
    pub response_format: ResponseFormat,
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

/// Select the provider implementation for a config. Today every config maps to the
/// OpenAI-compatible provider; this is the one place a vendor switch would branch.
pub fn get_implementation(_config: &ProviderConfig) -> OpenAiCompatibleInference {
    OpenAiCompatibleInference
}
