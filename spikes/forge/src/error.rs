//! Typed errors crossing the host boundary (PROMPT §13: no stringly errors)
//! plus the machinery that recovers a typed capability denial from rhai.

use crate::Capability;
use rhai::{Dynamic, EvalAltResult, Position};
use std::fmt;

/// The host-boundary error contract. `Script` keeps rhai's message as payload
/// but the *variant* is what callers match on.
#[derive(Debug, Clone, PartialEq)]
pub enum ForgeError {
    RouteNotFound(String),
    /// Registering a module whose route is already served.
    RouteConflict(String),
    CapabilityDenied {
        module_id: String,
        capability: Capability,
    },
    Script {
        module_id: String,
        message: String,
    },
}

impl fmt::Display for ForgeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RouteNotFound(p) => write!(f, "no module serves {p}"),
            Self::RouteConflict(p) => write!(f, "route {p} already served"),
            Self::CapabilityDenied {
                module_id,
                capability,
            } => write!(f, "module {module_id}: capability {capability:?} denied"),
            Self::Script { module_id, message } => {
                write!(f, "module {module_id}: script error: {message}")
            }
        }
    }
}

impl std::error::Error for ForgeError {}

/// Marker carried inside a rhai runtime error so the host can recover the
/// *typed* denial instead of string-matching an error message.
#[derive(Debug, Clone)]
struct Denied(Capability);

pub(crate) fn denied(cap: Capability) -> Box<EvalAltResult> {
    Box::new(EvalAltResult::ErrorRuntime(
        Dynamic::from(Denied(cap)),
        Position::NONE,
    ))
}

/// Map a rhai error back to the typed boundary, unwrapping function-call
/// nesting to recover a `Denied` marker wherever it is buried.
pub(crate) fn host_error(module_id: &str, err: &EvalAltResult) -> ForgeError {
    if let Some(cap) = find_denial(err) {
        return ForgeError::CapabilityDenied {
            module_id: module_id.to_string(),
            capability: cap,
        };
    }
    ForgeError::Script {
        module_id: module_id.to_string(),
        message: err.to_string(),
    }
}

fn find_denial(err: &EvalAltResult) -> Option<Capability> {
    match err {
        EvalAltResult::ErrorRuntime(payload, _) => {
            payload.clone().try_cast::<Denied>().map(|d| d.0)
        }
        EvalAltResult::ErrorInFunctionCall(_, _, inner, _) => find_denial(inner),
        _ => None,
    }
}
