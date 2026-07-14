//! FEATURE: execution environment — the VM vertical: these tools run inside
//! the guest via the injected `ShellExec` seam; browser glue =
//! web/src/host/vm.rs (v86 + container2wasm); console UI = web/src/ui/vm.rs.

pub mod shell;
pub mod workspace;

pub use shell::{register_shell, ShellExec};
pub use workspace::register_workspace;
