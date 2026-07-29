//! Spike B — a forged module round-trip (PROMPT §6/§7).
//!
//! Proves: a module whose logic is a Rhai source STRING (data, not compiled in)
//! can be registered into a route table at runtime, serve a route, render an
//! HTML fragment, and live under default-deny capabilities. Denial is a typed
//! error surfaced to the host — never a panic, never silent success.

mod error;

pub use error::ForgeError;

use error::{denied, host_error};
use rhai::{Engine, EvalAltResult, Scope, AST};
use std::collections::{HashMap, HashSet};

/// Closed set of host capabilities. Closed on purpose: the runtime enforces the
/// manifest, so the manifest vocabulary must be types, not strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Capability {
    ClockNow,
    KvGet,
}

/// What a module claims about itself. The host trusts this for *narrowing*
/// only: declared capabilities are an upper bound, never a grant.
#[derive(Debug, Clone)]
pub struct Manifest {
    pub id: String,
    pub route: String,
    pub capabilities: Vec<Capability>,
}

/// A module is data: manifest + logic-as-source. Nothing here is compiled in.
#[derive(Debug, Clone)]
pub struct Module {
    pub manifest: Manifest,
    pub script: String,
}

/// A registered module: its manifest plus a per-module Engine whose capability
/// functions have the effective grant set baked into their closures. One
/// engine per module is the whole isolation story at this spike's scale.
struct Loaded {
    manifest: Manifest,
    engine: Engine,
    ast: AST,
}

/// The host: a tiny route table plus the capability policy (`granted`) and the
/// injected deterministic clock (the spike's one real capability value).
pub struct Host {
    granted: HashSet<Capability>,
    clock: i64,
    routes: HashMap<String, Loaded>,
}

impl Host {
    pub fn new(granted: &[Capability], clock: i64) -> Self {
        Self {
            granted: granted.iter().copied().collect(),
            clock,
            routes: HashMap::new(),
        }
    }

    /// Register a module from data. Effective grants = declared ∩ host-granted,
    /// so an undeclared capability is denied even if the host could provide it.
    pub fn register(&mut self, module: Module) -> Result<(), ForgeError> {
        let Module { manifest, script } = module;
        if self.routes.contains_key(&manifest.route) {
            return Err(ForgeError::RouteConflict(manifest.route));
        }
        let effective: HashSet<Capability> = manifest
            .capabilities
            .iter()
            .filter(|c| self.granted.contains(c))
            .copied()
            .collect();

        let engine = self.build_engine(&effective);
        let ast = engine.compile(&script).map_err(|e| ForgeError::Script {
            module_id: manifest.id.clone(),
            message: e.to_string(),
        })?;

        let route = manifest.route.clone();
        let loaded = Loaded {
            manifest,
            engine,
            ast,
        };
        self.routes.insert(route, loaded);
        Ok(())
    }

    /// Dispatch: path → module → run script `handle()` → HTML fragment.
    pub fn handle(&self, path: &str) -> Result<String, ForgeError> {
        let loaded = self
            .routes
            .get(path)
            .ok_or_else(|| ForgeError::RouteNotFound(path.to_string()))?;
        let mut scope = Scope::new();
        loaded
            .engine
            .call_fn::<String>(&mut scope, &loaded.ast, "handle", ())
            .map_err(|err| host_error(&loaded.manifest.id, &err))
    }

    /// Every capability is registered on every engine; ungranted ones are
    /// registered as deniers. Default deny falls out: nothing else exists in
    /// the script's world at all (rhai has no ambient fs/net/env).
    fn build_engine(&self, effective: &HashSet<Capability>) -> Engine {
        let mut engine = Engine::new();
        // Runaway-script limits (recorded in README; test-proven).
        engine.set_max_operations(100_000);
        engine.set_max_call_levels(32);
        engine.set_max_expr_depths(64, 64);
        engine.set_max_string_size(64 * 1024);
        engine.set_max_array_size(1_000);
        engine.set_max_map_size(1_000);

        let ok = effective.contains(&Capability::ClockNow);
        let clock = self.clock;
        engine.register_fn("clock_now", move || -> Result<i64, Box<EvalAltResult>> {
            if ok {
                Ok(clock)
            } else {
                Err(denied(Capability::ClockNow))
            }
        });

        let ok = effective.contains(&Capability::KvGet);
        engine.register_fn(
            "kv_get",
            move |key: &str| -> Result<String, Box<EvalAltResult>> {
                // ponytail: fixed stub value; a real KV store is another spike.
                if ok {
                    Ok(format!("kv:{key}"))
                } else {
                    Err(denied(Capability::KvGet))
                }
            },
        );
        engine
    }
}
