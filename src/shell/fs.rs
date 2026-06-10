//! `ShellFs` — the shell's filesystem adapter.
//!
//! A thin seam between the shell and the storage backend with a fixed set of
//! method shapes (`read_file`, `write_file`, `delete`, `rename`, `mkdir`,
//! `list_all`) so the backend can be swapped without touching the shell or
//! its builtins. Today it is backed by the IndexedDB [`ProjectVfs`]; a
//! sibling unit is building an OPFS filesystem with the same shapes.
//
// COORDINATOR: swap backend to OpfsVfs at integration time (same method shapes).

use crate::state::AppResult;
use crate::storage::vfs::ProjectVfs;

/// Filesystem handle the shell builtins operate on.
#[derive(Clone, Debug, Default)]
pub struct ShellFs {
    vfs: ProjectVfs,
}

impl ShellFs {
    /// A handle on the workspace filesystem.
    pub fn new() -> Self {
        Self::default()
    }

    /// Read a file's content. `None` when the path is missing — or names a
    /// directory, which has no text content.
    pub async fn read_file(&self, path: &str) -> AppResult<Option<String>> {
        match self.vfs.read_entry(path).await? {
            Some(entry) if !entry.is_dir => Ok(Some(entry.content)),
            _ => Ok(None),
        }
    }

    /// Create or overwrite a file with `content`.
    pub async fn write_file(&self, path: &str, content: &str) -> AppResult<()> {
        self.vfs.write_file(path, content).await
    }

    /// Delete the single entry at `path` (recursion is the caller's job).
    pub async fn delete(&self, path: &str) -> AppResult<()> {
        self.vfs.delete(path).await
    }

    /// Rename the single entry at `from` to `to` (recursion is the caller's job).
    pub async fn rename(&self, from: &str, to: &str) -> AppResult<()> {
        self.vfs.rename(from, to).await
    }

    /// Create an explicit directory entry at `path`.
    pub async fn mkdir(&self, path: &str) -> AppResult<()> {
        self.vfs.mkdir(path).await
    }

    /// Every stored entry as `(path, is_dir)`.
    pub async fn list_all(&self) -> AppResult<Vec<(String, bool)>> {
        self.vfs.list_entries().await
    }
}
