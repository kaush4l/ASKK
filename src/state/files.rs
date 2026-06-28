//! [`FileMeta`] — a lightweight, durable *hint* about a workspace file that lives
//! in OPFS (the off-hub data plane). The bytes never travel through the watcher
//! hub or into [`crate::state::AppSnapshot`]; only this small descriptor does, so
//! the UI and the engine can list/show files without reading them.
//!
//! Per the architecture design (`docs/superpowers/specs/2026-06-17-…`), a
//! `FileMeta` is *advisory*: a reader that needs ground truth always re-stats /
//! re-hashes the live OPFS entry. It rides on the snapshot only to seed the file
//! list cheaply on load and to carry `StatePatch::UpsertFileMeta` deltas.

use serde::{Deserialize, Serialize};

/// A durable hint about one workspace file in OPFS. `sha256` is the
/// content-address used for compare-and-swap writes; `modified_at` is an
/// emitter-supplied stamp (ISO-8601 or `unix-ms:` form, like the rest of the run
/// domain) so this type stays clock-free and platform-portable.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileMeta {
    /// Workspace-relative path (validated; never absolute, no `..`).
    pub path: String,
    /// Byte length at the time the hint was written.
    pub size: u64,
    /// Lowercase hex SHA-256 of the file's bytes — the CAS token.
    pub sha256: String,
    /// When the hint was written (ISO-8601 or `unix-ms:` string; emitter-supplied).
    pub modified_at: String,
}
