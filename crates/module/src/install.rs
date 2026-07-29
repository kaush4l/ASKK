//! The test-before-install runner (ADR-004) — split from registry.rs to
//! hold the 200-line rule.

use crate::error::ModuleError;
use crate::manifest::Manifest;
use crate::registry::Logic;

/// Execute a manifest's declared cases against its logic with all
/// capabilities denied plus case-declared stubs (ADR-004 test-before-install;
/// §7's contract-test stage). Tier-1 logic runs through `script` here; tier-0
/// built-ins run the identical cases from `core`'s own tests — same runner,
/// hosted natively (I3).
pub fn run_install_tests(manifest: &Manifest, logic: &Logic) -> Result<(), ModuleError> {
    let _ = (manifest, logic);
    todo!("G4")
}
