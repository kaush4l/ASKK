//! The manifest — ADR-004's contract, field for field. What a module claims
//! about itself; the host trusts it for narrowing only (Spike B: declared
//! capabilities are an upper bound, never a grant).

use serde::{Deserialize, Serialize};

use context::{Fidelity, Stability};
use kernel::{CapabilityId, ModuleId, Request, SectionId, Version};

/// One route a module serves. A struct (not a bare path) so the registry can
/// reject conflicts per method+path and later grow matching without a
/// contract change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RouteSpec {
    pub method: String,
    pub path: String,
}

/// Dashboard placement (§6: a module that declares a slot appears on the
/// dashboard — no frontend change, which is the whole reason the frontend
/// holds no logic).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlotSpec {
    pub slot: String,
    /// Ordering within the slot; ties resolve by module id (deterministic).
    pub order: u16,
}

/// The prompt section this module provides (§8.4: sections are modules).
/// Declares the §8.2 anatomy up front so stability enforcement and floor
/// checks happen at install, not at assembly.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SectionSpec {
    pub id: SectionId,
    /// Mandatory one-sentence intent — checked non-empty at install (§8.2).
    pub intent: String,
    pub stability: Stability,
    pub priority: u8,
    /// The declared compaction floor (ADR-009).
    pub floor: Fidelity,
}

/// The module's persisted-data shape (ADR-005): its KV prefix and its own
/// schema version, so module data migrates on the same ladder as app data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DataSchema {
    pub kv_prefix: String,
    pub version: u32,
}

/// Substrate tier (§10). An enum, not a u8, so a match on tier is exhaustive
/// and adding Tier-3 WASI later is a compiler-guided change (ADR-004).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Tier {
    /// Rust in-core (built-ins).
    T0Rust,
    /// Scripted (forged) modules — the self-extension default.
    T1Script,
    /// Worker-hosted instance (parallel agents).
    T2Worker,
    /// WASI module (native-speed tools; also the ADR-003 escape hatch).
    T3Wasi,
    /// container2wasm appliance — deferred past v1, port kept open.
    T4Appliance,
    /// On-device inference — later.
    T5LocalModel,
}

/// One assertion a declared test makes. Mirrors what Spike A's tests actually
/// asserted; deliberately tiny — richer matching is speculative until a
/// module needs it (PROMPT §13).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Assertion {
    StatusIs(u16),
    BodyContains(String),
}

/// One declared test case, executed before install in a deny-all context
/// (ADR-004: this is the §7 pipeline's contract-test phase).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Case {
    pub request: Request,
    pub assertions: Vec<Assertion>,
}

/// The module contract (ADR-004). Identity + claims; `description` feeds the
/// affordance document, so writing it well is writing the agent's manual.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Manifest {
    pub id: ModuleId,
    pub name: String,
    /// Monotonic; every version is kept, never overwritten (§7).
    pub version: Version,
    pub description: String,
    /// Required capabilities — the enforced upper bound (I6).
    pub capabilities: Vec<CapabilityId>,
    pub routes: Vec<RouteSpec>,
    pub slots: Vec<SlotSpec>,
    /// Present iff this module provides a prompt section (§8.4).
    pub section: Option<SectionSpec>,
    pub schema: DataSchema,
    pub tier: Tier,
    pub tests: Vec<Case>,
}
