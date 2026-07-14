//! askk-engine — the agent loop. [`run`] owns run orchestration: submit/
//! steer/cancel, turns, tool dispatch, and delegation (incl. loops and
//! `spawn`); [`assemble`] builds the sheet from elements; [`actions`]
//! gates mutating tool calls behind the action policy + audit trail.
//! Crate-root re-exports keep the pre-split facade paths alive
//! (`config`/`tools` live in askk-features, `state` in askk-state).
//!
//! Imports: core, inference, state, features. Imported by: browser only.
//!
//! See MAP.md and docs/NAVIGATION.md.

pub mod actions;
pub mod assemble;
pub mod run;

pub use askk_features::{config, tools};
pub use askk_state as state;

// Path shims: delegation lives under the run engine (run/delegation/); old
// crate-root paths stay valid so downstream imports need no change.
pub use run::delegation::delegate;
pub use run::delegation::loops;
pub use run::delegation::spawn;

/// Test-only helper shared by unit and workflow tests (defined in
/// askk-state so every layer above core can reuse it).
#[doc(hidden)]
pub use askk_state::testutil;
