//! The provider seam. Adapters live in `crates/inference` (and `web` for
//! local models); they map a rendered request, never compose prompt text.

use std::fmt;

use futures::future::LocalBoxFuture;

use crate::request::{InferenceReply, InferenceRequest};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderError {
    /// Carries an actionable hint (base URL, CORS, key).
    Unreachable {
        hint: String,
    },
    Auth,
    RateLimited {
        retry_after_ms: Option<u64>,
    },
    BadRequest(String),
    Timeout,
    Malformed(String),
}

impl fmt::Display for ProviderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProviderError::Unreachable { hint } => write!(f, "provider unreachable: {hint}"),
            ProviderError::Auth => write!(f, "authentication failed: check the API key"),
            ProviderError::RateLimited { retry_after_ms } => match retry_after_ms {
                Some(ms) => write!(f, "rate limited: retry after {ms}ms"),
                None => write!(f, "rate limited"),
            },
            ProviderError::BadRequest(msg) => write!(f, "bad request: {msg}"),
            ProviderError::Timeout => write!(f, "provider timed out"),
            ProviderError::Malformed(msg) => write!(f, "malformed provider reply: {msg}"),
        }
    }
}

impl std::error::Error for ProviderError {}

/// Dyn-safe (`Rc<dyn Provider>`): the browser is single-threaded, so the
/// future is a `LocalBoxFuture` and there are no Send bounds anywhere.
pub trait Provider {
    /// The full `"provider/model"` id this instance serves.
    fn id(&self) -> &str;

    /// One inference call. Streaming deltas arrive through `on_delta`; the
    /// assembled reply is the return value. Retry/backoff lives at the
    /// runtime call site, not here.
    fn infer<'a>(
        &'a self,
        req: &'a InferenceRequest,
        on_delta: &'a mut dyn FnMut(&str),
    ) -> LocalBoxFuture<'a, Result<InferenceReply, ProviderError>>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_display_actionably() {
        let err = ProviderError::Unreachable {
            hint: "check http://localhost:1234 and CORS".into(),
        };
        assert!(err.to_string().contains("CORS"));
        assert!(ProviderError::Auth.to_string().contains("API key"));
        assert!(ProviderError::RateLimited {
            retry_after_ms: Some(2000)
        }
        .to_string()
        .contains("2000"));
    }
}
