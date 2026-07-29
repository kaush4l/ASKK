//! Typed registry/contract errors (PROMPT §13). Install-path failures are
//! facts the forge pipeline branches on, so each is a variant, not a string.

use serde::{Deserialize, Serialize};

use kernel::{ModuleId, Version};

/// What the registry and install path can reject. Public because the forge's
/// install stage and `core::boot` both abort on exactly these.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ModuleError {
    /// Another active module already serves this method+path (ADR-004:
    /// conflicts rejected at install time, never at dispatch time).
    RouteConflict { path: String, holder: ModuleId },
    /// The id+version already exists in history — versions are monotonic
    /// and immutable (§7: never destructively overwrite).
    VersionExists { id: ModuleId, version: Version },
    /// Deactivate/reactivate named a version history doesn't contain.
    UnknownVersion { id: ModuleId, version: Version },
    /// A declared test case failed in the deny-all run; install aborts.
    TestFailed {
        id: ModuleId,
        case_index: usize,
        message: String,
    },
    /// The manifest violates its own contract (empty intent, bad prefix…);
    /// caught before the module can exist, so nothing downstream re-checks.
    InvalidManifest { id: ModuleId, message: String },
}
