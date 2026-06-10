//! `ShellFs` — the shell's filesystem adapter.
//!
//! A thin seam between the shell and the storage backend with a fixed set of
//! method shapes (`read_file`, `write_file`, `delete`, `rename`, `mkdir`,
//! `list_all`) so the backend can be swapped without touching the shell or
//! its builtins. Backed by the OPFS workspace filesystem ([`OpfsVfs`]) — the
//! same store the explorer, the editor, and the runtimes operate on.

use crate::state::AppResult;
use crate::storage::opfs_vfs::OpfsVfs;

/// Filesystem handle the shell builtins operate on.
#[derive(Clone, Debug, Default)]
pub struct ShellFs {
    vfs: OpfsVfs,
}

impl ShellFs {
    /// A handle on the workspace filesystem.
    pub fn new() -> Self {
        Self::default()
    }

    /// Read a file's content. `None` when the path is missing — or names a
    /// directory, which has no text content.
    pub async fn read_file(&self, path: &str) -> AppResult<Option<String>> {
        self.vfs.read_file(path).await
    }

    /// Create or overwrite a file with `content`.
    pub async fn write_file(&self, path: &str, content: &str) -> AppResult<()> {
        self.vfs.write_file(path, content).await
    }

    /// Delete the entry at `path` (OPFS removes directories recursively; the
    /// `rm` builtin still guards non-empty directories itself).
    pub async fn delete(&self, path: &str) -> AppResult<()> {
        self.vfs.delete(path).await
    }

    /// Rename the entry at `from` to `to`.
    pub async fn rename(&self, from: &str, to: &str) -> AppResult<()> {
        self.vfs.rename(from, to).await
    }

    /// Create a directory at `path`.
    pub async fn mkdir(&self, path: &str) -> AppResult<()> {
        self.vfs.mkdir(path).await
    }

    /// Every stored entry as `(path, is_dir)`.
    pub async fn list_all(&self) -> AppResult<Vec<(String, bool)>> {
        Ok(self
            .vfs
            .list_all()
            .await?
            .into_iter()
            .map(|entry| (entry.path, entry.is_dir))
            .collect())
    }
}
