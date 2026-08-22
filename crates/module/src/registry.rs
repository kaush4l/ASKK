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
    /// Rhai source (ADR-003). The interpreter is UNBUILT — `crates/script`
    /// went in increment 09 with no caller. The variant stays because the
    /// tier is a contract, not a constant: `dispatch` answers it 501 by name.
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
    /// Every (id, version) ever installed — versions are immutable history
    /// even after deactivation (§7).
    installed: Vec<(ModuleId, Version)>,
}

impl Registry {
    /// Empty registry; boot replays events into it.
    pub fn new() -> Registry {
        Registry::default()
    }

    /// Rebuild the fold from history — the boot path AND the time-travel
    /// path; one function so they cannot diverge (I8).
    pub fn replay(events: &[RegistryEvent]) -> Result<Registry, ModuleError> {
        let mut reg = Registry::new();
        for event in events {
            reg.apply(event.clone())?;
        }
        Ok(reg)
    }

    /// Apply one fact. Rejects route conflicts and duplicate versions at
    /// apply time so the fold is always internally consistent.
    pub fn apply(&mut self, event: RegistryEvent) -> Result<(), ModuleError> {
        match event {
            RegistryEvent::Installed { manifest, logic } => {
                self.check_admissible(&manifest)?;
                self.installed.push((manifest.id.clone(), manifest.version));
                self.active.push(Registered { manifest, logic });
                Ok(())
            }
            RegistryEvent::Deactivated { id, version } => {
                if !self.installed.contains(&(id.clone(), version)) {
                    return Err(ModuleError::UnknownVersion { id, version });
                }
                self.active
                    .retain(|r| !(r.manifest.id == id && r.manifest.version == version));
                Ok(())
            }
            // Reactivation needs the deactivated manifest bodies retained in
            // the fold — arrives with the forge's rollback story.
            RegistryEvent::Reactivated { .. } => todo!("G5: reactivate"),
        }
    }

    /// The shared admission judge for install-time and replay-time.
    fn check_admissible(&self, manifest: &Manifest) -> Result<(), ModuleError> {
        if manifest.id.0.is_empty() {
            return Err(ModuleError::InvalidManifest {
                id: manifest.id.clone(),
                message: "empty module id".into(),
            });
        }
        if let Some(section) = &manifest.section {
            if section.intent.trim().is_empty() {
                return Err(ModuleError::InvalidManifest {
                    id: manifest.id.clone(),
                    message: format!("section '{}' has empty intent (§8.2)", section.id.0),
                });
            }
        }
        if self
            .installed
            .contains(&(manifest.id.clone(), manifest.version))
        {
            return Err(ModuleError::VersionExists {
                id: manifest.id.clone(),
                version: manifest.version,
            });
        }
        for route in &manifest.routes {
            if let Some(holder) = self.resolve_route(&route.method, &route.path) {
                return Err(ModuleError::RouteConflict {
                    path: route.path.clone(),
                    holder: holder.manifest.id.clone(),
                });
            }
        }
        Ok(())
    }

    /// Validate + admit a new module version; returns the event to append.
    /// The ONE install path — built-ins go through it at boot too (ADR-004),
    /// which is what keeps the path honest.
    pub fn install(
        &mut self,
        manifest: Manifest,
        logic: Logic,
    ) -> Result<RegistryEvent, ModuleError> {
        let event = RegistryEvent::Installed { manifest, logic };
        self.apply(event.clone())?;
        Ok(event)
    }

    /// Roll back / uninstall one version; returns the event to append.
    pub fn deactivate(
        &mut self,
        id: &ModuleId,
        version: Version,
    ) -> Result<RegistryEvent, ModuleError> {
        let event = RegistryEvent::Deactivated {
            id: id.clone(),
            version,
        };
        self.apply(event.clone())?;
        Ok(event)
    }

    /// Restore a previously deactivated version (every version is kept).
    pub fn reactivate(
        &mut self,
        id: &ModuleId,
        version: Version,
    ) -> Result<RegistryEvent, ModuleError> {
        let _ = (id, version);
        todo!("G5: reactivate")
    }

    /// Everything currently alive — the affordance generator's input.
    pub fn active(&self) -> impl Iterator<Item = &Registered> {
        self.active.iter()
    }

    /// Route → module: the registry lookup dispatch consults (I4 data flow).
    pub fn resolve_route(&self, method: &str, path: &str) -> Option<&Registered> {
        self.active.iter().find(|r| {
            r.manifest
                .routes
                .iter()
                .any(|route| route.method == method && route.path == path)
        })
    }

    /// The active version of one module, if any.
    pub fn get(&self, id: &ModuleId) -> Option<&Registered> {
        self.active.iter().find(|r| &r.manifest.id == id)
    }
}
