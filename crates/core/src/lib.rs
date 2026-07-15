//! askk-core — the language-agnostic engine abstraction, pure domain only.
//! Sheet, Element, Contract, the Tool trait, Action, Signal, State, Phase,
//! and the Provider seam. No I/O, no wasm, no HTTP, no UI: everything here
//! is host-testable with mocks (ADR-009).
//!
//! Imports: nothing from the workspace (dependency rule 1). Imported by:
//! every other crate.
//!
//! See MAP.md and docs/NAVIGATION.md.

pub mod action;
pub mod context;
pub mod contract;
pub mod contracts;
pub mod element;
pub mod error;
pub mod phase;
pub mod provider;
pub mod request;
pub mod sheet;
pub mod signal;
pub mod state;
pub mod tool;
pub mod toolcall;
pub mod toon;

pub use action::{ActionId, ActionPolicy, ActionProposal, ActionRecord, PolicyDecision, Verdict};
pub use context::window_history;
pub use contract::{
    Action, Contract, FieldKind, FieldSpec, FormatNegotiator, OutputMode, ParseFailure,
    ParsedFormat, ParsedResponse,
};
pub use element::{Directive, Element, Identity, Skill};
pub use error::CoreError;
pub use phase::{
    route, LoopMode, Phase, PhaseFrame, PhaseStep, RouteOutcome, Routing, MAX_BACK_EDGES,
};
pub use provider::{Provider, ProviderError};
pub use request::{
    ContractWire, InferenceConfig, InferenceReply, InferenceRequest, Message, Part, Role,
    SectionKind, ToolCall, Usage,
};
pub use sheet::Sheet;
pub use signal::{fold, step, RunProjection, Signal, SignalKind};
pub use state::{Budgets, MemoryBlock, RunId, RunStatus, StateSnapshot};
pub use tool::{Effect, Tool, ToolCtx, ToolResult, ToolSet, ToolSpec};
