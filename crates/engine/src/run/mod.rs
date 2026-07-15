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
/// Engine-side delegation tools (delegate, loops, spawn_agent).
pub mod delegation;
pub(crate) mod dispatch;
pub(crate) mod flow;
pub mod host;
/// One LLM call with bounded retries + cancel race (split from `turn`).
pub(crate) mod infer;
/// Live artifact refresh — latest-state blocks per call (ADR-033).
pub(crate) mod live;
/// Session tool registration (delegates, teams, loops, handoff, skills, spawn).
pub(crate) mod register;
/// Deterministic workflow-path phase steps (ADR-042).
pub(crate) mod scripted;
pub mod session;
pub(crate) mod turn;

pub use host::{RunHost, TestHost};
pub use session::{ProviderResolver, RunOutcome, RunSession, SessionInit};
