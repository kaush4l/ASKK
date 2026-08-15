//! Identifier newtypes. Public because every crate names these things; newtypes
//! (not bare `String`) so a module id can never be passed where a section id
//! was meant — the compiler is the reviewer this solo project doesn't have.

use serde::{Deserialize, Serialize};

/// Names one Module (GLOSSARY: Module) across manifest, registry, routes,
/// affordances, and provenance. Public: it is the join key of the whole system.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ModuleId(pub String);

/// Names one Section of the paper (§8.2 `id`: "soul", "history", …). Public:
/// phase configs, providers, and compaction reports all address sections by it.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct SectionId(pub String);

/// Monotonic module version (ADR-004). Public: every version is kept, so
/// registry events and storage keys must name which one they mean.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Version(pub u32);

/// Names one Event in the log. Public: replay, projection, and the trace
/// viewer all reference events by identity, not position.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct EventId(pub u64);

/// Names one Agent (§10: one Worker per agent). Public: `Effect::Spawn` and
/// per-agent state keys need a stable handle before the Worker exists.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AgentId(pub String);

/// Names one tool a Work phase may invoke. Public: `ToolScope::Only` and
/// `Effect::InvokeTool` must agree on what a tool is called.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ToolId(pub String);

/// Symbolic outbound endpoint name (ADR-006: "model", never a raw URL).
/// Public: the broker resolves it; modules and effects may only speak it.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct EndpointName(pub String);

/// The two names this build resolves. Here rather than in either consumer
/// because BOTH have to spell them the same way: the core names an endpoint
/// and the adapter's allowlist is keyed by it, and two spellings would deny a
/// configured destination with nothing to say why (increment 21).
pub const MODEL_ENDPOINT: &str = "model";
pub const SEARCH_ENDPOINT: &str = "search";

/// Milliseconds since Unix epoch, injected via `ClockPort` (I7: time is data).
/// Public: provenance stamps and events carry it; nothing calls a real clock.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Timestamp(pub i64);

/// The phase vocabulary (§9, ADR-010). Lives in L0 because both `context`
/// (a Document records its phase) and `agent` (the machine walks phases) need
/// it, and neither may import the other's crate. PROVISIONAL: a closed enum —
/// "others as earned" would reopen this as a newtype string; reversal is a
/// rename plus one match removal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PhaseId {
    /// Plan-on-demand, not mandatory (RESEARCH phase-cut finding).
    Plan,
    Work,
    Verify,
}
