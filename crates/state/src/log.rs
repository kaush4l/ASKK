//! The signal log (ADR-003): append-only JSONL over a [`BlobStore`], one
//! segment `seg-<epoch>.jsonl` per session, single writer.
//!
//! Every `open()` starts a new epoch segment and replays all prior segments.
//! Runs replayed without a terminal status are zombies from a dead epoch:
//! the fence appends synthesized terminals to the NEW segment so fold shows
//! them terminated, deterministically.
//!
//! Degrade-don't-die: a failed segment write flips the log to in-memory
//! only instead of erroring — losing persistence must never kill a live
//! run. The boot path (`crates/browser/src/boot.rs`) seeds the replayed
//! signals into the live buffer, so prior-epoch runs resume as read-only
//! exhibits (GAPS A5 closed, ADR-044). [`HealthProbe`] is the cloneable
//! read side of the degrade flag.

use std::cell::Cell;
use std::collections::BTreeMap;
use std::rc::Rc;

use askk_core::signal::{step, RunProjection, Signal, SignalKind};
use askk_core::state::{RunId, RunStatus};

use super::store::{BlobStore, StoreError};

/// Injected clock: milliseconds since epoch (or any monotonic-enough source).
pub type Clock = Box<dyn Fn() -> u64>;

/// Single-writer append-only signal log.
///
/// SINGLE WRITER: exactly one `SignalLog` may write a store at a time. The
/// log owns the current segment's contents in memory and writes the whole
/// blob per append — a concurrent second writer would clobber it. The epoch
/// fence handles the *sequential* case (a new session opening over a dead
/// one); true concurrency is out of contract.
pub struct SignalLog {
    blobs: Rc<dyn BlobStore>,
    clock: Clock,
    epoch: u64,
    seg_path: String,
    /// Current segment contents — the single writer's authoritative copy.
    buf: String,
    next_seq: u64,
    quarantined: u64,
    /// Set on the first failed segment write: persistence is lost for this
    /// epoch but signals keep flowing in memory — durability degrades, runs
    /// never die on a storage fault (observed: broken OPFS quota grants).
    /// Shared cell so [`HealthProbe`] clones read the live value.
    degraded: Rc<Cell<bool>>,
}

/// Cloneable read-only health view of a [`SignalLog`]: `epoch` and
/// `quarantined` are fixed at open; `degraded` reads the log's live shared
/// cell, so a probe taken at boot observes a later persistence failure.
#[derive(Clone)]
pub struct HealthProbe {
    epoch: u64,
    quarantined: u64,
    degraded: Rc<Cell<bool>>,
}

impl HealthProbe {
    pub fn epoch(&self) -> u64 {
        self.epoch
    }

    /// Lines skipped during replay because they would not parse.
    pub fn quarantined(&self) -> u64 {
        self.quarantined
    }

    /// Live read: true once a segment write has failed.
    pub fn degraded(&self) -> bool {
        self.degraded.get()
    }
}

fn seg_path(epoch: u64) -> String {
    format!("seg-{epoch}.jsonl")
}

fn parse_epoch(name: &str) -> Option<u64> {
    name.strip_prefix("seg-")?
        .strip_suffix(".jsonl")?
        .parse()
        .ok()
}

impl SignalLog {
    /// The underlying blob store — shared read access for live-artifact
    /// refresh (ADR-033); the log stays the only WRITER of its segments.
    pub fn blobs(&self) -> Rc<dyn BlobStore> {
        self.blobs.clone()
    }

    /// Open the log: list segments, start epoch = max+1, replay every prior
    /// segment (unparseable lines are quarantined — skipped and counted,
    /// never fatal), then fence stale runs. Returns the log and the replayed
    /// signals (including any fence terminals) ready to fold.
    pub async fn open(
        blobs: Rc<dyn BlobStore>,
        clock: Clock,
    ) -> Result<(Self, Vec<Signal>), StoreError> {
        let mut epochs: Vec<u64> = blobs
            .list("seg-")
            .await?
            .iter()
            .filter_map(|name| parse_epoch(name))
            .collect();
        epochs.sort_unstable();
        let epoch = epochs.last().copied().unwrap_or(0) + 1;

        let mut replayed = Vec::new();
        let mut quarantined = 0u64;
        for prior in &epochs {
            let Some(bytes) = blobs.read(&seg_path(*prior)).await? else {
                continue;
            };
            for line in String::from_utf8_lossy(&bytes).lines() {
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<Signal>(line) {
                    Ok(signal) => replayed.push(signal),
                    Err(_) => quarantined += 1, // quarantine-and-continue
                }
            }
        }

        let next_seq = replayed.iter().map(|s| s.seq).max().unwrap_or(0) + 1;
        let mut log = Self {
            blobs,
            clock,
            epoch,
            seg_path: seg_path(epoch),
            buf: String::new(),
            next_seq,
            quarantined,
            degraded: Rc::new(Cell::new(false)),
        };

        // Epoch fence: synthesize terminals for every replayed run that has
        // no terminal status — zombie runs die deterministically.
        let mut projections: BTreeMap<RunId, RunProjection> = BTreeMap::new();
        for signal in &replayed {
            let proj = projections.entry(signal.run_id.clone()).or_default();
            *proj = step(std::mem::take(proj), signal);
        }
        for (run_id, proj) in projections {
            if proj.status.is_terminal() {
                continue;
            }
            replayed.push(
                log.append(
                    SignalKind::Error {
                        message: "stale epoch".into(),
                    },
                    run_id.clone(),
                )
                .await?,
            );
            replayed.push(
                log.append(
                    SignalKind::StatusSet {
                        status: RunStatus::Interrupted,
                    },
                    run_id,
                )
                .await?,
            );
        }

        Ok((log, replayed))
    }

    /// Stamp and append one signal: monotonic seq (strictly increasing across
    /// all runs and reopens — per-run monotonic by construction), ts from the
    /// injected clock, size-verified write. A failed or short write flips the
    /// log to degraded (in-memory only) instead of erroring: persistence is
    /// observability, and losing it must never kill a live run.
    pub async fn append(&mut self, kind: SignalKind, run_id: RunId) -> Result<Signal, StoreError> {
        let signal = Signal {
            seq: self.next_seq,
            run_id,
            ts_ms: (self.clock)(),
            kind,
        };
        let line = serde_json::to_string(&signal)?;
        self.buf.push_str(&line);
        self.buf.push('\n');
        if !self.degraded.get() {
            self.degraded.set(!self.persist().await);
        }
        self.next_seq += 1;
        Ok(signal)
    }

    /// Write the segment and size-verify it; false = this store is broken.
    async fn persist(&self) -> bool {
        if self
            .blobs
            .write(&self.seg_path, self.buf.as_bytes())
            .await
            .is_err()
        {
            return false;
        }
        // Size-verified write: the blob must now be exactly what we hold.
        matches!(
            self.blobs.read(&self.seg_path).await,
            Ok(Some(bytes)) if bytes.len() == self.buf.len()
        )
    }

    /// Drop the archive (ADR-046, the "clear chat" seam): remove every
    /// segment blob and forget this epoch's buffered lines. The next append
    /// rewrites this epoch's segment from the emptied buffer, so cleared
    /// signals never come back — the log stays append-only *within* an
    /// archive; this drops the archive itself. `next_seq` keeps climbing for
    /// the live session; a later reopen restarts it, which collides with
    /// nothing, because nothing survived.
    ///
    /// Best-effort, like every other store path here: one segment refusing to
    /// go must not strand the others (a clear that half-ran, then reported
    /// success, would resurrect part of the history on the next reload). Every
    /// removal is attempted, the buffer is always emptied, and the first
    /// failure is reported — so the caller can say the archive is only
    /// partially gone while the live view still clears.
    pub async fn clear(&mut self) -> Result<(), StoreError> {
        let mut failure = None;
        for name in self.blobs.list("seg-").await? {
            if let Err(e) = self.blobs.remove(&name).await {
                failure = failure.or(Some(e));
            }
        }
        self.buf.clear();
        match failure {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }

    pub fn epoch(&self) -> u64 {
        self.epoch
    }

    /// True once a segment write has failed; signals still flow in memory
    /// but will not survive a reload.
    pub fn degraded(&self) -> bool {
        self.degraded.get()
    }

    /// Lines skipped during replay because they would not parse.
    pub fn quarantined(&self) -> u64 {
        self.quarantined
    }

    /// A cloneable health probe: take it at open, read it after the log has
    /// moved into the session — the degrade flag is shared, not snapshotted.
    pub fn health_probe(&self) -> HealthProbe {
        HealthProbe {
            epoch: self.epoch,
            quarantined: self.quarantined,
            degraded: Rc::clone(&self.degraded),
        }
    }
}

#[cfg(test)]
#[path = "log_tests.rs"]
mod tests;
