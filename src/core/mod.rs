//! Core pillar — the pure programming solution to an agent.
//!
//! An agent is a bounded loop over a message-state. Each turn renders that
//! state into one "big sheet of paper" (an `InferenceRequest` carrying text
//! plus optional image/audio [`Part`]s), sends it to the model, and either
//! accepts a final answer or executes tool calls and feeds their results back
//! as untrusted data.
//!
//! The shape is the classic abstract-base / template-method design, in Rust
//! terms:
//!
//! - [`Engine`] is the abstract base: two required state accessors plus the
//!   one abstract method [`Engine::invoke`]; everything else (render, history,
//!   tool execution, the model call with retry) is a default method — the
//!   superclass body concrete engines inherit.
//! - [`BaseEngine`] is the shared state record every engine owns — the fields
//!   the `LocalAgents` reference keeps on `BaseAgent` (tool map, history,
//!   inference attached at construction, prompt inputs).
//! - [`ReactEngine`] is the concrete engine: it overrides exactly one method,
//!   `invoke` — the ReAct while-loop.
//!
//! A sub-agent is an ordinary [`ToolMap`] entry (wrapped at bind time by the
//! shell), so delegation and tool use are the same operation to the loop.
//!
//! This module is platform-free: no `cfg(target_arch)`, no web APIs, no I/O
//! beyond what the injected [`InferenceHandle`] and [`ToolBinding`]s perform.
//! It is unit-tested on the host with a mock inference and closure bindings.
//! Everything above it — strategies, workflow gates, validators, events,
//! persistence — lives in the shell (`crate::engine`) and reaches the loop
//! only through [`EngineHooks`].

mod content;
mod engine;
mod react;
mod tooling;

pub use content::{MultimodalCollector, Part};
pub use engine::{
    AnswerVerdict, BaseEngine, Engine, EngineHooks, EngineOutcome, InferenceHandle, LocalInference,
    NoHooks, Sleeper, StopReason, ToolVerdict, noop_sleeper,
};
pub use react::ReactEngine;
pub use tooling::{ToolBinding, ToolFuture, ToolMap, disallowed_tool_result};

#[cfg(test)]
mod tests;
