//! The adapter-boundary error. Exists to translate browser failures (DOM
//! exceptions, fetch rejections) into the kernel's typed port errors in one
//! audited place — and to carry what couldn't be translated to the JS side.

/// What the web adapters can fail on before a kernel error type applies.
/// Small on purpose: anything nameable belongs in the kernel port errors;
/// this is the residue.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WebError {
    /// The environment lacks a required API (no IndexedDB in this context,
    /// no crypto) — surfaced as absent capability, not a crash (I15).
    MissingApi { api: String },
    /// A JS exception that fit no port error; message preserved for the log.
    Js { message: String },
}
