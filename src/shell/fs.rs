//! `ShellFs` — the shell's filesystem adapter.
//!
//! A thin seam between the shell and the storage backend with a fixed set of
//! method shapes (`read_file`, `write_file`, `delete`, `rename`, `mkdir`,
//! `list_all`) so the backend can be swapped without touching the shell or
//! its builtins. Backed by the OPFS workspace filesystem ([`OpfsVfs`]) — the
//! same store the explorer, the editor, and the runtimes operate on.
//!
//! Under `cfg(test)` the same seam can be backed by an in-memory store
//! ([`ShellFs::in_memory`]) so the pipe/redirect/glob orchestration is
//! host-testable end to end. This is a test double for the *same* contract, not
//! a second production filesystem layer — production still goes through OPFS.

use crate::state::AppResult;
use crate::storage::opfs_vfs::OpfsVfs;

/// Filesystem handle the shell builtins operate on.
#[derive(Clone, Debug, Default)]
pub struct ShellFs {
    backend: Backend,
}

/// The storage the seam delegates to. Production is always [`Backend::Opfs`];
/// [`Backend::Memory`] exists only for host tests.
#[derive(Clone, Debug)]
enum Backend {
    Opfs(OpfsVfs),
    #[cfg(test)]
    Memory(self::memory::MemoryFs),
}

impl Default for Backend {
    fn default() -> Self {
        Backend::Opfs(OpfsVfs::default())
    }
}

impl ShellFs {
    /// A handle on the workspace filesystem (OPFS).
    pub fn new() -> Self {
        Self::default()
    }

    /// An in-memory handle seeded with `entries` (`(path, is_dir)`), for host
    /// tests of the shell's pipe/redirect/glob plumbing.
    #[cfg(test)]
    pub fn in_memory(entries: &[(&str, &str)]) -> Self {
        Self {
            backend: Backend::Memory(self::memory::MemoryFs::seeded(entries)),
        }
    }

    /// Read a file's content. `None` when the path is missing — or names a
    /// directory, which has no text content.
    pub async fn read_file(&self, path: &str) -> AppResult<Option<String>> {
        match &self.backend {
            Backend::Opfs(vfs) => vfs.read_file(path).await,
            #[cfg(test)]
            Backend::Memory(mem) => mem.read_file(path),
        }
    }

    /// Create or overwrite a file with `content`.
    pub async fn write_file(&self, path: &str, content: &str) -> AppResult<()> {
        match &self.backend {
            Backend::Opfs(vfs) => vfs.write_file(path, content).await,
            #[cfg(test)]
            Backend::Memory(mem) => mem.write_file(path, content),
        }
    }

    /// Delete the entry at `path` (OPFS removes directories recursively; the
    /// `rm` builtin still guards non-empty directories itself).
    pub async fn delete(&self, path: &str) -> AppResult<()> {
        match &self.backend {
            Backend::Opfs(vfs) => vfs.delete(path).await,
            #[cfg(test)]
            Backend::Memory(mem) => mem.delete(path),
        }
    }

    /// Rename the entry at `from` to `to`.
    pub async fn rename(&self, from: &str, to: &str) -> AppResult<()> {
        match &self.backend {
            Backend::Opfs(vfs) => vfs.rename(from, to).await,
            #[cfg(test)]
            Backend::Memory(mem) => mem.rename(from, to),
        }
    }

    /// Create a directory at `path`.
    pub async fn mkdir(&self, path: &str) -> AppResult<()> {
        match &self.backend {
            Backend::Opfs(vfs) => vfs.mkdir(path).await,
            #[cfg(test)]
            Backend::Memory(mem) => mem.mkdir(path),
        }
    }

    /// Every stored entry as `(path, is_dir)`.
    pub async fn list_all(&self) -> AppResult<Vec<(String, bool)>> {
        match &self.backend {
            Backend::Opfs(vfs) => Ok(vfs
                .list_all()
                .await?
                .into_iter()
                .map(|entry| (entry.path, entry.is_dir))
                .collect()),
            #[cfg(test)]
            Backend::Memory(mem) => Ok(mem.list_all()),
        }
    }
}

/// In-memory backend for host tests of the shell. Mirrors the OPFS method
/// contract the shell depends on; not compiled into production builds.
#[cfg(test)]
mod memory {
    use crate::state::AppResult;
    use std::cell::RefCell;
    use std::collections::BTreeMap;
    use std::rc::Rc;

    /// A tiny copy-on-write store of `path -> content` for files plus a set of
    /// explicit (possibly empty) directories. Interior mutability so the seam's
    /// `&self` methods can mutate, matching how `OpfsVfs` presents `&self`.
    #[derive(Clone, Debug, Default)]
    pub struct MemoryFs {
        inner: Rc<RefCell<Inner>>,
    }

    #[derive(Debug, Default)]
    struct Inner {
        files: BTreeMap<String, String>,
        dirs: std::collections::BTreeSet<String>,
    }

    impl MemoryFs {
        /// Seed from `(path, kind)` pairs where `kind` is `"dir"` for an
        /// explicit directory or the file's content otherwise.
        pub fn seeded(entries: &[(&str, &str)]) -> Self {
            let fs = Self::default();
            {
                let mut inner = fs.inner.borrow_mut();
                for (path, kind) in entries {
                    if *kind == "dir" {
                        inner.dirs.insert((*path).to_string());
                    } else {
                        inner.files.insert((*path).to_string(), (*kind).to_string());
                    }
                }
            }
            fs
        }

        pub fn read_file(&self, path: &str) -> AppResult<Option<String>> {
            Ok(self.inner.borrow().files.get(path).cloned())
        }

        pub fn write_file(&self, path: &str, content: &str) -> AppResult<()> {
            self.inner
                .borrow_mut()
                .files
                .insert(path.to_string(), content.to_string());
            Ok(())
        }

        pub fn delete(&self, path: &str) -> AppResult<()> {
            let prefix = format!("{path}/");
            let mut inner = self.inner.borrow_mut();
            inner
                .files
                .retain(|key, _| key != path && !key.starts_with(&prefix));
            inner
                .dirs
                .retain(|key| key != path && !key.starts_with(&prefix));
            Ok(())
        }

        pub fn rename(&self, from: &str, to: &str) -> AppResult<()> {
            let prefix = format!("{from}/");
            let mut inner = self.inner.borrow_mut();
            let moved: Vec<(String, String)> = inner
                .files
                .keys()
                .filter(|key| *key == from || key.starts_with(&prefix))
                .map(|key| (key.clone(), format!("{to}{}", &key[from.len()..])))
                .collect();
            for (key, dest) in moved {
                if let Some(content) = inner.files.remove(&key) {
                    inner.files.insert(dest, content);
                }
            }
            let moved_dirs: Vec<(String, String)> = inner
                .dirs
                .iter()
                .filter(|key| *key == from || key.starts_with(&prefix))
                .map(|key| (key.clone(), format!("{to}{}", &key[from.len()..])))
                .collect();
            for (key, dest) in moved_dirs {
                inner.dirs.remove(&key);
                inner.dirs.insert(dest);
            }
            Ok(())
        }

        pub fn mkdir(&self, path: &str) -> AppResult<()> {
            self.inner.borrow_mut().dirs.insert(path.to_string());
            Ok(())
        }

        pub fn list_all(&self) -> Vec<(String, bool)> {
            let inner = self.inner.borrow();
            let mut out: Vec<(String, bool)> = Vec::new();
            for path in inner.files.keys() {
                out.push((path.clone(), false));
            }
            for path in &inner.dirs {
                out.push((path.clone(), true));
            }
            out.sort();
            out
        }
    }
}
