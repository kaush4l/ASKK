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
//! run. Note: the boot path currently DISCARDS the replayed signals
//! (`web/src/host/boot.rs`) — the fence runs, but there is no resume of
//! prior runs (GAPS A5).

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
    degraded: bool,
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
            degraded: false,
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
        if !self.degraded {
            self.degraded = !self.persist().await;
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

    pub fn epoch(&self) -> u64 {
        self.epoch
    }

    /// True once a segment write has failed; signals still flow in memory
    /// but will not survive a reload.
    pub fn degraded(&self) -> bool {
        self.degraded
    }

    /// Lines skipped during replay because they would not parse.
    pub fn quarantined(&self) -> u64 {
        self.quarantined
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::block_on;
    use crate::state::store::{LocalBoxFuture, MemBlob};
    use askk_core::signal::fold;
    use serde_json::Value;

    fn clock() -> Clock {
        Box::new(|| 42)
    }

    async fn open(blobs: &Rc<dyn BlobStore>) -> (SignalLog, Vec<Signal>) {
        SignalLog::open(Rc::clone(blobs), clock()).await.unwrap()
    }

    fn run(id: &str) -> RunId {
        RunId::new(id)
    }

    /// A terminal-run script: started then answered.
    async fn append_terminal_run(log: &mut SignalLog, id: &str) -> Vec<Signal> {
        let mut out = Vec::new();
        out.push(
            log.append(
                SignalKind::RunStarted {
                    agent_id: "coder".into(),
                    goal: "fix".into(),
                },
                run(id),
            )
            .await
            .unwrap(),
        );
        out.push(
            log.append(
                SignalKind::Result {
                    final_text: "done".into(),
                },
                run(id),
            )
            .await
            .unwrap(),
        );
        out
    }

    #[test]
    fn append_reopen_replay_is_deterministic() {
        block_on(async {
            let blobs: Rc<dyn BlobStore> = Rc::new(MemBlob::new());
            let (mut log, replayed) = open(&blobs).await;
            assert!(replayed.is_empty());
            let originals = append_terminal_run(&mut log, "r1").await;
            drop(log);

            let (log, replayed) = open(&blobs).await;
            assert_eq!(replayed, originals);
            assert_eq!(fold(&replayed), fold(&originals));
            assert_eq!(log.quarantined(), 0);
        });
    }

    #[test]
    fn seq_monotonic_across_reopen() {
        block_on(async {
            let blobs: Rc<dyn BlobStore> = Rc::new(MemBlob::new());
            let (mut log, _) = open(&blobs).await;
            let first = append_terminal_run(&mut log, "r1").await;
            drop(log);

            let (mut log, _) = open(&blobs).await;
            let second = append_terminal_run(&mut log, "r2").await;
            let seqs: Vec<u64> = first.iter().chain(&second).map(|s| s.seq).collect();
            assert!(seqs.windows(2).all(|w| w[0] < w[1]), "seqs: {seqs:?}");
        });
    }

    #[test]
    fn epoch_increments_per_reopen_and_segments_accumulate() {
        block_on(async {
            let blobs: Rc<dyn BlobStore> = Rc::new(MemBlob::new());
            let (mut log, _) = open(&blobs).await;
            assert_eq!(log.epoch(), 1);
            append_terminal_run(&mut log, "r1").await;
            drop(log);
            let (mut log, _) = open(&blobs).await;
            assert_eq!(log.epoch(), 2);
            append_terminal_run(&mut log, "r2").await;
            drop(log);
            let (log, _) = open(&blobs).await;
            assert_eq!(log.epoch(), 3);
            assert_eq!(
                blobs.list("seg-").await.unwrap(),
                vec!["seg-1.jsonl", "seg-2.jsonl"]
            ); // epoch 3 has no writes yet
            drop(log);
        });
    }

    #[test]
    fn corrupt_line_quarantined_and_counted() {
        block_on(async {
            let blobs: Rc<dyn BlobStore> = Rc::new(MemBlob::new());
            let (mut log, _) = open(&blobs).await;
            let originals = append_terminal_run(&mut log, "r1").await;
            drop(log);

            // Corrupt the segment between sessions: garbage line in the middle.
            let mut bytes = blobs.read("seg-1.jsonl").await.unwrap().unwrap();
            bytes.extend_from_slice(b"{not json at all\n");
            blobs.write("seg-1.jsonl", &bytes).await.unwrap();

            let (log, replayed) = open(&blobs).await;
            assert_eq!(log.quarantined(), 1);
            assert_eq!(replayed, originals); // valid lines survive
        });
    }

    #[test]
    fn epoch_fence_terminates_zombie_runs() {
        block_on(async {
            let blobs: Rc<dyn BlobStore> = Rc::new(MemBlob::new());
            let (mut log, _) = open(&blobs).await;
            // r1 terminates; r2 is left running (zombie).
            append_terminal_run(&mut log, "r1").await;
            log.append(
                SignalKind::RunStarted {
                    agent_id: "coder".into(),
                    goal: "hang".into(),
                },
                run("r2"),
            )
            .await
            .unwrap();
            drop(log);

            let (_log, replayed) = open(&blobs).await;
            let r2: Vec<&Signal> = replayed.iter().filter(|s| s.run_id == run("r2")).collect();
            let proj = fold(r2.iter().copied());
            assert_eq!(proj.status, RunStatus::Interrupted);
            assert!(proj.timeline.iter().any(|t| t.contains("stale epoch")));
            // r1 was already terminal: untouched.
            let r1: Vec<&Signal> = replayed.iter().filter(|s| s.run_id == run("r1")).collect();
            assert_eq!(fold(r1.iter().copied()).status, RunStatus::Answered);
            // Fence terminals are durable in the NEW segment.
            let seg2 = blobs.read("seg-2.jsonl").await.unwrap().unwrap();
            assert!(String::from_utf8_lossy(&seg2).contains("stale epoch"));
        });
    }

    /// A BlobStore double that silently drops writes.
    struct LyingBlob {
        inner: MemBlob,
    }

    impl BlobStore for LyingBlob {
        fn read(&self, path: &str) -> LocalBoxFuture<'_, Result<Option<Vec<u8>>, StoreError>> {
            self.inner.read(path)
        }
        fn write(&self, _path: &str, _bytes: &[u8]) -> LocalBoxFuture<'_, Result<(), StoreError>> {
            Box::pin(async { Ok(()) }) // lies: claims success, stores nothing
        }
        fn remove(&self, path: &str) -> LocalBoxFuture<'_, Result<(), StoreError>> {
            self.inner.remove(path)
        }
        fn list(&self, prefix: &str) -> LocalBoxFuture<'_, Result<Vec<String>, StoreError>> {
            self.inner.list(prefix)
        }
    }

    #[test]
    fn broken_store_degrades_but_signals_keep_flowing() {
        block_on(async {
            let blobs: Rc<dyn BlobStore> = Rc::new(LyingBlob {
                inner: MemBlob::new(),
            });
            let (mut log, _) = open(&blobs).await;
            assert!(!log.degraded());
            // The lying write fails size-verify → degraded, NOT an error;
            // the run's signals keep coming with monotonic seqs.
            let first = log
                .append(
                    SignalKind::RunStarted {
                        agent_id: "a".into(),
                        goal: "g".into(),
                    },
                    run("r1"),
                )
                .await
                .unwrap();
            assert!(log.degraded());
            let second = log.append(SignalKind::LlmRequest, run("r1")).await.unwrap();
            assert_eq!(second.seq, first.seq + 1);
        });
    }

    #[test]
    fn stamps_come_from_injected_clock_and_writer() {
        block_on(async {
            let blobs: Rc<dyn BlobStore> = Rc::new(MemBlob::new());
            let (mut log, _) = open(&blobs).await;
            let signal = log.append(SignalKind::LlmRequest, run("r1")).await.unwrap();
            assert_eq!(signal.seq, 1);
            assert_eq!(signal.ts_ms, 42);
            let line = blobs.read("seg-1.jsonl").await.unwrap().unwrap();
            let stored: Value =
                serde_json::from_str(String::from_utf8_lossy(&line).lines().next().unwrap())
                    .unwrap();
            assert_eq!(stored["kind"], "llm_request");
        });
    }
}
