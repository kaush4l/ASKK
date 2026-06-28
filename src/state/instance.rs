//! [`EngineInstance`] — an engine run made a first-class, addressable object, and
//! [`InstanceCollection`], the keyed set of them the [`super::AppSnapshot`] holds in
//! place of a single `current_run: Option<AgentRun>`.
//!
//! Today the runtime drives exactly one live run at a time, and the rest of the app
//! (UI, storage, worker) reads it back through `current_run`. This unit keeps that
//! behavior byte-for-byte — the *active* instance's [`projection`](EngineInstance::projection)
//! IS the old `current_run` — while giving the run an explicit identity ([`RunId`]),
//! status, reducer, and control handle. The multi-instance fleet (queue, fleet UI,
//! per-instance persistence) is built on top of this noun in later units.

use super::run::{AgentRun, RunId, RunStatus};
use crate::core::event::Signal;
use crate::runtime::RunReducer;

/// Per-instance control state: the cooperative lifecycle knobs the fleet flips by
/// id. The interrupt/pause flags are scaffolding here — the live interrupt path
/// still consults the engine's keyed thread-local set (so a wasm worker can signal
/// a run mid-turn) — but they let a held [`EngineInstance`] record and report its
/// own requested control state without a global flag.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct InstanceControl {
    /// A stop was requested for this instance (halt after the current turn).
    pub interrupt_requested: bool,
    /// The instance is paused (resumable) rather than actively running.
    pub paused: bool,
}

/// One engine run as an addressable object: its identity and status, the
/// projected [`AgentRun`] view the UI renders, the [`RunReducer`] that folds its
/// signal stream into that projection, and its [`InstanceControl`] handle.
///
/// The `reducer` and `control` are runtime-only (not persisted): a reloaded
/// snapshot rebuilds them from the projection. Only `id`/`status`/`projection`
/// ride on the wire, and even those flatten back through the legacy
/// `current_run`/`runs` fields (see [`super::AppSnapshot`]); the struct here stays
/// host-testable and serde-free for the fields that have no on-disk meaning yet.
#[derive(Clone, Debug, PartialEq)]
pub struct EngineInstance {
    /// The run's stable identity.
    pub id: RunId,
    /// The run's lifecycle status (mirrors `projection.status`).
    pub status: RunStatus,
    /// The renderable run view — the old `current_run`.
    pub projection: AgentRun,
    /// Folds this instance's signal stream into `projection` (worker path).
    pub reducer: RunReducer,
    /// Cooperative lifecycle control for this instance.
    pub control: InstanceControl,
}

impl EngineInstance {
    /// Build an instance from a projected run, deriving its id and status from the
    /// run. The reducer and control start empty/default — they carry no durable
    /// state, so a freshly seeded instance matches one rebuilt after a reload.
    pub fn from_run(run: AgentRun) -> Self {
        Self {
            id: RunId::from(run.id.clone()),
            status: run.status,
            projection: run,
            reducer: RunReducer::default(),
            control: InstanceControl::default(),
        }
    }

    /// Build an empty instance bound to `id` with a fresh reducer: the seam for a
    /// live signal stream that has only just begun. The reducer is unbound until it
    /// folds a `RunStarted`, and the projection is an empty shell until then — so a
    /// freshly seeded instance carries the run's identity (for keyed routing)
    /// before any delta has rebuilt its renderable view.
    ///
    /// Routed into only from the wasm worker client (and this module's tests), so
    /// it is allowed dead on the host build.
    #[allow(dead_code)]
    pub fn seeded(id: RunId) -> Self {
        let reducer = RunReducer::new();
        let projection = reducer.run().clone();
        Self {
            id,
            status: projection.status,
            projection,
            reducer,
            control: InstanceControl::default(),
        }
    }

    /// Whether this instance is still live (running or paused), as opposed to a
    /// terminal run. "Active = most-recent live" uses this predicate. Reads the
    /// authoritative `projection.status` (not the cached `status` field) so a run
    /// mutated in place through `current_run_mut` can never make liveness drift.
    pub fn is_live(&self) -> bool {
        !self.projection.status.is_terminal()
    }

    /// Replace this instance's projected run, keeping `status` in lockstep.
    pub fn set_projection(&mut self, run: AgentRun) {
        self.status = run.status;
        self.projection = run;
    }

    /// Fold one [`Signal`] into this instance's own reducer, then refresh its
    /// renderable [`projection`](Self::projection) from the reducer's reconstructed
    /// run. The reducer keys on `run_id`, so a foreign signal is a no-op on the
    /// view; the projection only moves when the signal belongs to this instance.
    #[allow(dead_code)]
    pub fn apply_signal(&mut self, signal: &Signal) {
        self.reducer.apply(signal);
        self.set_projection(self.reducer.run().clone());
    }

    /// Replace this instance's projection wholesale from an authoritative terminal
    /// run (the [`RunReducer::reconcile`] safety net), bounding how far the live
    /// delta view could have drifted, and keep `status` in lockstep.
    #[allow(dead_code)]
    pub fn reconcile(&mut self, authoritative: AgentRun) {
        self.reducer.reconcile(authoritative);
        self.set_projection(self.reducer.run().clone());
    }
}

/// A `RunId`-keyed set of [`EngineInstance`]s. Backed by a `Vec` (insertion order
/// is the chronological run order) plus an id lookup; a single live run is the
/// common case, so the linear scan is cheap. The *active* instance — the one whose
/// projection stands in for the legacy `current_run` — is the most-recent live
/// instance, falling back to the last instance overall when none is live.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct InstanceCollection {
    instances: Vec<EngineInstance>,
}

// Several methods below (the read API: `len`/`is_empty`/`iter`/`get`, the keyed
// control helpers, and `resync_active_status`) are the foundation surface the
// fleet units (projection/queue/fleet UI/control) consume. They are exercised by
// this module's tests but have no in-crate caller yet, so they are explicitly
// allowed dead until those units land.
impl InstanceCollection {
    /// An empty collection (no runs yet).
    pub fn new() -> Self {
        Self::default()
    }

    /// Number of instances held.
    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.instances.len()
    }

    /// Whether the collection holds no instances.
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.instances.is_empty()
    }

    /// Iterate every instance in chronological (insertion) order.
    pub fn iter(&self) -> impl Iterator<Item = &EngineInstance> {
        self.instances.iter()
    }

    /// Iterate every instance mutably, in chronological (insertion) order. The
    /// fleet-wide reload recovery walks this to pause every `Running` instance.
    pub fn iter_mut(&mut self) -> impl Iterator<Item = &mut EngineInstance> {
        self.instances.iter_mut()
    }

    /// Snapshot every instance's projected run, in chronological order — the durable
    /// view that rides on the wire. Only the projections persist; the reducer and
    /// control are runtime-only and rebuilt on load (see [`EngineInstance::from_run`]).
    pub fn projections(&self) -> Vec<AgentRun> {
        self.instances
            .iter()
            .map(|instance| instance.projection.clone())
            .collect()
    }

    /// Find an instance by id.
    #[allow(dead_code)]
    pub fn get(&self, id: &RunId) -> Option<&EngineInstance> {
        self.instances.iter().find(|instance| &instance.id == id)
    }

    /// Find an instance by id (mutable).
    pub fn get_mut(&mut self, id: &RunId) -> Option<&mut EngineInstance> {
        self.instances
            .iter_mut()
            .find(|instance| &instance.id == id)
    }

    /// The index of the active instance: the most-recent live one, else the last
    /// instance overall. `None` only when the collection is empty.
    fn active_index(&self) -> Option<usize> {
        if self.instances.is_empty() {
            return None;
        }
        self.instances
            .iter()
            .rposition(EngineInstance::is_live)
            .or(Some(self.instances.len() - 1))
    }

    /// The active instance — the projection stand-in for the legacy `current_run`.
    pub fn active(&self) -> Option<&EngineInstance> {
        self.active_index().map(|index| &self.instances[index])
    }

    /// The active instance (mutable).
    pub fn active_mut(&mut self) -> Option<&mut EngineInstance> {
        self.active_index().map(|index| &mut self.instances[index])
    }

    /// The active instance's projected run — the old `current_run` read.
    pub fn active_run(&self) -> Option<&AgentRun> {
        self.active().map(|instance| &instance.projection)
    }

    /// The active instance's projected run (mutable) — the old `current_run_mut`.
    /// Mutating the projection can change its status, so callers that flip status
    /// should follow with [`Self::resync_active_status`] (or go through the
    /// snapshot accessor, which does).
    pub fn active_run_mut(&mut self) -> Option<&mut AgentRun> {
        self.active_mut().map(|instance| &mut instance.projection)
    }

    /// Re-derive the active instance's `status` from its projection. Used after a
    /// caller mutated the projection in place via [`Self::active_run_mut`].
    #[allow(dead_code)]
    pub fn resync_active_status(&mut self) {
        if let Some(instance) = self.active_mut() {
            instance.status = instance.projection.status;
        }
    }

    /// Upsert an instance from a projected run: replace the existing instance with
    /// the same id in place (keeping its reducer/control), otherwise push a new
    /// one. This is the seam the legacy `snapshot.current_run = Some(run)` setter
    /// routes through.
    pub fn upsert_run(&mut self, run: AgentRun) {
        let id = RunId::from(run.id.clone());
        if let Some(instance) = self.get_mut(&id) {
            instance.set_projection(run);
        } else {
            self.instances.push(EngineInstance::from_run(run));
        }
    }

    /// Route one [`Signal`] to the instance that owns it (keyed by the signal's
    /// `run_id`) and refresh that instance's projection from its own reducer, so N
    /// concurrent runs each project independently with no cross-contamination.
    ///
    /// An instance for the signal's run is created on demand: the run's first
    /// `RunStarted` seed binds a fresh instance. A non-seed signal that arrives
    /// before any instance exists for that run is dropped (its reducer would ignore
    /// it anyway), so a stray early delta never spawns an empty ghost instance.
    /// Returns the [`RunId`] the signal was routed to when an instance handled it,
    /// so the caller can drive its observer with that instance's projection.
    ///
    /// Routed into only from the wasm worker client (and this module's tests), so
    /// it is allowed dead on the host build.
    #[allow(dead_code)]
    pub fn apply_signal(&mut self, signal: &Signal) -> Option<RunId> {
        let id = RunId::from(signal.run_id.clone());
        if let Some(instance) = self.get_mut(&id) {
            instance.apply_signal(signal);
            return Some(id);
        }
        // No instance yet: fold into a throwaway seeded one. Keep it only if the
        // signal actually bound the reducer (a `RunStarted` seed) — otherwise the
        // reducer stayed unbound and the projection is empty, so there is nothing
        // to render and we drop the ghost.
        let mut instance = EngineInstance::seeded(id.clone());
        instance.apply_signal(signal);
        if instance.reducer.run_id().is_some() {
            self.instances.push(instance);
            Some(id)
        } else {
            None
        }
    }

    /// Reconcile the instance that owns `run_id` from an authoritative terminal
    /// run, replacing its projection wholesale (the [`RunReducer::reconcile`] safety
    /// net applied to the matching instance). Returns whether an instance was found;
    /// a terminal snapshot for an unknown run is a no-op.
    #[allow(dead_code)]
    pub fn reconcile_run(&mut self, run_id: &RunId, authoritative: AgentRun) -> bool {
        match self.get_mut(run_id) {
            Some(instance) => {
                instance.reconcile(authoritative);
                true
            }
            None => false,
        }
    }

    /// Drop every instance. The seam for `snapshot.current_run = None` when the
    /// caller is starting a fresh chat (it clears `runs` alongside).
    pub fn clear(&mut self) {
        self.instances.clear();
    }

    /// Remove the active instance, if any. The seam for `snapshot.current_run =
    /// None` when only the live run should be dropped.
    pub fn clear_active(&mut self) {
        if let Some(index) = self.active_index() {
            self.instances.remove(index);
        }
    }

    /// Mark an interrupt as requested for the instance with `id`. Returns whether
    /// the instance was found. Per-instance control scaffolding alongside the
    /// engine's keyed interrupt set.
    #[allow(dead_code)]
    pub fn request_interrupt(&mut self, id: &RunId) -> bool {
        match self.get_mut(id) {
            Some(instance) => {
                instance.control.interrupt_requested = true;
                true
            }
            None => false,
        }
    }

    /// Pause the instance with `id` (records the requested control state).
    #[allow(dead_code)]
    pub fn pause(&mut self, id: &RunId) -> bool {
        match self.get_mut(id) {
            Some(instance) => {
                instance.control.paused = true;
                true
            }
            None => false,
        }
    }

    /// Resume the instance with `id` (clears the paused/interrupt control state).
    #[allow(dead_code)]
    pub fn resume(&mut self, id: &RunId) -> bool {
        match self.get_mut(id) {
            Some(instance) => {
                instance.control.paused = false;
                instance.control.interrupt_requested = false;
                true
            }
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::event::{Signal, SignalKind};
    use crate::state::{Message, RunLane};

    fn sig(seq: u64, run: &str, instance: &str, kind: SignalKind) -> Signal {
        Signal::new(seq, run, instance, kind, seq as f64)
    }

    fn run_started(run: &str, goal: &str) -> SignalKind {
        SignalKind::RunStarted {
            id: run.to_string(),
            goal: goal.to_string(),
            lane: RunLane::SingleAction,
            created_at: "unix-ms:5".to_string(),
        }
    }

    fn run(id: &str, status: RunStatus) -> AgentRun {
        AgentRun {
            id: id.to_string(),
            goal: "goal".to_string(),
            status,
            lane: Default::default(),
            scratchpad: Default::default(),
            messages: Vec::new(),
            events: Vec::new(),
            tool_calls: Vec::new(),
            tool_results: Vec::new(),
            final_answer: String::new(),
            created_at: "now".to_string(),
        }
    }

    #[test]
    fn run_id_round_trips_through_string_wire_format() {
        let id = RunId::from("run-1".to_string());
        let json = serde_json::to_string(&id).unwrap();
        assert_eq!(json, "\"run-1\"", "RunId serializes as the bare string");
        let back: RunId = serde_json::from_str(&json).unwrap();
        assert_eq!(back, id);
        assert_eq!(id.as_str(), "run-1");
        assert_eq!(id.as_ref(), "run-1");
        assert_eq!(id.to_string(), "run-1");
    }

    #[test]
    fn active_is_the_only_run_when_one_is_present() {
        let mut collection = InstanceCollection::new();
        collection.upsert_run(run("r1", RunStatus::Running));
        assert_eq!(collection.active_run().map(|r| r.id.as_str()), Some("r1"));
    }

    #[test]
    fn active_prefers_the_most_recent_live_instance() {
        let mut collection = InstanceCollection::new();
        collection.upsert_run(run("done", RunStatus::Complete));
        collection.upsert_run(run("live", RunStatus::Running));
        collection.upsert_run(run("also-done", RunStatus::Complete));
        // The most-recent LIVE instance wins over a later terminal one.
        assert_eq!(collection.active_run().map(|r| r.id.as_str()), Some("live"));
    }

    #[test]
    fn active_falls_back_to_the_last_instance_when_none_are_live() {
        let mut collection = InstanceCollection::new();
        collection.upsert_run(run("first", RunStatus::Complete));
        collection.upsert_run(run("last", RunStatus::Error));
        assert_eq!(collection.active_run().map(|r| r.id.as_str()), Some("last"));
    }

    #[test]
    fn upsert_replaces_an_existing_instance_in_place() {
        let mut collection = InstanceCollection::new();
        collection.upsert_run(run("r1", RunStatus::Running));
        let mut updated = run("r1", RunStatus::Complete);
        updated.final_answer = "done".to_string();
        collection.upsert_run(updated);
        assert_eq!(collection.len(), 1, "same id updates, not appends");
        let active = collection.active().unwrap();
        assert_eq!(active.status, RunStatus::Complete);
        assert_eq!(active.projection.final_answer, "done");
    }

    #[test]
    fn active_run_mut_then_resync_keeps_status_in_lockstep() {
        let mut collection = InstanceCollection::new();
        collection.upsert_run(run("r1", RunStatus::Running));
        collection.active_run_mut().unwrap().status = RunStatus::Paused;
        collection.resync_active_status();
        assert_eq!(collection.active().unwrap().status, RunStatus::Paused);
    }

    #[test]
    fn clear_active_drops_only_the_active_instance() {
        let mut collection = InstanceCollection::new();
        collection.upsert_run(run("done", RunStatus::Complete));
        collection.upsert_run(run("live", RunStatus::Running));
        collection.clear_active();
        assert!(collection.get(&RunId::from("live")).is_none());
        assert!(collection.get(&RunId::from("done")).is_some());
    }

    #[test]
    fn control_helpers_flip_per_instance_state_by_id() {
        let mut collection = InstanceCollection::new();
        collection.upsert_run(run("r1", RunStatus::Running));
        let id = RunId::from("r1");
        assert!(collection.request_interrupt(&id));
        assert!(collection.get(&id).unwrap().control.interrupt_requested);
        assert!(collection.pause(&id));
        assert!(collection.get(&id).unwrap().control.paused);
        assert!(collection.resume(&id));
        assert!(!collection.get(&id).unwrap().control.paused);
        assert!(!collection.get(&id).unwrap().control.interrupt_requested);
        assert!(!collection.request_interrupt(&RunId::from("missing")));
    }

    // A `RunStarted` seed for an as-yet-unknown run creates its instance on demand
    // and binds that instance's own reducer; the projection renders the seed.
    #[test]
    fn apply_signal_creates_an_instance_from_the_run_started_seed() {
        let mut collection = InstanceCollection::new();
        let routed = collection.apply_signal(&sig(0, "r1", "agent-0", run_started("r1", "mine")));
        assert_eq!(routed, Some(RunId::from("r1")));
        assert_eq!(collection.len(), 1);
        let instance = collection.get(&RunId::from("r1")).unwrap();
        assert_eq!(instance.projection.id, "r1");
        assert_eq!(instance.projection.goal, "mine");
        assert_eq!(instance.projection.status, RunStatus::Running);
        assert_eq!(instance.status, RunStatus::Running);
    }

    // A non-seed signal for a run with no instance is dropped — it neither binds a
    // reducer nor leaves an empty ghost instance behind.
    #[test]
    fn apply_signal_drops_a_stray_pre_seed_signal() {
        let mut collection = InstanceCollection::new();
        let routed = collection.apply_signal(&sig(0, "ghost", "a", SignalKind::LlmRequest));
        assert_eq!(routed, None);
        assert!(collection.is_empty());
    }

    // The core property of this unit: two interleaved run_id streams fold into two
    // separate instances, each projecting independently with no cross-contamination.
    #[test]
    fn two_interleaved_streams_project_into_separate_instances() {
        let mut collection = InstanceCollection::new();
        // Interleave the two runs' signals on one shared bus.
        collection.apply_signal(&sig(0, "r1", "agent-0", run_started("r1", "goal one")));
        collection.apply_signal(&sig(0, "r2", "agent-1", run_started("r2", "goal two")));
        collection.apply_signal(&sig(
            1,
            "r1",
            "agent-0",
            SignalKind::ToolRequested {
                call_id: "c1".to_string(),
                name: "search_one".to_string(),
                arguments: serde_json::Value::Null,
            },
        ));
        collection.apply_signal(&sig(
            1,
            "r2",
            "agent-1",
            SignalKind::ToolRequested {
                call_id: "c2".to_string(),
                name: "search_two".to_string(),
                arguments: serde_json::Value::Null,
            },
        ));
        collection.apply_signal(&sig(
            2,
            "r2",
            "agent-1",
            SignalKind::Result {
                final_text: "two done".to_string(),
            },
        ));
        collection.apply_signal(&sig(
            2,
            "r1",
            "agent-0",
            SignalKind::Result {
                final_text: "one done".to_string(),
            },
        ));

        assert_eq!(collection.len(), 2);

        let one = collection.get(&RunId::from("r1")).unwrap();
        assert_eq!(one.projection.goal, "goal one");
        assert_eq!(one.projection.final_answer, "one done");
        assert_eq!(one.projection.tool_calls.len(), 1);
        assert_eq!(one.projection.tool_calls[0].tool_name, "search_one");
        assert_eq!(one.projection.status, RunStatus::Complete);

        let two = collection.get(&RunId::from("r2")).unwrap();
        assert_eq!(two.projection.goal, "goal two");
        assert_eq!(two.projection.final_answer, "two done");
        assert_eq!(two.projection.tool_calls.len(), 1);
        assert_eq!(two.projection.tool_calls[0].tool_name, "search_two");
        assert_eq!(two.projection.status, RunStatus::Complete);

        // No leakage: neither run carries the other's tool call or answer.
        assert!(
            one.projection
                .tool_calls
                .iter()
                .all(|call| call.tool_name != "search_two")
        );
        assert!(
            two.projection
                .tool_calls
                .iter()
                .all(|call| call.tool_name != "search_one")
        );
    }

    // The single-run case behaves exactly as before: one stream, one instance, and
    // the active-run accessor returns that instance's projection.
    #[test]
    fn single_run_stream_projects_through_the_active_accessor() {
        let mut collection = InstanceCollection::new();
        collection.apply_signal(&sig(0, "solo", "agent-0", run_started("solo", "do it")));
        collection.apply_signal(&sig(
            1,
            "solo",
            "agent-0",
            SignalKind::StepsUsedSet { steps_used: 3 },
        ));
        assert_eq!(collection.len(), 1);
        let active = collection.active_run().unwrap();
        assert_eq!(active.id, "solo");
        assert_eq!(active.scratchpad.budgets.steps_used, 3);
    }

    // The terminal reconcile lands on the matching instance and replaces its
    // projection wholesale (filling fields no live signal carried), without
    // touching a sibling instance.
    #[test]
    fn reconcile_run_targets_only_the_matching_instance() {
        let mut collection = InstanceCollection::new();
        collection.apply_signal(&sig(0, "r1", "a", run_started("r1", "one")));
        collection.apply_signal(&sig(0, "r2", "b", run_started("r2", "two")));

        let mut authoritative = run("r1", RunStatus::Complete);
        authoritative.final_answer = "reconciled one".to_string();
        authoritative.messages.push(Message {
            role: "user".to_string(),
            content: "hi".to_string(),
        });
        assert!(collection.reconcile_run(&RunId::from("r1"), authoritative));

        let one = collection.get(&RunId::from("r1")).unwrap();
        assert_eq!(one.projection.final_answer, "reconciled one");
        assert_eq!(one.projection.messages.len(), 1);
        assert_eq!(one.status, RunStatus::Complete);

        // The sibling is untouched — still its own live projection.
        let two = collection.get(&RunId::from("r2")).unwrap();
        assert_eq!(two.projection.goal, "two");
        assert!(two.projection.messages.is_empty());

        // Reconciling an unknown run is a no-op.
        assert!(!collection.reconcile_run(&RunId::from("missing"), run("x", RunStatus::Complete)));
    }
}
