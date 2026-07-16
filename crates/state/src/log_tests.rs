//! Tests for the signal log — split from `log.rs` to stay under the
//! ADR-012 file-size cap; a `#[path]` child module keeps the same privacy
//! access as an inline `mod tests` (same trick as `boot_tests.rs`).

use super::*;
use crate::block_on;
use crate::store::{LocalBoxFuture, MemBlob};
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

#[test]
fn clear_drops_the_archive_and_later_appends_do_not_resurrect_it() {
    block_on(async {
        let blobs: Rc<dyn BlobStore> = Rc::new(MemBlob::new());
        let (mut log, _) = open(&blobs).await;
        append_terminal_run(&mut log, "r1").await;
        drop(log);
        // A second epoch, so there is more than one segment to drop.
        let (mut log, replayed) = open(&blobs).await;
        assert!(!replayed.is_empty());
        append_terminal_run(&mut log, "r2").await;

        log.clear().await.unwrap();
        assert!(blobs.list("seg-").await.unwrap().is_empty());
        // The live epoch keeps writing: only post-clear signals persist,
        // and a reopen replays exactly those.
        append_terminal_run(&mut log, "r3").await;
        drop(log);
        let (_log, replayed) = open(&blobs).await;
        let ids: Vec<&RunId> = replayed.iter().map(|s| &s.run_id).collect();
        assert!(ids.iter().all(|id| **id == run("r3")), "ids: {ids:?}");
    });
}

/// A BlobStore double whose `remove` always refuses.
struct StubbornBlob {
    inner: MemBlob,
}

impl BlobStore for StubbornBlob {
    fn read(&self, path: &str) -> LocalBoxFuture<'_, Result<Option<Vec<u8>>, StoreError>> {
        self.inner.read(path)
    }
    fn write(&self, path: &str, bytes: &[u8]) -> LocalBoxFuture<'_, Result<(), StoreError>> {
        self.inner.write(path, bytes)
    }
    fn remove(&self, _path: &str) -> LocalBoxFuture<'_, Result<(), StoreError>> {
        Box::pin(async { Err(StoreError::new("remove refused")) })
    }
    fn list(&self, prefix: &str) -> LocalBoxFuture<'_, Result<Vec<String>, StoreError>> {
        self.inner.list(prefix)
    }
}

#[test]
fn clear_is_best_effort_every_segment_tried_and_the_failure_reported() {
    block_on(async {
        let blobs: Rc<dyn BlobStore> = Rc::new(StubbornBlob {
            inner: MemBlob::new(),
        });
        let (mut log, _) = open(&blobs).await;
        append_terminal_run(&mut log, "r1").await;
        // The refusal is reported, not swallowed...
        assert!(log.clear().await.is_err());
        // ...and the live epoch still forgot its lines, so the next append
        // rewrites the segment without them.
        assert!(log.buf.is_empty());
        append_terminal_run(&mut log, "r2").await;
        drop(log);
        let (_log, replayed) = open(&blobs).await;
        let ids: Vec<&RunId> = replayed.iter().map(|s| &s.run_id).collect();
        assert!(ids.iter().all(|id| **id == run("r2")), "ids: {ids:?}");
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
fn health_probe_reads_degradation_live() {
    block_on(async {
        let blobs: Rc<dyn BlobStore> = Rc::new(LyingBlob {
            inner: MemBlob::new(),
        });
        let (mut log, _) = open(&blobs).await;
        let probe = log.health_probe();
        assert_eq!(probe.epoch(), log.epoch());
        assert_eq!(probe.quarantined(), log.quarantined());
        assert!(!probe.degraded());
        // The lying write fails size-verify → the shared cell flips and
        // the probe taken BEFORE the failure observes it.
        log.append(SignalKind::LlmRequest, run("r1")).await.unwrap();
        assert!(log.degraded());
        assert!(probe.degraded());
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
            serde_json::from_str(String::from_utf8_lossy(&line).lines().next().unwrap()).unwrap();
        assert_eq!(stored["kind"], "llm_request");
    });
}
