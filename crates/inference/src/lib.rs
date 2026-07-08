//! askk-inference — provider adapters over an injected Transport (ADR-009).
//! Body building and reply parsing are pure functions; retry/backoff lives
//! at the runtime call site, not here.
//!
//! Dependency rule 2: imports `askk-core` only. No UI, no storage.

pub mod anthropic;
pub mod mock;
pub mod openai_compat;
pub mod registry;
pub mod transport;

pub use anthropic::Anthropic;
pub use mock::MockProvider;
pub use openai_compat::OpenAiCompat;
pub use registry::{parse_model_id, ProviderProfile, ProviderRegistry};
pub use transport::{
    parse_sse_lines, HttpRequest, HttpResponse, MockTransport, SseEvent, Transport, TransportError,
};
