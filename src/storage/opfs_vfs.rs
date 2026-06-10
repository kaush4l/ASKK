//! OPFS-backed workspace filesystem.
//!
//! [`OpfsVfs`] roots the workspace at an OPFS directory named `workspace` under
//! `navigator.storage.getDirectory()`. Unlike the legacy IndexedDB [`ProjectVfs`]
//! (flat key/value), OPFS gives real directories, so delete/rename/mkdir and an
//! accurate recursive listing are possible. All operations run on the main thread
//! via `wasm-bindgen-futures` (the async OPFS API does not need a worker).
//!
//! Paths are relative and `/`-separated. Leading `/`, empty segments, `.` and
//! `..` are rejected with a clear error.
//!
//! On first use per page load, every public method runs the one-time IndexedDB →
//! OPFS migration (see [`OpfsVfs::ensure_migrated`]): if the OPFS workspace root
//! is empty and the legacy [`ProjectVfs`] store has keys, the files are copied
//! across and a marker file is written so the check never copies twice.

use crate::state::AppResult;
use crate::storage::vfs::ProjectVfs;
use js_sys::{Array, AsyncIterator, IteratorNext, Reflect, Uint8Array};
use std::cell::Cell;
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;
use web_sys::{
    File, FileSystemDirectoryHandle, FileSystemFileHandle, FileSystemGetDirectoryOptions,
    FileSystemGetFileOptions, FileSystemHandle, FileSystemHandleKind, FileSystemRemoveOptions,
    FileSystemWritableFileStream,
};

/// Name of the workspace root directory under the OPFS origin root.
const WORKSPACE_DIR: &str = "workspace";

/// Marker file written at the workspace root after the one-time IndexedDB →
/// OPFS migration. Hidden from [`OpfsVfs::list_all`] so it never shows in the
/// file tree.
pub const MIGRATION_MARKER: &str = ".askk-migrated";

thread_local! {
    /// Per-page-load memo so the migration marker is read at most once.
    static MIGRATION_DONE: Cell<bool> = const { Cell::new(false) };
}

/// One entry in the workspace tree, as returned by [`OpfsVfs::list_all`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FsEntry {
    /// Relative `/`-separated path from the workspace root.
    pub path: String,
    /// `true` for directories (OPFS directories are real, including empty ones).
    pub is_dir: bool,
}

/// OPFS-backed filesystem rooted at the OPFS directory `workspace`.
#[derive(Clone, Debug, Default)]
pub struct OpfsVfs {}

impl OpfsVfs {
    pub fn new() -> Self {
        Self {}
    }

    /// Read a file as UTF-8 text. `Ok(None)` when the path does not exist.
    pub async fn read_file(&self, path: &str) -> AppResult<Option<String>> {
        self.ensure_migrated().await?;
        self.read_file_inner(path).await
    }

    /// Write (create or overwrite) a file with UTF-8 text, creating parent
    /// directories as needed.
    pub async fn write_file(&self, path: &str, content: &str) -> AppResult<()> {
        self.ensure_migrated().await?;
        self.write_file_inner(path, content).await
    }

    /// Read a file as raw bytes (e.g. `.wasm`). `Ok(None)` when the path does
    /// not exist. Part of the shared workspace-FS contract; binary consumers
    /// (sandbox/runner units) call it, this module does not.
    #[allow(dead_code)]
    pub async fn read_bytes(&self, path: &str) -> AppResult<Option<Vec<u8>>> {
        self.ensure_migrated().await?;
        self.read_bytes_inner(path).await
    }

    /// Write (create or overwrite) a file with raw bytes, creating parent
    /// directories as needed. Part of the shared workspace-FS contract; binary
    /// consumers (sandbox/runner units) call it, this module does not.
    #[allow(dead_code)]
    pub async fn write_bytes(&self, path: &str, content: &[u8]) -> AppResult<()> {
        self.ensure_migrated().await?;
        self.write_bytes_inner(path, content).await
    }

    /// Delete a file or directory; directories are removed recursively.
    pub async fn delete(&self, path: &str) -> AppResult<()> {
        self.ensure_migrated().await?;
        let segments = validate_path(path).map_err(|err| format!("OPFS delete error: {err}"))?;
        let (parent, name) = split_parent(&segments);
        let root = self.root().await?;
        let dir = self
            .dir_at(&root, parent, false)
            .await
            .map_err(|err| format!("OPFS delete error: {err}"))?
            .ok_or_else(|| format!("OPFS delete error: no such file or directory: {path}"))?;
        let options = FileSystemRemoveOptions::new();
        options.set_recursive(true);
        match JsFuture::from(dir.remove_entry_with_options(name, &options)).await {
            Ok(_) => Ok(()),
            Err(err) if is_not_found(&err) => Err(format!(
                "OPFS delete error: no such file or directory: {path}"
            )),
            Err(err) => Err(format!("OPFS delete error: {path}: {}", js_message(&err))),
        }
    }

    /// Rename (or move) a file or directory. The destination must not already
    /// exist. Implemented as copy + delete, since OPFS has no portable move.
    pub async fn rename(&self, from: &str, to: &str) -> AppResult<()> {
        self.ensure_migrated().await?;
        validate_path(from).map_err(|err| format!("OPFS rename error: {err}"))?;
        validate_path(to).map_err(|err| format!("OPFS rename error: {err}"))?;
        if from == to {
            return Ok(());
        }
        if path_is_or_under(to, from) {
            return Err(format!(
                "OPFS rename error: cannot move '{from}' inside itself ('{to}')"
            ));
        }
        let is_dir = self
            .entry_kind(from)
            .await?
            .ok_or_else(|| format!("OPFS rename error: no such file or directory: {from}"))?;
        if self.entry_kind(to).await?.is_some() {
            return Err(format!(
                "OPFS rename error: destination already exists: {to}"
            ));
        }
        if is_dir {
            self.mkdir_inner(to).await?;
            // Sorted paths put parent directories before their contents.
            let entries = self.list_all_inner().await?;
            for entry in entries {
                if !path_is_or_under(&entry.path, from) || entry.path == from {
                    continue;
                }
                let target = swap_prefix(&entry.path, from, to);
                if entry.is_dir {
                    self.mkdir_inner(&target).await?;
                } else {
                    self.copy_file_inner(&entry.path, &target).await?;
                }
            }
        } else {
            self.copy_file_inner(from, to).await?;
        }
        self.delete(from).await
    }

    /// Create a directory (and any missing parents).
    pub async fn mkdir(&self, path: &str) -> AppResult<()> {
        self.ensure_migrated().await?;
        self.mkdir_inner(path).await
    }

    /// Recursively list every file and directory, sorted by path. The
    /// migration marker file is hidden.
    pub async fn list_all(&self) -> AppResult<Vec<FsEntry>> {
        self.ensure_migrated().await?;
        let mut entries = self.list_all_inner().await?;
        entries.retain(|entry| entry.path != MIGRATION_MARKER);
        Ok(entries)
    }

    // ---- migration -------------------------------------------------------

    /// One-time IndexedDB → OPFS migration, memoized per page load. If the
    /// OPFS workspace root is empty and the legacy [`ProjectVfs`] store has
    /// keys, copy every file across, then write [`MIGRATION_MARKER`].
    async fn ensure_migrated(&self) -> AppResult<()> {
        if MIGRATION_DONE.with(Cell::get) {
            return Ok(());
        }
        self.migrate_inner().await?;
        MIGRATION_DONE.with(|done| done.set(true));
        Ok(())
    }

    async fn migrate_inner(&self) -> AppResult<()> {
        if self.read_file_inner(MIGRATION_MARKER).await?.is_some() {
            return Ok(());
        }
        if self.list_all_inner().await?.is_empty() {
            let legacy = ProjectVfs::new();
            let keys = legacy
                .list_files()
                .await
                .map_err(|err| format!("OPFS migration error: {err}"))?;
            for key in keys {
                let normalized = key.trim_start_matches('/');
                if validate_path(normalized).is_err() {
                    continue; // skip legacy keys that don't map to a valid path
                }
                if let Some(content) = legacy
                    .read_file(&key)
                    .await
                    .map_err(|err| format!("OPFS migration error: {err}"))?
                {
                    self.write_file_inner(normalized, &content).await?;
                }
            }
        }
        self.write_file_inner(MIGRATION_MARKER, "v1").await
    }

    // ---- internals (no migration check; used by the migration itself) -----

    async fn root(&self) -> AppResult<FileSystemDirectoryHandle> {
        let storage = storage_manager()?;
        let origin_root = await_js(storage.get_directory(), "OPFS error: origin filesystem")
            .await?
            .dyn_into::<FileSystemDirectoryHandle>()
            .map_err(|_| "OPFS error: unexpected origin root handle type".to_string())?;
        let options = FileSystemGetDirectoryOptions::new();
        options.set_create(true);
        await_js(
            origin_root.get_directory_handle_with_options(WORKSPACE_DIR, &options),
            "OPFS error: workspace root",
        )
        .await?
        .dyn_into::<FileSystemDirectoryHandle>()
        .map_err(|_| "OPFS error: unexpected workspace root handle type".to_string())
    }

    /// Walk `segments` of directories below `start`. With `create` the chain
    /// is created; without it, `Ok(None)` means some segment does not exist.
    async fn dir_at(
        &self,
        start: &FileSystemDirectoryHandle,
        segments: &[String],
        create: bool,
    ) -> AppResult<Option<FileSystemDirectoryHandle>> {
        let mut current = start.clone();
        for segment in segments {
            let promise = if create {
                let options = FileSystemGetDirectoryOptions::new();
                options.set_create(true);
                current.get_directory_handle_with_options(segment, &options)
            } else {
                current.get_directory_handle(segment)
            };
            current = match JsFuture::from(promise).await {
                Ok(handle) => handle
                    .dyn_into::<FileSystemDirectoryHandle>()
                    .map_err(|_| format!("unexpected handle type for directory '{segment}'"))?,
                Err(err) if is_not_found(&err) => return Ok(None),
                Err(err) if is_type_mismatch(&err) => {
                    return Err(format!("'{segment}' exists but is not a directory"));
                }
                Err(err) => {
                    return Err(format!("directory '{segment}': {}", js_message(&err)));
                }
            };
        }
        Ok(Some(current))
    }

    /// Resolve the file handle for `path`. With `create`, parent directories
    /// and the file are created; without it, `Ok(None)` means it does not
    /// exist.
    async fn file_handle(
        &self,
        path: &str,
        create: bool,
    ) -> AppResult<Option<FileSystemFileHandle>> {
        let segments = validate_path(path)?;
        let (parent, name) = split_parent(&segments);
        let root = self.root().await?;
        let Some(dir) = self.dir_at(&root, parent, create).await? else {
            return Ok(None);
        };
        let promise = if create {
            let options = FileSystemGetFileOptions::new();
            options.set_create(true);
            dir.get_file_handle_with_options(name, &options)
        } else {
            dir.get_file_handle(name)
        };
        match JsFuture::from(promise).await {
            Ok(handle) => handle
                .dyn_into::<FileSystemFileHandle>()
                .map(Some)
                .map_err(|_| format!("unexpected handle type for file '{path}'")),
            Err(err) if is_not_found(&err) => Ok(None),
            Err(err) if is_type_mismatch(&err) => {
                Err(format!("'{path}' is a directory, not a file"))
            }
            Err(err) => Err(format!("file '{path}': {}", js_message(&err))),
        }
    }

    async fn open_for_write(&self, path: &str) -> AppResult<FileSystemWritableFileStream> {
        let handle = self
            .file_handle(path, true)
            .await
            .map_err(|err| format!("OPFS write error: {err}"))?
            .ok_or_else(|| format!("OPFS write error: unable to create file: {path}"))?;
        await_js(handle.create_writable(), "OPFS write error: open stream")
            .await?
            .dyn_into::<FileSystemWritableFileStream>()
            .map_err(|_| "OPFS write error: unexpected writable stream type".to_string())
    }

    async fn read_file_inner(&self, path: &str) -> AppResult<Option<String>> {
        let Some(file) = self.read_handle_to_file(path).await? else {
            return Ok(None);
        };
        let text = await_js(file.text(), "OPFS read error: read text").await?;
        text.as_string()
            .map(Some)
            .ok_or_else(|| format!("OPFS read error: non-text result for: {path}"))
    }

    async fn read_bytes_inner(&self, path: &str) -> AppResult<Option<Vec<u8>>> {
        let Some(file) = self.read_handle_to_file(path).await? else {
            return Ok(None);
        };
        let buffer = await_js(file.array_buffer(), "OPFS read error: read bytes").await?;
        Ok(Some(Uint8Array::new(&buffer).to_vec()))
    }

    async fn read_handle_to_file(&self, path: &str) -> AppResult<Option<File>> {
        let Some(handle) = self
            .file_handle(path, false)
            .await
            .map_err(|err| format!("OPFS read error: {err}"))?
        else {
            return Ok(None);
        };
        await_js(handle.get_file(), "OPFS read error: open file")
            .await?
            .dyn_into::<File>()
            .map(Some)
            .map_err(|_| "OPFS read error: unexpected file object type".to_string())
    }

    async fn write_file_inner(&self, path: &str, content: &str) -> AppResult<()> {
        let stream = self.open_for_write(path).await?;
        let write = stream
            .write_with_str(content)
            .map_err(|err| format!("OPFS write error: {}", js_message(&err)))?;
        await_js(write, "OPFS write error: write text").await?;
        await_js(stream.close(), "OPFS write error: close stream").await?;
        Ok(())
    }

    async fn write_bytes_inner(&self, path: &str, content: &[u8]) -> AppResult<()> {
        let stream = self.open_for_write(path).await?;
        let write = stream
            .write_with_u8_array(content)
            .map_err(|err| format!("OPFS write error: {}", js_message(&err)))?;
        await_js(write, "OPFS write error: write bytes").await?;
        await_js(stream.close(), "OPFS write error: close stream").await?;
        Ok(())
    }

    async fn copy_file_inner(&self, from: &str, to: &str) -> AppResult<()> {
        let bytes = self
            .read_bytes_inner(from)
            .await?
            .ok_or_else(|| format!("OPFS rename error: source disappeared: {from}"))?;
        self.write_bytes_inner(to, &bytes).await
    }

    async fn mkdir_inner(&self, path: &str) -> AppResult<()> {
        let segments = validate_path(path).map_err(|err| format!("OPFS mkdir error: {err}"))?;
        let root = self.root().await?;
        self.dir_at(&root, &segments, true)
            .await
            .map_err(|err| format!("OPFS mkdir error: {err}"))?;
        Ok(())
    }

    /// What lives at `path`: `Some(true)` directory, `Some(false)` file,
    /// `None` nothing.
    async fn entry_kind(&self, path: &str) -> AppResult<Option<bool>> {
        let segments = validate_path(path)?;
        let (parent, name) = split_parent(&segments);
        let root = self.root().await?;
        let Some(dir) = self.dir_at(&root, parent, false).await? else {
            return Ok(None);
        };
        match JsFuture::from(dir.get_file_handle(name)).await {
            Ok(_) => Ok(Some(false)),
            Err(err) if is_type_mismatch(&err) => Ok(Some(true)),
            Err(err) if is_not_found(&err) => Ok(None),
            Err(err) => Err(format!("OPFS error: probe '{path}': {}", js_message(&err))),
        }
    }

    async fn list_all_inner(&self) -> AppResult<Vec<FsEntry>> {
        let root = self.root().await?;
        let mut entries = Vec::new();
        let mut pending: Vec<(FileSystemDirectoryHandle, String)> = vec![(root, String::new())];
        while let Some((dir, prefix)) = pending.pop() {
            let iterator = dir.entries();
            while let Some((name, handle)) = next_dir_entry(&iterator).await? {
                let path = if prefix.is_empty() {
                    name
                } else {
                    format!("{prefix}/{name}")
                };
                if handle.kind() == FileSystemHandleKind::Directory {
                    entries.push(FsEntry {
                        path: path.clone(),
                        is_dir: true,
                    });
                    pending.push((handle.unchecked_into(), path));
                } else {
                    entries.push(FsEntry {
                        path,
                        is_dir: false,
                    });
                }
            }
        }
        entries.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(entries)
    }
}

/// Drive one step of a `FileSystemDirectoryHandle.entries()` async iterator.
async fn next_dir_entry(iterator: &AsyncIterator) -> AppResult<Option<(String, FileSystemHandle)>> {
    let promise = iterator
        .next()
        .map_err(|err| format!("OPFS list error: iterator: {}", js_message(&err)))?;
    let step = await_js(promise, "OPFS list error: next entry").await?;
    let step: IteratorNext = step.unchecked_into();
    if step.done() {
        return Ok(None);
    }
    let pair: Array = step
        .value()
        .dyn_into()
        .map_err(|_| "OPFS list error: unexpected entry shape".to_string())?;
    let name = pair
        .get(0)
        .as_string()
        .ok_or("OPFS list error: entry name is not a string")?;
    let handle: FileSystemHandle = pair
        .get(1)
        .dyn_into()
        .map_err(|_| "OPFS list error: unexpected entry handle type".to_string())?;
    Ok(Some((name, handle)))
}

// ---- path helpers (pure; host-testable) -----------------------------------

/// Validate a workspace path and split it into segments. Paths are relative
/// and `/`-separated; leading `/`, empty, `.` and `..` segments are rejected.
fn validate_path(path: &str) -> AppResult<Vec<String>> {
    if path.is_empty() {
        return Err("path is empty".to_string());
    }
    if path.starts_with('/') {
        return Err(format!(
            "path must be relative, without a leading '/': {path}"
        ));
    }
    let mut segments = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" => return Err(format!("path has an empty segment: {path}")),
            "." | ".." => {
                return Err(format!("path may not contain '.' or '..' segments: {path}"));
            }
            _ => segments.push(segment.to_string()),
        }
    }
    Ok(segments)
}

/// Split validated segments into (parent directories, final name).
/// `validate_path` guarantees at least one segment.
fn split_parent(segments: &[String]) -> (&[String], &str) {
    match segments.split_last() {
        Some((name, parent)) => (parent, name.as_str()),
        None => (&[], ""),
    }
}

/// `candidate` equals `base` or lives somewhere below it.
fn path_is_or_under(candidate: &str, base: &str) -> bool {
    candidate == base
        || (candidate.starts_with(base) && candidate.as_bytes().get(base.len()) == Some(&b'/'))
}

/// Rewrite `path` (which is under `from`) to live under `to` instead.
fn swap_prefix(path: &str, from: &str, to: &str) -> String {
    format!("{to}{}", &path[from.len()..])
}

/// `navigator.storage` for the current global scope. Tool handlers can run on
/// the main thread (Window) or inside the agent Web Worker
/// (WorkerGlobalScope); OPFS is available from both.
fn storage_manager() -> AppResult<web_sys::StorageManager> {
    let global = js_sys::global();
    if let Some(window) = global.dyn_ref::<web_sys::Window>() {
        return Ok(window.navigator().storage());
    }
    if let Some(scope) = global.dyn_ref::<web_sys::WorkerGlobalScope>() {
        return Ok(scope.navigator().storage());
    }
    Err("OPFS error: no window or worker scope available".to_string())
}

// ---- JS error helpers ------------------------------------------------------

async fn await_js(promise: js_sys::Promise, context: &str) -> AppResult<JsValue> {
    JsFuture::from(promise)
        .await
        .map_err(|err| format!("{context}: {}", js_message(&err)))
}

fn js_error_name(err: &JsValue) -> String {
    Reflect::get(err, &JsValue::from_str("name"))
        .ok()
        .and_then(|name| name.as_string())
        .unwrap_or_default()
}

fn is_not_found(err: &JsValue) -> bool {
    js_error_name(err) == "NotFoundError"
}

fn is_type_mismatch(err: &JsValue) -> bool {
    js_error_name(err) == "TypeMismatchError"
}

fn js_message(err: &JsValue) -> String {
    if let Some(error) = err.dyn_ref::<js_sys::Error>() {
        return String::from(error.message());
    }
    err.as_string().unwrap_or_else(|| format!("{err:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_and_splits_relative_paths() {
        assert_eq!(
            validate_path("src/lib/add.js").map_err(|_| ()),
            Ok(vec![
                "src".to_string(),
                "lib".to_string(),
                "add.js".to_string()
            ])
        );
        assert_eq!(
            validate_path("a").map_err(|_| ()),
            Ok(vec!["a".to_string()])
        );
    }

    #[test]
    fn rejects_invalid_paths_with_clear_errors() {
        assert!(validate_path("").unwrap_err().contains("empty"));
        assert!(
            validate_path("/abs/path")
                .unwrap_err()
                .contains("leading '/'")
        );
        assert!(validate_path("a//b").unwrap_err().contains("empty segment"));
        assert!(validate_path("a/").unwrap_err().contains("empty segment"));
        assert!(validate_path("a/../b").unwrap_err().contains(".."));
        assert!(validate_path("./a").unwrap_err().contains("'.'"));
    }

    #[test]
    fn split_parent_separates_directories_from_name() {
        let segments = vec!["src".to_string(), "lib".to_string(), "add.js".to_string()];
        let (parent, name) = split_parent(&segments);
        assert_eq!(parent, &["src".to_string(), "lib".to_string()][..]);
        assert_eq!(name, "add.js");

        let single = vec!["README.md".to_string()];
        let (parent, name) = split_parent(&single);
        assert!(parent.is_empty());
        assert_eq!(name, "README.md");
    }

    #[test]
    fn path_is_or_under_requires_a_segment_boundary() {
        assert!(path_is_or_under("src", "src"));
        assert!(path_is_or_under("src/a.js", "src"));
        assert!(!path_is_or_under("src-extra/a.js", "src"));
        assert!(!path_is_or_under("sr", "src"));
    }

    #[test]
    fn swap_prefix_rewrites_renamed_directory_children() {
        assert_eq!(
            swap_prefix("old/a/b.js", "old", "new/dir"),
            "new/dir/a/b.js"
        );
        assert_eq!(swap_prefix("old", "old", "new"), "new");
    }
}
