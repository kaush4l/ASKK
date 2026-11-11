//! # Files: the port to the workspace's files
//!
//! The workspace is where engines make projects (`core/places.rs`). It is not askk state, so it
//! does not go through the store; it goes through this port. The core and the elements say
//! *list, read, write*; the host does it on the disk (`host/workspace.rs`).
use std::path::Path;
use std::sync::{Arc, OnceLock};

pub trait Files: Send + Sync {
    /// The children of a folder as (name, is a folder), sorted by name. Nothing if it cannot
    /// be read.
    fn list(&self, dir: &Path) -> Vec<(String, bool)>;
    fn is_file(&self, file: &Path) -> bool;
    fn read(&self, file: &Path) -> Result<String, String>;
    /// Write a file, making the folders above it.
    fn write(&self, file: &Path, text: &str) -> Result<(), String>;
}

/// No files: what a build without a host has.
#[cfg_attr(test, allow(dead_code))]
struct Nothing;

impl Files for Nothing {
    fn list(&self, _: &Path) -> Vec<(String, bool)> {
        vec![]
    }
    fn is_file(&self, _: &Path) -> bool {
        false
    }
    fn read(&self, file: &Path) -> Result<String, String> {
        Err(format!("{}: no file access here", file.display()))
    }
    fn write(&self, file: &Path, _: &str) -> Result<(), String> {
        Err(format!("{}: no file access here", file.display()))
    }
}

static FILES: OnceLock<Arc<dyn Files>> = OnceLock::new();

/// Give the app its files (the host does this once, at start).
pub fn set(files: Arc<dyn Files>) {
    let _ = FILES.set(files);
}

/// The workspace's files.
pub fn files() -> Arc<dyn Files> {
    FILES.get_or_init(unset).clone()
}

#[cfg(not(test))]
fn unset() -> Arc<dyn Files> {
    Arc::new(Nothing)
}

/// Tests work on real temp folders.
#[cfg(test)]
fn unset() -> Arc<dyn Files> {
    Arc::new(crate::host::workspace::Disk)
}
