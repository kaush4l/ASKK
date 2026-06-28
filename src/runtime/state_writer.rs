//! [`StateWriter`] — the single serialized owner of the authoritative
//! [`AppSnapshot`] on main, and the one place durable state-plane writes are applied.
//!
//! # Why it exists (the P0 consistency fix)
//!
//! Before the rewrite, any path that touched state cloned the whole snapshot, mutated
//! its copy, and wrote the whole record back to IndexedDB. With concurrent runs that
//! is a lost-update race: run A reads v, run B reads v, both write back — the last
//! writer clobbers the other. The fix is a single actor that (a) serializes every
//! apply through `&mut self`, and (b) guards each apply with a monotonic `version`:
//! a writer submits the `base_version` it read; if the live snapshot has moved on, the
//! apply is rejected as [`WriteOutcome::Stale`] and the caller re-reads and retries.
//! Apply + version-bump (+ persist, on the wasm side) is one critical section.
//!
//! This module is the pure, host-tested core. The wasm wrapper drains a channel of
//! write requests into a single task (so applies never interleave) and persists the
//! snapshot to IndexedDB inside the same critical section after each [`StateWriter::submit`].

use crate::core::contract::StatePatch;
use crate::state::AppSnapshot;

use super::patch_apply::apply_patches;

/// The result of a guarded write.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WriteOutcome {
    /// Applied; the snapshot's version advanced to `new_version`.
    Applied { new_version: u64 },
    /// Rejected: the submitter's `base_version` is behind `current_version`. The
    /// caller should re-read the live snapshot and rebuild its patch.
    Stale { current_version: u64 },
}

/// The serialized writer. Holding it by `&mut self` for every mutation is what makes
/// applies non-interleaving — there is exactly one of these on main.
#[derive(Debug, Default)]
pub struct StateWriter {
    snapshot: AppSnapshot,
}

impl StateWriter {
    /// Wrap the authoritative snapshot. Its current `version` becomes the baseline.
    pub fn new(snapshot: AppSnapshot) -> Self {
        Self { snapshot }
    }

    /// The live monotonic version a reader should capture as its `base_version`.
    pub fn version(&self) -> u64 {
        self.snapshot.version
    }

    /// Borrow the authoritative snapshot (for rendering / re-reading before a retry).
    pub fn snapshot(&self) -> &AppSnapshot {
        &self.snapshot
    }

    /// Take the authoritative snapshot out (e.g. to hand to persistence). Leaves a
    /// default in place; prefer [`StateWriter::snapshot`] for read-only access.
    pub fn into_snapshot(self) -> AppSnapshot {
        self.snapshot
    }

    /// Apply a state-plane write **iff** `base_version` matches the live version. On
    /// success with a non-empty patch the version advances by one (so a stale
    /// concurrent writer is caught). A no-op write is a successful nothing — it neither
    /// bumps the version nor fails.
    pub fn submit(&mut self, base_version: u64, patches: Vec<StatePatch>) -> WriteOutcome {
        if base_version != self.snapshot.version {
            return WriteOutcome::Stale {
                current_version: self.snapshot.version,
            };
        }
        let all_empty = patches.iter().all(StatePatch::is_empty);
        if !all_empty {
            apply_patches(&mut self.snapshot, patches);
            self.snapshot.version += 1;
        }
        WriteOutcome::Applied {
            new_version: self.snapshot.version,
        }
    }

    /// Owner-driven apply that does not need the guard (the main thread mutating its
    /// own snapshot — e.g. settings edits). Always applies and bumps the version, so
    /// any in-flight guarded writer correctly observes the change and retries.
    pub fn force_apply(&mut self, patches: Vec<StatePatch>) {
        if patches.iter().all(StatePatch::is_empty) {
            return;
        }
        apply_patches(&mut self.snapshot, patches);
        self.snapshot.version += 1;
    }

    /// Replace the authoritative snapshot wholesale (e.g. after a load from IndexedDB),
    /// adopting its version as the new baseline.
    pub fn replace(&mut self, snapshot: AppSnapshot) {
        self.snapshot = snapshot;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal non-empty patch that needs no struct construction.
    fn patch(id: &str) -> StatePatch {
        StatePatch::ScheduleRemoved { id: id.to_string() }
    }

    #[test]
    fn matching_base_version_applies_and_bumps() {
        let mut writer = StateWriter::new(AppSnapshot::default());
        assert_eq!(writer.version(), 0);
        let outcome = writer.submit(0, vec![patch("x")]);
        assert_eq!(outcome, WriteOutcome::Applied { new_version: 1 });
        assert_eq!(writer.version(), 1);
    }

    #[test]
    fn stale_base_version_is_rejected_without_mutation() {
        let mut writer = StateWriter::new(AppSnapshot::default());
        assert_eq!(
            writer.submit(0, vec![patch("a")]),
            WriteOutcome::Applied { new_version: 1 }
        );
        // A writer that still thinks it's at v0 is rejected, and nothing changes.
        assert_eq!(
            writer.submit(0, vec![patch("b")]),
            WriteOutcome::Stale { current_version: 1 }
        );
        assert_eq!(writer.version(), 1);
    }

    #[test]
    fn empty_write_is_a_successful_noop_and_does_not_bump() {
        let mut writer = StateWriter::new(AppSnapshot::default());
        let outcome = writer.submit(0, vec![StatePatch::Empty]);
        assert_eq!(outcome, WriteOutcome::Applied { new_version: 0 });
        assert_eq!(writer.version(), 0);
    }

    #[test]
    fn force_apply_bumps_so_guarded_writers_see_the_change() {
        let mut writer = StateWriter::new(AppSnapshot::default());
        writer.force_apply(vec![patch("owner-edit")]);
        assert_eq!(writer.version(), 1);
        // A reader who captured v0 before the owner edit is now correctly stale.
        assert_eq!(
            writer.submit(0, vec![patch("z")]),
            WriteOutcome::Stale { current_version: 1 }
        );
    }

    #[test]
    fn serialized_applies_advance_monotonically() {
        let mut writer = StateWriter::new(AppSnapshot::default());
        for expected in 1..=5 {
            let base = writer.version();
            assert_eq!(
                writer.submit(base, vec![patch("loop")]),
                WriteOutcome::Applied {
                    new_version: expected
                }
            );
        }
        assert_eq!(writer.version(), 5);
    }
}
