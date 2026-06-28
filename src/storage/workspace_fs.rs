//! Backend-agnostic workspace filesystem.
//!
//! WHY THIS EXISTS. The watcher-supervised runtime rule is: *file bytes never
//! cross the hub*. A tool that touches files must not pull the whole workspace
//! into an [`AppSnapshot`](crate::state::AppSnapshot) and ship it through the
//! watcher; it should hold a *handle* to the live store and read/write directly.
//! [`WorkspaceFs`] is that handle. The agent loop owns one boxed `dyn WorkspaceFs`
//! and passes it to file-touching tools, which never learn which backend they got:
//!
//!   * [`OpfsWorkspaceFs`] — the in-browser data plane, backed by the existing
//!     [`OpfsVfs`](crate::storage::opfs_vfs) (OPFS under `navigator.storage`).
//!   * [`BridgeWorkspaceFs`] — for process-backed tools that run against the local
//!     ASKK dev bridge; file IO goes over HTTP to the bridge's `fs_*` routes, the
//!     same relay the Workspace terminal and process MCP servers already use.
//!
//! WHY `?Send`. The whole app is single-threaded wasm (`Rc`, not `Arc`); the
//! sibling [`StorageAdapter`](crate::storage::StorageAdapter) and the engine traits
//! are all `#[async_trait(?Send)]`, and the OPFS/bridge futures hold non-`Send`
//! JS values. So this trait is `?Send` too — anything else would not compile in
//! the worker.
//!
//! WHY A SINGLE `validate_path`. Both backends, and the host tests, must agree on
//! exactly what a "workspace-relative path" is (no leading `/`, no `..`). Rather
//! than re-derive the rule, this module reuses the one validator that already
//! lives in [`opfs_vfs`](crate::storage::opfs_vfs::validate_path). One rule, one
//! place — a divergence there is a sandbox-escape bug.
//!
//! WHY SHA-256 / COMPARE-AND-SWAP. Multiple workers may target the same file. A
//! write can carry an `expected_sha256`: the backend re-hashes the *current* bytes
//! first and refuses the write if they have drifted (lost-update protection). The
//! same hash is the [`FileMeta::sha256`](crate::state::FileMeta) content-address
//! that rides on the snapshot as an advisory hint. The CAS *decision* is pure and
//! host-tested ([`cas_conflict`]); only the IO that fetches current bytes is
//! backend-specific.
//!
//! HOST vs WASM SPLIT. The pure logic — path validation, hex SHA-256, the CAS
//! check, and the receipt/meta shaping — is plain Rust and runs under
//! `cargo test`. The two `impl WorkspaceFs` blocks call OPFS / `fetch`, which need
//! web APIs, so they are `#[cfg(target_arch = "wasm32")]` and are exercised by the
//! browser test harness, not the host.

// L3 foundation unit: this is the workspace-FS *contract* plus its two backends.
// The eventual in-binary consumers are the file-touching tools the watcher hands a
// `dyn WorkspaceFs` to — those land in a later unit, so nothing calls this surface
// yet on either target (the host build also compiles out the wasm-only impls). The
// host tests exercise every pure helper, but tests are a separate cfg. Mirror the
// pre-landed-unit pattern already used in this module (`OpfsVfs::read_bytes` carries
// a per-item `#[allow(dead_code)]` for the same "consumer not landed yet" reason)
// with one module-level allow rather than scattering it across ~20 items.
#![allow(dead_code)]

use crate::state::{AppResult, FileMeta};
use sha2::{Digest, Sha256};

// `validate_path` is shared with the OPFS layer so there is exactly one definition
// of a legal workspace path across the whole storage module (see module docs).
pub(crate) use crate::storage::opfs_vfs::validate_path;

// ---------------------------------------------------------------------------
// Supporting types (all defined here, per the unit contract).
// ---------------------------------------------------------------------------

/// Which concrete backend served a call. Carried on receipts/entries so a caller
/// (or a log line) can tell an OPFS write from a bridge write without downcasting.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BackendId {
    /// In-browser OPFS data plane ([`OpfsWorkspaceFs`]).
    Opfs,
    /// Local ASKK dev bridge over HTTP ([`BridgeWorkspaceFs`]).
    Bridge,
}

impl BackendId {
    /// Stable lowercase tag for logs and the [`WriteReceipt`] envelope.
    pub fn as_str(self) -> &'static str {
        match self {
            BackendId::Opfs => "opfs",
            BackendId::Bridge => "bridge",
        }
    }
}

/// Options for [`WorkspaceFs::read`]. Kept as a struct (not bare params) so future
/// knobs — byte ranges, encoding hints — can be added without churning every call
/// site. `Default` reads the whole file as-is.
#[derive(Clone, Debug, Default)]
pub struct ReadOpts {
    /// Reserved for a future byte-range read; ignored today. Present so the trait
    /// signature is stable before the feature lands.
    pub _range: Option<(u64, u64)>,
}

/// Options for [`WorkspaceFs::write`]. The load-bearing field is `expected_sha256`:
/// when set, the write is a *compare-and-swap* — it only succeeds if the file's
/// current content hashes to this value (or, with [`WriteOpts::expect_absent`], if
/// the file does not yet exist).
#[derive(Clone, Debug, Default)]
pub struct WriteOpts {
    /// Compare-and-swap guard: lowercase-hex SHA-256 the file must currently have
    /// for the write to proceed. `None` = unconditional overwrite.
    pub expected_sha256: Option<String>,
    /// When `true`, the write must *create* the file: it fails if anything already
    /// exists at `path`. Pairs with `expected_sha256: None` for "create, don't
    /// clobber" semantics.
    pub expect_absent: bool,
}

/// The bytes returned by a successful [`WorkspaceFs::read`], plus the content
/// address computed over them. Returning the hash here saves the caller a second
/// pass when it wants to turn around and CAS-write.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DataReturn {
    /// Workspace-relative path that was read.
    pub path: String,
    /// Raw file bytes.
    pub bytes: Vec<u8>,
    /// Lowercase-hex SHA-256 of `bytes` (the CAS token / content address).
    pub sha256: String,
}

/// Proof that a write/edit landed: the durable [`FileMeta`] hint plus which backend
/// produced it. The runtime forwards `meta` as a `StatePatch::UpsertFileMeta` delta.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WriteReceipt {
    /// The advisory file hint to publish on the snapshot.
    pub meta: FileMeta,
    /// Which backend performed the write.
    pub backend: BackendId,
}

/// One entry from [`WorkspaceFs::list`]. Distinct from
/// [`opfs_vfs::FsEntry`](crate::storage::opfs_vfs::FsEntry) (which is bare
/// `{path, is_dir}`): this one is the backend-agnostic listing shape and carries a
/// size for files so a tree view need not stat each entry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FsEntry {
    /// Workspace-relative `/`-separated path.
    pub path: String,
    /// `true` for directories.
    pub is_dir: bool,
    /// Byte size for files; `None` for directories or when the backend did not
    /// report one (the bridge tree, for instance, omits sizes).
    pub size: Option<u64>,
}

/// Metadata for a single path from [`WorkspaceFs::stat`]. For files this mirrors
/// [`FileMeta`] (path/size/sha256/modified_at) and adds the `is_dir` flag; for a
/// directory the size is `0`, `sha256` is empty, and `is_dir` is `true`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FsStat {
    /// Workspace-relative path that was stat-ed.
    pub path: String,
    /// `true` for directories.
    pub is_dir: bool,
    /// Byte size for files; `0` for directories.
    pub size: u64,
    /// Lowercase-hex SHA-256 for files; empty for directories.
    pub sha256: String,
    /// Emitter-supplied timestamp (`unix-ms:<n>` from the OPFS `lastModified`, or
    /// ISO-8601), matching [`FileMeta::modified_at`]'s contract. Empty when the
    /// backend does not expose one.
    pub modified_at: String,
}

/// An in-place edit applied by [`WorkspaceFs::edit`]. The backend reads current
/// bytes, applies the op as UTF-8 text, and writes the result back (honoring any
/// CAS guard in the surrounding call). Kept tiny on purpose; richer ops (patch
/// hunks) can be added as variants without breaking callers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EditOp {
    /// Replace the *first* occurrence of `find` with `replace`. Errors if `find`
    /// is not present (a no-op edit is almost always a caller bug).
    ReplaceFirst { find: String, replace: String },
    /// Replace *every* occurrence of `find` with `replace`. Errors if `find` is
    /// absent.
    ReplaceAll { find: String, replace: String },
    /// Append `text` to the end of the file (creating it if absent).
    Append { text: String },
}

// ---------------------------------------------------------------------------
// The trait.
// ---------------------------------------------------------------------------

/// A handle to the live workspace file store, backend-agnostic.
///
/// `?Send` because the whole runtime is single-threaded wasm and the futures hold
/// non-`Send` JS values (see module docs). Every method validates its path through
/// the shared [`validate_path`] before touching the backend.
#[async_trait::async_trait(?Send)]
pub trait WorkspaceFs {
    /// Read a file. `Ok(None)` when the path does not exist; `Ok(Some(_))`
    /// otherwise, with the bytes and their content hash.
    async fn read(&self, path: &str, opts: ReadOpts) -> AppResult<Option<DataReturn>>;

    /// Write (create or overwrite) a file. When `opts.expected_sha256` is set the
    /// write is a compare-and-swap and fails with a clear error on drift; when
    /// `opts.expect_absent` is set it fails if the file already exists.
    async fn write(&self, path: &str, bytes: &[u8], opts: WriteOpts) -> AppResult<WriteReceipt>;

    /// Apply an in-place [`EditOp`] and write the result back. `opts` carries the
    /// same compare-and-swap guard as [`write`](WorkspaceFs::write): when
    /// `opts.expected_sha256` is set, the edit only lands if the file's *current*
    /// content still hashes to that value — lost-update protection for the
    /// read-modify-write, since two concurrent edits would otherwise both read the
    /// same base and one would silently clobber the other. Callers that don't need
    /// a guard pass [`WriteOpts::default()`].
    async fn edit(&self, path: &str, op: EditOp, opts: WriteOpts) -> AppResult<WriteReceipt>;

    /// List entries at or under `under` (workspace-relative; empty string = root).
    async fn list(&self, under: &str) -> AppResult<Vec<FsEntry>>;

    /// Stat a single path. `Ok(None)` when it does not exist.
    async fn stat(&self, path: &str) -> AppResult<Option<FsStat>>;

    /// Which backend this handle is.
    fn backend(&self) -> BackendId;
}

// ---------------------------------------------------------------------------
// Pure, host-testable helpers (no web APIs).
// ---------------------------------------------------------------------------

/// Lowercase-hex SHA-256 of `bytes`. The single content-addressing primitive used
/// for every receipt, CAS guard, and [`FileMeta`] hint.
pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        // `{:02x}` keeps the canonical fixed-width lowercase hex that `FileMeta`
        // and the bridge both expect; a bare `{:x}` would drop leading zeros.
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// The compare-and-swap *decision*, isolated from any IO so it is host-testable.
///
/// Given the file's `current` content hash (`None` when the file does not exist)
/// and the caller's [`WriteOpts`] guard, return `Err(message)` if the write must be
/// refused, or `Ok(())` if it may proceed. The backends call this after fetching
/// current bytes and before writing — see the `impl` blocks.
///
/// Rules:
///   * `expect_absent` and the file exists  -> conflict.
///   * `expected_sha256` set and the file is absent -> conflict (nothing to match).
///   * `expected_sha256` set and the current hash differs -> conflict.
///   * otherwise -> proceed.
pub(crate) fn cas_conflict(opts: &WriteOpts, current: Option<&str>) -> AppResult<()> {
    if opts.expect_absent {
        if current.is_some() {
            return Err(
                "compare-and-swap failed: expected the file to be absent, but it exists"
                    .to_string(),
            );
        }
        return Ok(());
    }
    let Some(expected) = opts.expected_sha256.as_deref() else {
        return Ok(()); // unconditional overwrite
    };
    match current {
        None => Err(format!(
            "compare-and-swap failed: expected sha256 {expected} but the file does not exist"
        )),
        Some(actual) if actual != expected => Err(format!(
            "compare-and-swap failed: expected sha256 {expected} but the file is now {actual}"
        )),
        Some(_) => Ok(()),
    }
}

/// Build a [`FileMeta`] hint from a path, the freshly written bytes, and an
/// emitter-supplied `modified_at` stamp. Pure so the receipt shape is host-tested.
pub(crate) fn file_meta(path: &str, bytes: &[u8], modified_at: String) -> FileMeta {
    FileMeta {
        path: path.to_string(),
        size: bytes.len() as u64,
        sha256: sha256_hex(bytes),
        modified_at,
    }
}

/// Apply an [`EditOp`] to `current` text, returning the new content. Pure string
/// logic, host-tested; the backends own the read-modify-write IO around it.
pub(crate) fn apply_edit(op: &EditOp, current: &str) -> AppResult<String> {
    match op {
        EditOp::ReplaceFirst { find, replace } => {
            if !current.contains(find.as_str()) {
                return Err(format!("edit failed: text to replace not found: {find:?}"));
            }
            Ok(current.replacen(find, replace, 1))
        }
        EditOp::ReplaceAll { find, replace } => {
            if !current.contains(find.as_str()) {
                return Err(format!("edit failed: text to replace not found: {find:?}"));
            }
            Ok(current.replace(find, replace))
        }
        EditOp::Append { text } => Ok(format!("{current}{text}")),
    }
}

/// Reject a path that is not workspace-relative, returning the same path on success
/// for ergonomic chaining. Thin wrapper over the shared [`validate_path`] so each
/// trait method can guard in one line with a uniform error prefix.
pub(crate) fn ensure_relative(path: &str) -> AppResult<()> {
    validate_path(path).map(|_| ())
}

/// Does this bridge error text mean "no such file"? Centralized + host-tested so
/// the fragile coupling to the bridge's wording lives in one place. Matches the
/// bridge's canonical `file not found` phrase case-insensitively.
pub(crate) fn is_bridge_not_found(err: &str) -> bool {
    err.to_ascii_lowercase().contains("file not found")
}

// ---------------------------------------------------------------------------
// OPFS backend (wasm only — needs the OPFS / web APIs).
// ---------------------------------------------------------------------------

/// A `unix-ms:<now>` stamp for [`FileMeta::modified_at`]. OPFS does not surface a
/// per-file `lastModified` through [`OpfsVfs`], so a write stamps wall-clock time
/// at commit. This matches the `unix-ms:` form `files.rs` documents and keeps the
/// stamp emitter-supplied (no clock in the pure layer). `js_sys::Date::now()`
/// returns ms since the epoch as `f64`; truncating to `i64` is exact for any real
/// wall-clock instant.
#[cfg(target_arch = "wasm32")]
fn now_stamp() -> String {
    format!("unix-ms:{}", js_sys::Date::now() as i64)
}

/// [`WorkspaceFs`] over the in-browser OPFS store. Thin adapter over the existing
/// [`OpfsVfs`](crate::storage::opfs_vfs::OpfsVfs): it adds the content-addressing
/// (sha256), CAS, and write-to-temp-then-replace durability the bare VFS does not
/// provide.
#[cfg(target_arch = "wasm32")]
#[derive(Clone, Debug, Default)]
pub struct OpfsWorkspaceFs {
    vfs: crate::storage::opfs_vfs::OpfsVfs,
}

#[cfg(target_arch = "wasm32")]
impl OpfsWorkspaceFs {
    pub fn new() -> Self {
        Self {
            vfs: crate::storage::opfs_vfs::OpfsVfs::new(),
        }
    }

    /// Hash of the file's current bytes, or `None` if it does not exist. Used to
    /// evaluate the CAS guard before a write.
    async fn current_hash(&self, path: &str) -> AppResult<Option<String>> {
        Ok(self
            .vfs
            .read_bytes(path)
            .await?
            .map(|bytes| sha256_hex(&bytes)))
    }

    /// Durable write: stage the new bytes in a sibling temp file, snapshot the live
    /// file as a sibling backup, then swap the temp into place — and on any failure
    /// during the swap, restore the live file from the backup so a half-done write
    /// can never destroy the previous content.
    ///
    /// WHY THE BACKUP. OPFS `rename` is copy+delete and refuses to clobber an
    /// existing destination, so the swap must delete the live file before renaming
    /// the temp over it. A naive "delete live, then rename" loses the file outright
    /// if the rename's copy step throws (quota, detached tab) — the live file is
    /// already gone and the caller's CAS token now points at nothing. Snapshotting
    /// the live file first turns that into a recoverable state: on rename failure we
    /// move the backup back into place and surface the error, leaving the previous
    /// content intact. The `.askk-tmp` / `.askk-bak` siblings are valid relative
    /// paths (so `validate_path`/`rename` accept them) and are reserved suffixes; a
    /// stale one from a crashed write is cleared up-front.
    async fn durable_write(&self, path: &str, bytes: &[u8]) -> AppResult<()> {
        let temp = format!("{path}.askk-tmp");
        let backup = format!("{path}.askk-bak");
        // Clear stale siblings from a prior crashed write so every `rename` (which
        // refuses an existing destination) starts from a clean slate.
        let _ = self.vfs.delete(&temp).await;
        let _ = self.vfs.delete(&backup).await;
        self.vfs.write_bytes(&temp, bytes).await?;

        // Snapshot the live file (if any) before we disturb it, so a failed swap is
        // recoverable. `rename` here is move-not-copy of the live file out of the way.
        let had_live = self.vfs.read_bytes(path).await?.is_some();
        if had_live {
            self.vfs.rename(path, &backup).await?;
        }

        // Swap the new content into place. On failure, put the original back.
        match self.vfs.rename(&temp, path).await {
            Ok(()) => {
                let _ = self.vfs.delete(&backup).await; // commit: drop the snapshot
                Ok(())
            }
            Err(err) => {
                let _ = self.vfs.delete(&temp).await; // discard the failed staging
                if had_live {
                    // Best-effort restore of the previous content. The path was just
                    // vacated by the move above, so this rename should not clobber.
                    let _ = self.vfs.rename(&backup, path).await;
                }
                Err(err)
            }
        }
    }
}

#[cfg(target_arch = "wasm32")]
#[async_trait::async_trait(?Send)]
impl WorkspaceFs for OpfsWorkspaceFs {
    async fn read(&self, path: &str, _opts: ReadOpts) -> AppResult<Option<DataReturn>> {
        ensure_relative(path)?;
        let Some(bytes) = self.vfs.read_bytes(path).await? else {
            return Ok(None);
        };
        let sha256 = sha256_hex(&bytes);
        Ok(Some(DataReturn {
            path: path.to_string(),
            bytes,
            sha256,
        }))
    }

    async fn write(&self, path: &str, bytes: &[u8], opts: WriteOpts) -> AppResult<WriteReceipt> {
        ensure_relative(path)?;
        let current = self.current_hash(path).await?;
        cas_conflict(&opts, current.as_deref())?;
        self.durable_write(path, bytes).await?;
        Ok(WriteReceipt {
            meta: file_meta(path, bytes, now_stamp()),
            backend: BackendId::Opfs,
        })
    }

    async fn edit(&self, path: &str, op: EditOp, opts: WriteOpts) -> AppResult<WriteReceipt> {
        ensure_relative(path)?;
        // Read raw bytes (not text) so the CAS hash is computed the same way `write`
        // does — over raw bytes — keeping a token from a prior read/stat valid here.
        let current_bytes = self
            .vfs
            .read_bytes(path)
            .await?
            .ok_or_else(|| format!("edit failed: no such file: {path}"))?;
        // Guard the read-modify-write against a concurrent change to `path`.
        cas_conflict(&opts, Some(&sha256_hex(&current_bytes)))?;
        let current = String::from_utf8(current_bytes)
            .map_err(|_| format!("edit failed: file is not valid UTF-8: {path}"))?;
        let updated = apply_edit(&op, &current)?;
        let bytes = updated.into_bytes();
        self.durable_write(path, &bytes).await?;
        Ok(WriteReceipt {
            meta: file_meta(path, &bytes, now_stamp()),
            backend: BackendId::Opfs,
        })
    }

    async fn list(&self, under: &str) -> AppResult<Vec<FsEntry>> {
        // Empty `under` means the whole workspace; a non-empty prefix must be a
        // legal relative path.
        if !under.is_empty() {
            ensure_relative(under)?;
        }
        let mut out = Vec::new();
        for entry in self.vfs.list_all().await? {
            if !under.is_empty()
                && entry.path != under
                && !entry.path.starts_with(&format!("{under}/"))
            {
                continue;
            }
            // Sizes are cheap to omit here; `stat` is the path for an exact size.
            out.push(FsEntry {
                path: entry.path,
                is_dir: entry.is_dir,
                size: None,
            });
        }
        Ok(out)
    }

    async fn stat(&self, path: &str) -> AppResult<Option<FsStat>> {
        ensure_relative(path)?;
        // A directory listing is the portable way to learn the kind without a
        // bespoke OPFS probe surface; for a file we then read bytes for size+hash.
        let is_dir = self
            .vfs
            .list_all()
            .await?
            .iter()
            .any(|entry| entry.path == path && entry.is_dir);
        if is_dir {
            return Ok(Some(FsStat {
                path: path.to_string(),
                is_dir: true,
                size: 0,
                sha256: String::new(),
                modified_at: String::new(),
            }));
        }
        let Some(bytes) = self.vfs.read_bytes(path).await? else {
            return Ok(None);
        };
        Ok(Some(FsStat {
            path: path.to_string(),
            is_dir: false,
            size: bytes.len() as u64,
            sha256: sha256_hex(&bytes),
            // OPFS exposes no real per-file mtime through `OpfsVfs`; leave empty
            // (advisory — a caller that needs a stamp re-stats the live entry).
            modified_at: String::new(),
        }))
    }

    fn backend(&self) -> BackendId {
        BackendId::Opfs
    }
}

// ---------------------------------------------------------------------------
// Bridge backend (wasm only — needs `fetch`).
// ---------------------------------------------------------------------------

/// [`WorkspaceFs`] over the local ASKK dev bridge. File IO is HTTP to the bridge's
/// `fs_read` / `fs_write` / `fs_list` routes (the same relay the Workspace terminal
/// and process MCP servers use), so a process-backed tool sees the *same* files the
/// bridge child does. The bridge has no stat/sha route, so the content address is
/// computed here over the bytes the bridge returns.
#[cfg(target_arch = "wasm32")]
#[derive(Clone, Debug)]
pub struct BridgeWorkspaceFs {
    /// Captured at construction so the handle is self-contained (the engine builds
    /// it from the run snapshot's tool config, mirroring `BridgeMcpTransport`).
    config: crate::state::WebSearchToolConfig,
}

#[cfg(target_arch = "wasm32")]
impl BridgeWorkspaceFs {
    pub fn new(config: crate::state::WebSearchToolConfig) -> Self {
        Self { config }
    }

    /// Read a file's text via the bridge, or `None` when it does not exist.
    ///
    /// The bridge reports a missing file as a `success: false` envelope whose error
    /// text is `fs_read: file not found: <path>` (see `fsRead` in the bridge
    /// script); we map that to `None` rather than `Err` so the backend matches OPFS
    /// read semantics. The match is the bridge's own canonical phrase, compared
    /// case-insensitively to tolerate future capitalization tweaks. This is a known
    /// coupling to the bridge's wording — the right long-term fix is a machine
    /// `code` field on the envelope, but the bridge does not expose one today.
    async fn read_text(&self, path: &str) -> AppResult<Option<String>> {
        match crate::tools::bridge::bridge_fs_read(&self.config, path).await {
            Ok(text) => Ok(Some(text)),
            Err(err) if is_bridge_not_found(&err) => Ok(None),
            Err(err) => Err(err),
        }
    }

    /// Hash the file's current bytes via the bridge, or `None` if absent. Drives the
    /// CAS guard before a write.
    ///
    /// NOTE: the hash is over the UTF-8 *text* bytes the bridge returns. The bridge
    /// data plane is a different root from OPFS, so this token is NOT interchangeable
    /// with an [`OpfsWorkspaceFs`] hash of the "same" logical path — each backend's
    /// CAS token is only meaningful against that same backend.
    async fn current_hash(&self, path: &str) -> AppResult<Option<String>> {
        Ok(self
            .read_text(path)
            .await?
            .map(|text| sha256_hex(text.as_bytes())))
    }
}

#[cfg(target_arch = "wasm32")]
#[async_trait::async_trait(?Send)]
impl WorkspaceFs for BridgeWorkspaceFs {
    async fn read(&self, path: &str, _opts: ReadOpts) -> AppResult<Option<DataReturn>> {
        ensure_relative(path)?;
        let Some(text) = self.read_text(path).await? else {
            return Ok(None);
        };
        let bytes = text.into_bytes();
        let sha256 = sha256_hex(&bytes);
        Ok(Some(DataReturn {
            path: path.to_string(),
            bytes,
            sha256,
        }))
    }

    async fn write(&self, path: &str, bytes: &[u8], opts: WriteOpts) -> AppResult<WriteReceipt> {
        ensure_relative(path)?;
        let current = self.current_hash(path).await?;
        cas_conflict(&opts, current.as_deref())?;
        // The bridge `fs_write` route takes text; the runtime's bridge files are
        // UTF-8, so reject non-UTF-8 bytes with a clear error rather than silently
        // mangling them.
        let text = std::str::from_utf8(bytes)
            .map_err(|_| "bridge write failed: bytes are not valid UTF-8".to_string())?;
        crate::tools::bridge::bridge_fs_write(&self.config, path, text).await?;
        Ok(WriteReceipt {
            // The bridge does not return a timestamp; leave `modified_at` empty
            // (advisory — a reader re-stats for ground truth).
            meta: file_meta(path, bytes, String::new()),
            backend: BackendId::Bridge,
        })
    }

    async fn edit(&self, path: &str, op: EditOp, opts: WriteOpts) -> AppResult<WriteReceipt> {
        ensure_relative(path)?;
        let current = self
            .read_text(path)
            .await?
            .ok_or_else(|| format!("edit failed: no such file: {path}"))?;
        // Guard the read-modify-write against a concurrent change. The hash is over
        // the text bytes, matching this backend's `current_hash`.
        cas_conflict(&opts, Some(&sha256_hex(current.as_bytes())))?;
        let updated = apply_edit(&op, &current)?;
        crate::tools::bridge::bridge_fs_write(&self.config, path, &updated).await?;
        let bytes = updated.into_bytes();
        Ok(WriteReceipt {
            meta: file_meta(path, &bytes, String::new()),
            backend: BackendId::Bridge,
        })
    }

    async fn list(&self, under: &str) -> AppResult<Vec<FsEntry>> {
        let path = if under.is_empty() {
            None
        } else {
            ensure_relative(under)?;
            Some(under)
        };
        let files = crate::tools::bridge::bridge_fs_list(&self.config, path).await?;
        let mut out = Vec::new();
        // `fs_list` returns `{ files: [{ path, dir }] }`; sizes are not reported.
        if let Some(items) = files.as_array() {
            for item in items {
                let Some(path) = item.get("path").and_then(serde_json::Value::as_str) else {
                    continue;
                };
                let is_dir = item
                    .get("dir")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false);
                out.push(FsEntry {
                    path: path.to_string(),
                    is_dir,
                    size: None,
                });
            }
        }
        Ok(out)
    }

    async fn stat(&self, path: &str) -> AppResult<Option<FsStat>> {
        ensure_relative(path)?;
        // No dedicated bridge stat route: read the file and derive size+hash. A
        // directory shows up in the parent listing with `dir: true`.
        if let Some(text) = self.read_text(path).await? {
            let bytes = text.into_bytes();
            return Ok(Some(FsStat {
                path: path.to_string(),
                is_dir: false,
                size: bytes.len() as u64,
                sha256: sha256_hex(&bytes),
                modified_at: String::new(),
            }));
        }
        // Not a file — check whether the parent listing knows it as a directory.
        let parent = path.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
        for entry in self.list(parent).await? {
            if entry.path == path && entry.is_dir {
                return Ok(Some(FsStat {
                    path: path.to_string(),
                    is_dir: true,
                    size: 0,
                    sha256: String::new(),
                    modified_at: String::new(),
                }));
            }
        }
        Ok(None)
    }

    fn backend(&self) -> BackendId {
        BackendId::Bridge
    }
}

// ---------------------------------------------------------------------------
// Host tests for the PURE logic (path validation + CAS + edit + hashing).
// The OPFS/bridge IO needs web APIs and is covered by the browser harness.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_path_accepts_relative_and_rejects_escapes() {
        // Accepts a plain workspace-relative path.
        assert!(ensure_relative("a/b.txt").is_ok());
        assert!(ensure_relative("a").is_ok());
        // Rejects an absolute path.
        let abs = ensure_relative("/abs").unwrap_err();
        assert!(abs.contains("leading '/'"), "got: {abs}");
        // Rejects `..` traversal.
        let esc = ensure_relative("../esc").unwrap_err();
        assert!(esc.contains(".."), "got: {esc}");
        // Rejects an interior `..`.
        assert!(ensure_relative("a/../b").is_err());
        // Rejects empty.
        assert!(ensure_relative("").is_err());
    }

    #[test]
    fn cas_unconditional_write_always_proceeds() {
        let opts = WriteOpts::default();
        assert!(cas_conflict(&opts, None).is_ok());
        assert!(cas_conflict(&opts, Some("deadbeef")).is_ok());
    }

    #[test]
    fn cas_detects_hash_mismatch() {
        let opts = WriteOpts {
            expected_sha256: Some("aaaa".to_string()),
            expect_absent: false,
        };
        // Matching current hash -> proceed.
        assert!(cas_conflict(&opts, Some("aaaa")).is_ok());
        // Drifted current hash -> conflict.
        let err = cas_conflict(&opts, Some("bbbb")).unwrap_err();
        assert!(err.contains("compare-and-swap failed"), "got: {err}");
        assert!(err.contains("aaaa") && err.contains("bbbb"), "got: {err}");
        // Expected a hash but the file is gone -> conflict.
        assert!(cas_conflict(&opts, None).is_err());
    }

    #[test]
    fn cas_expect_absent_rejects_existing_file() {
        let opts = WriteOpts {
            expected_sha256: None,
            expect_absent: true,
        };
        assert!(cas_conflict(&opts, None).is_ok());
        let err = cas_conflict(&opts, Some("anything")).unwrap_err();
        assert!(err.contains("expected the file to be absent"), "got: {err}");
    }

    #[test]
    fn sha256_hex_is_lowercase_fixed_width_and_known() {
        // Known vector: SHA-256("abc").
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        // 64 hex chars, all lowercase, leading-zero-safe.
        let hex = sha256_hex(b"");
        assert_eq!(hex.len(), 64);
        assert!(
            hex.chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        );
        assert_eq!(
            hex,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn file_meta_carries_size_hash_and_stamp() {
        let meta = file_meta("dir/x.txt", b"abc", "unix-ms:42".to_string());
        assert_eq!(meta.path, "dir/x.txt");
        assert_eq!(meta.size, 3);
        assert_eq!(
            meta.sha256,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(meta.modified_at, "unix-ms:42");
    }

    #[test]
    fn apply_edit_replace_first_and_all() {
        assert_eq!(
            apply_edit(
                &EditOp::ReplaceFirst {
                    find: "a".into(),
                    replace: "X".into()
                },
                "aaa"
            )
            .unwrap(),
            "Xaa"
        );
        assert_eq!(
            apply_edit(
                &EditOp::ReplaceAll {
                    find: "a".into(),
                    replace: "X".into()
                },
                "aaa"
            )
            .unwrap(),
            "XXX"
        );
        assert_eq!(
            apply_edit(&EditOp::Append { text: "!".into() }, "hi").unwrap(),
            "hi!"
        );
    }

    #[test]
    fn apply_edit_missing_target_is_an_error() {
        let err = apply_edit(
            &EditOp::ReplaceFirst {
                find: "zzz".into(),
                replace: "q".into(),
            },
            "hello",
        )
        .unwrap_err();
        assert!(err.contains("not found"), "got: {err}");
    }

    #[test]
    fn backend_id_tags_are_stable() {
        assert_eq!(BackendId::Opfs.as_str(), "opfs");
        assert_eq!(BackendId::Bridge.as_str(), "bridge");
    }

    #[test]
    fn bridge_not_found_matches_canonical_phrase_case_insensitively() {
        // The bridge's own wording (`fsRead`) and capitalization variants.
        assert!(is_bridge_not_found("fs_read: file not found: a/b.txt"));
        assert!(is_bridge_not_found("File Not Found"));
        // Unrelated bridge errors must NOT be swallowed as `None`.
        assert!(!is_bridge_not_found("fs_read failed for a/b.txt: EACCES"));
        assert!(!is_bridge_not_found("bridge request failed"));
    }
}
