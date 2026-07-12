//! Run orchestration (MAP hop 1): the session that stitches config, sheet
//! assembly, providers, tools, actions, and the signal log into the
//! execution lifecycle of docs/ARCHITECTURE.md.
//!
//! - [`host`] — `RunHost`, the shell seam (time, sleep, interrupts, deltas).
//! - [`session`] — `RunSession`: submit / drive / resolve_action / cancel.
//! - [`turn`] — the per-phase per-turn loop.
//! - [`answer`] — answer → phase routing (gate semantics, ADR-008).
//! - [`dispatch`] — tool-call dispatch through the action gate.
//! - [`flow`] — phase-boundary flow: declared fan-out, exhaustion rerouting.
//! - [`cancel`] — wake-aware cancel token raced against in-flight calls.

pub(crate) mod answer;
pub(crate) mod cancel;
pub(crate) mod dispatch;
pub(crate) mod flow;
pub mod host;
pub mod session;
pub(crate) mod turn;

pub use host::{RunHost, TestHost};
pub use session::{ProviderResolver, RunOutcome, RunSession, SessionInit};
