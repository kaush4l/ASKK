//! The pure **patch applier** — the only code that turns a [`StatePatch`] into a
//! mutation of [`AppSnapshot`]. In the rearchitected runtime a tool never holds
//! `&mut AppSnapshot`; it runs in another worker and returns a typed
//! [`StatePatch`] across the hub. The single StateWriter actor (the layer above
//! this one) owns the live snapshot and folds each response's patch back through
//! exactly these functions, in arrival order. Centralizing the fold here is what
//! lets the writer be the *sole* mutator: there is one place that knows how every
//! variant lands, so the rest of the system can reason about durable state as an
//! ordered application of value deltas rather than scattered `&mut` writes.
//!
//! Why a separate module from the StateWriter actor: this code is platform-free —
//! no clock, no web APIs, no channels — so it compiles and unit-tests on the host
//! (invariant 5). The actor that wraps it adds the worker plumbing; the *rules* of
//! how a patch changes the snapshot live here, fully testable in isolation.
//!
//! Semantics are deliberately minimal and total: every [`StatePatch`] variant is
//! handled, `Empty` is a no-op, and `Many` recurses in order so a composed patch
//! applies as if its parts arrived back-to-back. Memory merges reuse
//! [`merge_agent_memories`] verbatim rather than re-deriving merge rules, so the
//! patch path and the legacy in-engine path can never drift apart.

use crate::core::contract::StatePatch;
use crate::state::{AgentRun, AppSnapshot, RunArtifact, ScheduleEntry, merge_agent_memories};

/// Apply a batch of patches to `snapshot`, in order. Order matters: two patches in
/// the same batch that touch the same id (e.g. a `ScheduleAdded` then a matching
/// `ScheduleRemoved`) must compose left-to-right, mirroring how the StateWriter
/// folds responses as they settle. This is the entry point the writer calls.
pub fn apply_patches(snapshot: &mut AppSnapshot, patches: Vec<StatePatch>) {
    for patch in patches {
        apply_one(snapshot, patch);
    }
}

/// Apply a single patch to `snapshot`. Exhaustive over [`StatePatch`]: adding a
/// variant is a compile error here until it is handled, which is the whole point
/// of the closed enum — the sole mutator must account for every possible change.
pub fn apply_one(snapshot: &mut AppSnapshot, patch: StatePatch) {
    match patch {
        // No durable change. Kept explicit (not a fallthrough) so the match stays
        // exhaustive-by-name and a future variant cannot silently become a no-op.
        StatePatch::Empty => {}

        // Reuse the canonical merge rather than re-implementing upsert-by-agent-id.
        // `Memories` is a single delta (one tool's write-back), so it is wrapped as
        // a one-batch call: within the batch, entries upsert in iteration order, and
        // across separate patches the later `apply_one` wins — exactly the engine's
        // last-write-wins ordering (see `engine.rs` dispatch fold).
        StatePatch::Memories(mems) => {
            merge_agent_memories(&mut snapshot.agent_memories, vec![mems]);
        }

        // Upsert by id: a re-add of the same schedule replaces it in place (so an
        // edit-then-readd does not duplicate the entry); a new id pushes.
        StatePatch::ScheduleAdded(entry) => {
            upsert_schedule(&mut snapshot.schedules, entry);
        }

        // Idempotent removal: retain everything whose id differs. Removing an id
        // that is not present is a silent no-op (the entry may already be gone).
        StatePatch::ScheduleRemoved { id } => {
            snapshot.schedules.retain(|entry| entry.id != id);
        }

        // Append to the named run's scratchpad gallery. The run can be the live
        // `current_run` and/or a member of `runs` (the snapshot can carry both views
        // of the same run), so we append to every match to keep the two views in
        // sync. A patch for an unknown run id is dropped — the run is gone or never
        // existed, and there is nowhere to attach the artifact.
        StatePatch::ArtifactAppended { run_id, artifact } => {
            append_artifact_to_run(snapshot, &run_id, artifact);
        }

        // Upsert by path: re-writing the same file replaces its hint in place; a new
        // path pushes. Mirrors the OPFS data plane, where a write to an existing path
        // overwrites rather than creating a second entry.
        StatePatch::UpsertFileMeta(meta) => {
            if let Some(existing) = snapshot.files.iter_mut().find(|f| f.path == meta.path) {
                *existing = meta;
            } else {
                snapshot.files.push(meta);
            }
        }

        // Compose: apply each child in order. Recursion (rather than flattening)
        // keeps nested `Many` patches working without special-casing depth.
        StatePatch::Many(patches) => {
            apply_patches(snapshot, patches);
        }
    }
}

/// Upsert a schedule entry by `id`: replace an existing entry with the same id in
/// place, otherwise push. Pulled out so the replace-or-push intent reads at the
/// call site and the two arms cannot diverge.
fn upsert_schedule(schedules: &mut Vec<ScheduleEntry>, entry: ScheduleEntry) {
    if let Some(existing) = schedules.iter_mut().find(|e| e.id == entry.id) {
        *existing = entry;
    } else {
        schedules.push(entry);
    }
}

/// Append `artifact` to every run matching `run_id` reachable from the snapshot —
/// the live `current_run` and any entry in `runs`. Both can hold the same run id
/// (the current run is mirrored into the history list), so appending to all matches
/// keeps the gallery consistent regardless of which view the UI is rendering.
fn append_artifact_to_run(snapshot: &mut AppSnapshot, run_id: &str, artifact: RunArtifact) {
    if let Some(run) = snapshot.current_run_mut().filter(|run| run.id == run_id) {
        push_artifact(run, artifact.clone());
    }
    for run in snapshot.runs.iter_mut().filter(|run| run.id == run_id) {
        push_artifact(run, artifact.clone());
    }
}

/// Push one artifact onto a run's scratchpad gallery. The single place that knows
/// the artifact lives at `run.scratchpad.artifacts`, so the path is stated once.
fn push_artifact(run: &mut AgentRun, artifact: RunArtifact) {
    run.scratchpad.artifacts.push(artifact);
}

#[cfg(test)]
mod tests {
    // Test fixtures build a default snapshot then set a couple of fields — clearer
    // here than a full struct-init with `..Default::default()`.
    #![allow(clippy::field_reassign_with_default)]
    use super::*;
    use crate::state::{AgentMemory, ArtifactKind, FileMeta, ScheduleKind, SchedulePayload};

    fn memory(agent_id: &str, summary: &str) -> AgentMemory {
        AgentMemory {
            agent_id: agent_id.into(),
            rolling_summary: summary.into(),
            updated_at: String::new(),
        }
    }

    fn schedule(id: &str, label: &str) -> ScheduleEntry {
        ScheduleEntry {
            id: id.into(),
            label: label.into(),
            kind: ScheduleKind::OneShot { fire_at_ms: 1 },
            payload: SchedulePayload::Notification { text: "x".into() },
            enabled: true,
            last_fired_ms: None,
        }
    }

    fn artifact(id: &str, name: &str) -> RunArtifact {
        RunArtifact {
            id: id.into(),
            name: name.into(),
            artifact_type: ArtifactKind::default(),
            content: "body".into(),
        }
    }

    fn run(id: &str) -> AgentRun {
        AgentRun {
            id: id.into(),
            goal: "g".into(),
            status: Default::default(),
            lane: Default::default(),
            scratchpad: Default::default(),
            messages: Vec::new(),
            events: Vec::new(),
            tool_calls: Vec::new(),
            tool_results: Vec::new(),
            final_answer: String::new(),
            created_at: String::new(),
        }
    }

    fn file(path: &str, sha: &str) -> FileMeta {
        FileMeta {
            path: path.into(),
            size: 1,
            sha256: sha.into(),
            modified_at: "unix-ms:1".into(),
        }
    }

    #[test]
    fn empty_is_a_no_op() {
        let mut snap = AppSnapshot::default();
        let before = snap.clone();
        apply_one(&mut snap, StatePatch::Empty);
        assert_eq!(snap, before);
    }

    #[test]
    fn memories_merge_and_upsert_by_agent_id() {
        let mut snap = AppSnapshot::default();
        apply_one(
            &mut snap,
            StatePatch::Memories(vec![memory("researcher", "first")]),
        );
        assert_eq!(snap.agent_memories.len(), 1);
        assert_eq!(snap.agent_memories[0].rolling_summary, "first");

        // A second patch for the same agent upserts (replaces) — last write wins,
        // matching the engine's per-call fold semantics.
        apply_one(
            &mut snap,
            StatePatch::Memories(vec![memory("researcher", "second")]),
        );
        assert_eq!(snap.agent_memories.len(), 1);
        assert_eq!(snap.agent_memories[0].rolling_summary, "second");

        // A different agent appends a new entry.
        apply_one(&mut snap, StatePatch::Memories(vec![memory("coder", "c")]));
        assert_eq!(snap.agent_memories.len(), 2);
    }

    #[test]
    fn schedule_added_pushes_then_replaces_by_id() {
        let mut snap = AppSnapshot::default();
        apply_one(
            &mut snap,
            StatePatch::ScheduleAdded(schedule("s1", "label-a")),
        );
        assert_eq!(snap.schedules.len(), 1);
        assert_eq!(snap.schedules[0].label, "label-a");

        // Re-adding the same id replaces in place (no duplicate).
        apply_one(
            &mut snap,
            StatePatch::ScheduleAdded(schedule("s1", "label-b")),
        );
        assert_eq!(snap.schedules.len(), 1);
        assert_eq!(snap.schedules[0].label, "label-b");

        // A new id pushes alongside.
        apply_one(
            &mut snap,
            StatePatch::ScheduleAdded(schedule("s2", "label-c")),
        );
        assert_eq!(snap.schedules.len(), 2);
    }

    #[test]
    fn schedule_removed_retains_others_and_is_idempotent() {
        let mut snap = AppSnapshot::default();
        snap.schedules = vec![schedule("s1", "a"), schedule("s2", "b")];

        apply_one(&mut snap, StatePatch::ScheduleRemoved { id: "s1".into() });
        assert_eq!(snap.schedules.len(), 1);
        assert_eq!(snap.schedules[0].id, "s2");

        // Removing a missing id is a silent no-op.
        apply_one(
            &mut snap,
            StatePatch::ScheduleRemoved {
                id: "missing".into(),
            },
        );
        assert_eq!(snap.schedules.len(), 1);
    }

    #[test]
    fn artifact_appended_to_current_run() {
        let mut snap = AppSnapshot::default();
        snap.set_current_run(Some(run("r1")));
        apply_one(
            &mut snap,
            StatePatch::ArtifactAppended {
                run_id: "r1".into(),
                artifact: artifact("a1", "chart"),
            },
        );
        let current = snap.current_run().unwrap();
        assert_eq!(current.scratchpad.artifacts.len(), 1);
        assert_eq!(current.scratchpad.artifacts[0].id, "a1");
    }

    #[test]
    fn artifact_appended_to_history_run() {
        let mut snap = AppSnapshot::default();
        snap.runs = vec![run("r1"), run("r2")];
        apply_one(
            &mut snap,
            StatePatch::ArtifactAppended {
                run_id: "r2".into(),
                artifact: artifact("a1", "chart"),
            },
        );
        assert!(snap.runs[0].scratchpad.artifacts.is_empty());
        assert_eq!(snap.runs[1].scratchpad.artifacts.len(), 1);
    }

    #[test]
    fn artifact_appended_to_both_views_of_same_run() {
        // The current run is mirrored into history; an artifact must land in both
        // so whichever view the UI renders shows the same gallery.
        let mut snap = AppSnapshot::default();
        snap.set_current_run(Some(run("r1")));
        snap.runs = vec![run("r1")];
        apply_one(
            &mut snap,
            StatePatch::ArtifactAppended {
                run_id: "r1".into(),
                artifact: artifact("a1", "chart"),
            },
        );
        assert_eq!(snap.current_run().unwrap().scratchpad.artifacts.len(), 1);
        assert_eq!(snap.runs[0].scratchpad.artifacts.len(), 1);
    }

    #[test]
    fn artifact_for_unknown_run_is_dropped() {
        let mut snap = AppSnapshot::default();
        snap.set_current_run(Some(run("r1")));
        snap.runs = vec![run("r1")];
        apply_one(
            &mut snap,
            StatePatch::ArtifactAppended {
                run_id: "ghost".into(),
                artifact: artifact("a1", "chart"),
            },
        );
        assert!(snap.current_run().unwrap().scratchpad.artifacts.is_empty());
        assert!(snap.runs[0].scratchpad.artifacts.is_empty());
    }

    #[test]
    fn upsert_file_meta_pushes_then_replaces_by_path() {
        let mut snap = AppSnapshot::default();
        apply_one(
            &mut snap,
            StatePatch::UpsertFileMeta(file("notes.md", "aaa")),
        );
        assert_eq!(snap.files.len(), 1);
        assert_eq!(snap.files[0].sha256, "aaa");

        // Re-writing the same path replaces the hint in place (CAS overwrite).
        apply_one(
            &mut snap,
            StatePatch::UpsertFileMeta(file("notes.md", "bbb")),
        );
        assert_eq!(snap.files.len(), 1);
        assert_eq!(snap.files[0].sha256, "bbb");

        // A new path pushes.
        apply_one(
            &mut snap,
            StatePatch::UpsertFileMeta(file("todo.md", "ccc")),
        );
        assert_eq!(snap.files.len(), 2);
    }

    #[test]
    fn many_applies_children_in_order() {
        let mut snap = AppSnapshot::default();
        apply_one(
            &mut snap,
            StatePatch::Many(vec![
                StatePatch::ScheduleAdded(schedule("s1", "a")),
                StatePatch::UpsertFileMeta(file("f.md", "h")),
                StatePatch::ScheduleRemoved { id: "s1".into() },
            ]),
        );
        // s1 added then removed within the same batch → gone; file remains.
        assert!(snap.schedules.is_empty());
        assert_eq!(snap.files.len(), 1);
    }

    #[test]
    fn nested_many_recurses() {
        let mut snap = AppSnapshot::default();
        apply_one(
            &mut snap,
            StatePatch::Many(vec![
                StatePatch::Empty,
                StatePatch::Many(vec![
                    StatePatch::ScheduleAdded(schedule("s1", "a")),
                    StatePatch::Many(vec![StatePatch::UpsertFileMeta(file("f.md", "h"))]),
                ]),
            ]),
        );
        assert_eq!(snap.schedules.len(), 1);
        assert_eq!(snap.files.len(), 1);
    }

    #[test]
    fn apply_patches_folds_a_batch_in_order() {
        let mut snap = AppSnapshot::default();
        apply_patches(
            &mut snap,
            vec![
                StatePatch::Memories(vec![memory("a", "1")]),
                StatePatch::Memories(vec![memory("a", "2")]),
                StatePatch::ScheduleAdded(schedule("s1", "x")),
            ],
        );
        assert_eq!(snap.agent_memories.len(), 1);
        assert_eq!(snap.agent_memories[0].rolling_summary, "2");
        assert_eq!(snap.schedules.len(), 1);
    }
}
