//! FEATURE: execution environment — the VM vertical: these tools run inside
//! the guest via the injected `ShellExec` seam; browser glue =
//! crates/browser/src/vm.rs (container2wasm Alpine); console UI =
//! crates/frontend/src/ui/vm.rs.

pub mod shell;
pub mod workspace;

pub use shell::{register_shell, ShellExec};
pub use workspace::register_workspace;
