//! Typed errors at the script boundary (Spike B's contract: denial is a typed
//! error surfaced to the host — never a panic, never silent success). Rhai's
//! message rides as payload; the VARIANT is what callers match on.

use serde::{Deserialize, Serialize};

use kernel::{CapabilityId, ModuleId};

/// What running forged logic can produce. Public because the forge pipeline's
/// static-validate and dry-run stages branch on exactly these variants.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScriptError {
    /// Source did not compile — the static-validate failure (§7).
    Compile {
        module_id: ModuleId,
        message: String,
    },
    /// The script called a capability it was not granted. Typed, recovered
    /// from inside Rhai's error nesting (Spike B) — never string-matched.
    CapabilityDenied {
        module_id: ModuleId,
        capability: CapabilityId,
    },
    /// A Limits ceiling fired (fuel, depth, size) — the runaway-module guard
    /// that keeps a forged loop from freezing anything but itself.
    LimitExceeded {
        module_id: ModuleId,
        message: String,
    },
    /// The script ran and failed on its own terms.
    Runtime {
        module_id: ModuleId,
        message: String,
    },
    /// `handle` returned something that is not a Response — a contract
    /// violation the dry run must catch before install.
    WrongReturnType {
        module_id: ModuleId,
        message: String,
    },
}
