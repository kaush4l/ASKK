//! The registry — a fold of an append-only event log (ADR-004, I8). Every
//! version kept; rollback appends, never erases (I10). Built-ins replay
//! through the same events at boot, so the log is the single source of truth
//! for everything that exists.

use serde::{Deserialize, Serialize};

use kernel::{ModuleId, Version};

use crate::error::ModuleError;
use crate::manifest::Manifest;

/// A module's logic reference (ADR-004 Option B). `BuiltIn` carries no
/// function pointer on purpose: the tier-0 dispatch table lives in exactly
/// one file in `core`, keyed by module id — so no code here (or anywhere
/// else) can call a built-in directly, and I9 holds by construction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Logic {
    BuiltIn,
    /// Rhai source, compiled by `script` at activation (ADR-003).
    Script {
        source: String,
    },
}

/// Registry facts (ADR-004). The manifest rides `Installed` because the fold
/// must be reconstructible from the log alone — the log IS the registry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RegistryEvent {
    Installed {
        manifest: Manifest,
        logic: Logic,
    },
    /// Rollback/uninstall: removes the version from existence (routes,
    /// affordances, sections) without erasing history (§7, I10).
    Deactivated {
        id: ModuleId,
        version: Version,
    },
    Reactivated {
        id: ModuleId,
        version: Version,
    },
}

/// One live entry of the fold: what dispatch and affordances read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Registered {
    pub manifest: Manifest,
    pub logic: Logic,
}

/// The live fold. Fields private: the only way in is `apply`/`install`, the
/// only way out is queries — there is no API that filters by origin, which is
/// the structural half of I9 (erosion is impossible to write).
#[derive(Debug, Default)]
pub struct Registry {
    active: Vec<Registered>,
}

impl Registry {
    /// Empty registry; boot replays events into it.
    pub fn new() -> Registry {
        todo!("G4")
    }

    /// Rebuild the fold from history — the boot path AND the time-travel
    /// path; one function so they cannot diverge (I8).
    pub fn replay(events: &[RegistryEvent]) -> Result<Registry, ModuleError> {
        let _ = events;
        todo!("G4")
    }

    /// Apply one fact. Rejects route conflicts and duplicate versions at
    /// apply time so the fold is always internally consistent.
    pub fn apply(&mut self, event: RegistryEvent) -> Result<(), ModuleError> {
        let _ = event;
        todo!("G4")
    }

    /// Validate + admit a new module version; returns the event to append.
    /// The ONE install path — built-ins go through it at boot too (ADR-004),
    /// which is what keeps the path honest.
    pub fn install(
        &mut self,
        manifest: Manifest,
        logic: Logic,
    ) -> Result<RegistryEvent, ModuleError> {
        let _ = (manifest, logic);
        todo!("G4")
    }

    /// Roll back / uninstall one version; returns the event to append.
    pub fn deactivate(
        &mut self,
        id: &ModuleId,
        version: Version,
    ) -> Result<RegistryEvent, ModuleError> {
        let _ = (id, version);
        todo!("G4")
    }

    /// Restore a previously deactivated version (every version is kept).
    pub fn reactivate(
        &mut self,
        id: &ModuleId,
        version: Version,
    ) -> Result<RegistryEvent, ModuleError> {
        let _ = (id, version);
        todo!("G4")
    }

    /// Everything currently alive — the affordance generator's input.
    pub fn active(&self) -> impl Iterator<Item = &Registered> {
        self.active.iter()
    }

    /// Route → module: the registry lookup dispatch consults (I4 data flow).
    pub fn resolve_route(&self, method: &str, path: &str) -> Option<&Registered> {
        let _ = (method, path);
        todo!("G4")
    }

    /// The active version of one module, if any.
    pub fn get(&self, id: &ModuleId) -> Option<&Registered> {
        let _ = id;
        todo!("G4")
    }
}

/// Execute a manifest's declared cases against its logic with all
/// capabilities denied plus case-declared stubs (ADR-004 test-before-install;
/// §7's contract-test stage). Tier-1 logic runs through `script` here; tier-0
/// built-ins run the identical cases from `core`'s own tests — same runner,
/// hosted natively (I3).
pub fn run_install_tests(manifest: &Manifest, logic: &Logic) -> Result<(), ModuleError> {
    let _ = (manifest, logic);
    todo!("G4")
}
