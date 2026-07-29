//! Tier-1 substrate (§7 L2, ADR-003): forged module logic as Rhai source,
//! executed with zero ambient capability. Binding surface fixed by Spike B:
//! one Engine per module, capability closures with the effective grant set
//! baked in, effective = manifest-declared ∩ host-granted. Knows nothing of
//! agents, phases, or the registry (ARCHITECTURE §2) — it runs scripts.
//!
//! G3 interface freeze: types and signatures only; bodies are `todo!()`.

// G3 freeze: private fields are unread while bodies are todo!(); lift at G4.
#![allow(dead_code)]

mod error;

pub use error::ScriptError;

use kernel::{CapabilityGrant, CapabilityId, ModuleId, Request, Response, StoreError, Timestamp};

/// Runaway-script ceilings (Spike B, test-proven). Data, not policy: the
/// values live in one place so the forge's dry run and production execution
/// cannot drift apart.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub max_operations: u64,
    pub max_call_levels: usize,
    pub max_expr_depth: usize,
    pub max_string_size: usize,
    pub max_array_size: usize,
    pub max_map_size: usize,
}

impl Limits {
    /// The Spike B ceilings. A constructor rather than `Default` so the call
    /// site says whose numbers these are.
    pub fn spike_proven() -> Limits {
        todo!("G4")
    }
}

/// The host functions a granted capability binds to. Each is pre-scoped by
/// `core` (prefix baked in, endpoint resolved) before it arrives here, so the
/// script world can only ever see its own slice (I6). `None` = not granted =
/// the function denies with a typed error — default deny is what falls out
/// when nothing else exists in the script's world (Spike B).
///
/// PROVISIONAL: closures are sync — Rhai execution is sync, so async stores
/// must be bridged by `core` (pre-loaded snapshot or write-behind); the
/// bridge design is a G4 decision this signature deliberately doesn't make.
pub struct HostFns {
    pub clock_now: Option<Box<dyn Fn() -> Timestamp>>,
    pub kv_get: Option<Box<dyn Fn(&str) -> Result<Option<String>, StoreError>>>,
    pub kv_put: Option<Box<dyn Fn(&str, &str) -> Result<(), StoreError>>>,
    /// Append a Custom event (kind, payload_json) — observation is a
    /// capability too (I8).
    pub emit: Option<Box<dyn Fn(&str, &str)>>,
}

impl HostFns {
    /// All-deny: the forge dry run's context (§7: "dry run with all
    /// capabilities denied"). Exists so deny-all is a named thing tests
    /// share, not four `None`s someone forgets one of.
    pub fn deny_all() -> HostFns {
        todo!("G4")
    }
}

/// Effective grants = declared ∩ host-granted (Spike B: an undeclared
/// capability is denied even if the host could provide it — the manifest is
/// an enforced upper bound, never a grant). Public because the forge's
/// capability-review step renders exactly this result.
pub fn effective_grants(
    declared: &[CapabilityId],
    granted: &[CapabilityGrant],
) -> Vec<CapabilityGrant> {
    let _ = (declared, granted);
    todo!("G4")
}

/// One compiled module: its per-module Engine (capability closures baked in)
/// plus its AST. Opaque on purpose — Rhai types must not leak into any other
/// crate's signatures, or the quarantine boundary is fiction.
pub struct ScriptModule {
    engine: rhai::Engine,
    ast: rhai::AST,
    module_id: ModuleId,
}

impl ScriptModule {
    /// Which module this engine serves; public so dispatch errors can name it.
    pub fn module_id(&self) -> &ModuleId {
        todo!("G4")
    }
}

/// Compile source into a ready module with its capability world sealed at
/// compile time — grants can never change under a running script, which is
/// what makes revocation clean (I10: next invocation simply lacks the fn).
pub fn compile(
    module_id: &ModuleId,
    source: &str,
    host: HostFns,
    limits: &Limits,
) -> Result<ScriptModule, ScriptError> {
    let _ = (module_id, source, host, limits);
    todo!("G4")
}

/// Invoke the module's `handle(request) -> response` (§6 logic contract) —
/// the one entry point script logic exposes. Kernel `Request`/`Response`
/// cross the boundary so a forged module and a built-in are called with the
/// same shapes (I9).
pub fn call_handle(module: &ScriptModule, req: &Request) -> Result<Response, ScriptError> {
    let _ = (module, req);
    todo!("G4")
}
