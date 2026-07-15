//! askk-inference — external-LLM provider adapters: each maps a core
//! `InferenceRequest` to a provider's HTTP shape over an injected
//! [`Transport`] (ADR-009). Body building and reply parsing are pure
//! functions; retry/backoff lives at the runtime call site, not here.
//! No UI, no storage.
//!
//! Imports: core only (dependency rule 2). Imported by: features, engine,
//! browser.
//!
//! See MAP.md and docs/NAVIGATION.md.

pub mod anthropic;
pub mod mock;
pub mod openai_compat;
pub mod registry;
pub(crate) mod sse_acc;
pub mod transport;

pub use anthropic::Anthropic;
pub use mock::MockProvider;
pub use openai_compat::OpenAiCompat;
pub use registry::{parse_model_id, ProviderProfile, ProviderRegistry};
pub use transport::{
    parse_sse_lines, HttpRequest, HttpResponse, MockTransport, SseAssembler, SseEvent, Transport,
    TransportError, Utf8Accumulator,
};
