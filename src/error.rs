//! Typed error surface for the run/tool layer.
//!
//! [`EngineError`] is the hand-rolled error enum every engine instance will
//! eventually fail with — a closed set of failure modes that a per-instance
//! panel can render distinctly, instead of an opaque `Result<_, String>`. It is
//! introduced additively: the crate-wide alias is still
//! [`AppResult<T>`](crate::state::AppResult) `= Result<T, String>`, and an
//! [`impl From<EngineError> for String`] bridges the typed value back to that
//! alias at every boundary that hasn't been converted yet.
//!
//! The first consumer is the tool layer (`tools::common::string_arg` and the
//! `ToolFuture` error paths in `tools`): they build an `EngineError` and lower it
//! to a `String` at the public boundary so external signatures returning
//! `AppResult<String>` keep working unchanged. The enum is pure (no I/O, no
//! `wasm`-only types) so it is trivially host-testable.
//!
//! No new dependency: `Display`/`Error` are hand-rolled rather than derived with
//! `thiserror`, matching the crate's zero-extra-crate convention.

/// A typed run/tool failure. Each variant carries a human-readable detail string;
/// `Display` prefixes it with the failure class so a rendered message reads, e.g.,
/// `bad argument: Missing required string argument \`path\``.
///
/// The set is deliberately small and matches how the run/tool layer actually
/// fails today. The `#[non_exhaustive]` marker reserves room to add variants
/// (e.g. a richer provider/transport split) without it being a breaking change
/// for external matchers.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum EngineError {
    /// A model/inference call failed (provider returned an error, malformed
    /// completion, transport failure mid-request).
    Inference(String),
    /// A tool failed: it is unknown to the registry, or its handler returned an
    /// error while executing.
    Tool(String),
    /// A strategy/phase could not produce the next step (e.g. an unresolvable
    /// plan or a strategy precondition that was not met).
    Strategy(String),
    /// The target agent could not be resolved or loaded (no agent with the given
    /// id/name, or a manifest that failed to parse).
    AgentLoad(String),
    /// A budget was exhausted — step/turn cap, nesting depth, or a per-invocation
    /// ceiling.
    Budget(String),
    /// The run was interrupted (the user requested a stop, or the host cancelled
    /// it). The detail is a short reason for the panel.
    Interrupted(String),
    /// A caller-supplied argument was missing, the wrong type, or otherwise
    /// invalid. The dominant tool-layer failure mode (argument extraction).
    BadArgument(String),
    /// An I/O-style failure: a bridge/host call, file/VFS access, or network
    /// fetch that could not complete.
    Io(String),
}

impl EngineError {
    /// The stable, lower-case class label for this failure (the prefix `Display`
    /// uses). Exhaustive on purpose: a new variant forces a label here rather
    /// than silently borrowing another class's wording.
    pub fn class(&self) -> &'static str {
        match self {
            Self::Inference(_) => "inference error",
            Self::Tool(_) => "tool error",
            Self::Strategy(_) => "strategy error",
            Self::AgentLoad(_) => "agent load error",
            Self::Budget(_) => "budget exhausted",
            Self::Interrupted(_) => "interrupted",
            Self::BadArgument(_) => "bad argument",
            Self::Io(_) => "io error",
        }
    }

    /// The detail string this error carries (without the class prefix).
    pub fn detail(&self) -> &str {
        match self {
            Self::Inference(detail)
            | Self::Tool(detail)
            | Self::Strategy(detail)
            | Self::AgentLoad(detail)
            | Self::Budget(detail)
            | Self::Interrupted(detail)
            | Self::BadArgument(detail)
            | Self::Io(detail) => detail,
        }
    }
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.class(), self.detail())
    }
}

impl std::error::Error for EngineError {}

/// Lower a typed error to the crate-wide `String` error alias so it coexists with
/// [`AppResult<T>`](crate::state::AppResult). This is the bridge every boundary
/// that still returns `AppResult<String>` uses (`.map_err(String::from)` or `?`
/// through this `From`), keeping caller signatures unchanged while the typed enum
/// is adopted incrementally.
impl From<EngineError> for String {
    fn from(error: EngineError) -> Self {
        error.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_renders_class_prefix_for_each_variant() {
        assert_eq!(
            EngineError::Inference("provider 500".to_string()).to_string(),
            "inference error: provider 500"
        );
        assert_eq!(
            EngineError::Tool("Unknown compiled tool: foo".to_string()).to_string(),
            "tool error: Unknown compiled tool: foo"
        );
        assert_eq!(
            EngineError::Strategy("no next step".to_string()).to_string(),
            "strategy error: no next step"
        );
        assert_eq!(
            EngineError::AgentLoad("unknown agent `bot`".to_string()).to_string(),
            "agent load error: unknown agent `bot`"
        );
        assert_eq!(
            EngineError::Budget("step cap reached".to_string()).to_string(),
            "budget exhausted: step cap reached"
        );
        assert_eq!(
            EngineError::Interrupted("user stop".to_string()).to_string(),
            "interrupted: user stop"
        );
        assert_eq!(
            EngineError::BadArgument("Missing required string argument `path`".to_string())
                .to_string(),
            "bad argument: Missing required string argument `path`"
        );
        assert_eq!(
            EngineError::Io("bridge unreachable".to_string()).to_string(),
            "io error: bridge unreachable"
        );
    }

    #[test]
    fn class_and_detail_split_the_message() {
        let error = EngineError::Tool("boom".to_string());
        assert_eq!(error.class(), "tool error");
        assert_eq!(error.detail(), "boom");
    }

    #[test]
    fn from_engine_error_for_string_matches_display() {
        let error = EngineError::BadArgument("Missing required string argument `key`".to_string());
        let lowered: String = error.clone().into();
        assert_eq!(lowered, error.to_string());
        assert_eq!(
            lowered,
            "bad argument: Missing required string argument `key`"
        );
    }

    #[test]
    fn from_bridge_propagates_through_question_mark() {
        // The `?`-through-`From` bridge a boundary returning `Result<_, String>`
        // relies on: an `EngineError` flows into a `String`-error function.
        fn boundary() -> Result<(), String> {
            Err(EngineError::Io("disk full".to_string()))?
        }
        assert_eq!(boundary().unwrap_err(), "io error: disk full");
    }

    #[test]
    fn engine_error_is_std_error() {
        // Confirms the `std::error::Error` impl: usable as a boxed trait object.
        let boxed: Box<dyn std::error::Error> =
            Box::new(EngineError::Inference("nope".to_string()));
        assert_eq!(boxed.to_string(), "inference error: nope");
    }
}
