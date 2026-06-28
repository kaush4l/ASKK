//! The in-process [`Signal`] bus and its [`RunProjection`] reducer.
//!
//! The bus is the spine the legible runtime is built on: every component publishes
//! a [`Signal`] delta to one [`Bus`], which keeps an append-only log and fans each
//! delta out to subscribers in registration order. A subscriber folds the stream
//! into whatever view it needs; the canonical reader is [`RunProjection`], which
//! collapses the log into a renderable shape — per-instance lifecycle state plus an
//! ordered event-log timeline — that a UI panel reads directly.
//!
//! Single-threaded by construction. The whole app is `!Send` (it runs on the
//! browser's one thread), so the bus uses [`Rc`]/[`RefCell`] for shared mutable
//! state rather than `Arc`/`Mutex` — matching the rest of the crate. No locks, no
//! atomics, no threads.
//!
//! Ordering is the bus's one invariant: signals on a given `(run_id, instance)`
//! pair carry a monotonically increasing `seq`. [`Bus::publish`] checks that the
//! next `seq` is exactly one past the last it saw for that pair, recording any gap
//! or regression as an [`OrderingAnomaly`] — it never panics or drops the signal.
//! Detection, not enforcement: a dropped delta upstream is a fact the reader should
//! be able to see, not a crash.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use crate::core::event::{InstanceName, Seq, Signal, SignalKind};
use crate::core::lifecycle::ComponentKind;

/// A subscriber callback. `Rc<dyn Fn>` so the same handler can be shared and the
/// bus can hold it without owning the only reference — registration order is
/// preserved by storing them in a `Vec`.
pub type Subscriber = Rc<dyn Fn(&Signal)>;

/// A detected break in per-`(run_id, instance)` `seq` ordering. Recorded rather
/// than thrown: the bus accepts the out-of-order signal but notes that the stream
/// is no longer contiguous, so a reader can surface "deltas were dropped" without
/// the bus deciding the run is broken.
#[derive(Clone, Debug, PartialEq)]
pub struct OrderingAnomaly {
    /// The run whose stream broke contiguity.
    pub run_id: String,
    /// The instance whose stream broke contiguity.
    pub instance: InstanceName,
    /// The last `seq` accepted for this pair before the anomaly.
    pub last_seq: Seq,
    /// The `seq` that arrived out of order (a gap if `> last_seq + 1`, a
    /// regression if `<= last_seq`).
    pub got_seq: Seq,
}

/// The single-threaded signal bus: an append-only log plus a list of subscribers.
///
/// Interior mutability (`RefCell`) so `publish`/`subscribe` take `&self` — the bus
/// is shared by `Rc` clone across components, none of which need `&mut`. Cloning a
/// `Bus` is cheap and shares the same underlying log and subscriber list (it is an
/// `Rc` handle), so every clone observes the same stream.
#[derive(Clone)]
pub struct Bus {
    inner: Rc<BusInner>,
}

/// The bus's shared mutable interior. One allocation behind the `Rc`; every
/// [`Bus`] handle points at this.
struct BusInner {
    /// The append-only, globally ordered signal log.
    log: RefCell<Vec<Signal>>,
    /// Subscribers, in registration order; each receives every published signal.
    subscribers: RefCell<Vec<Subscriber>>,
    /// The last `seq` accepted per `(run_id, instance)` pair, for FIFO checking.
    last_seq: RefCell<HashMap<(String, InstanceName), Seq>>,
    /// Ordering breaks detected so far (gaps / regressions). Append-only.
    anomalies: RefCell<Vec<OrderingAnomaly>>,
}

impl Default for Bus {
    fn default() -> Self {
        Self::new()
    }
}

impl Bus {
    /// A fresh, empty bus with no subscribers and an empty log.
    pub fn new() -> Self {
        Self {
            inner: Rc::new(BusInner {
                log: RefCell::new(Vec::new()),
                subscribers: RefCell::new(Vec::new()),
                last_seq: RefCell::new(HashMap::new()),
                anomalies: RefCell::new(Vec::new()),
            }),
        }
    }

    /// Append `signal` to the log, validate its per-`(run_id, instance)` `seq`
    /// ordering, then fan it out to every subscriber in registration order.
    ///
    /// Ordering is checked but not enforced: a gap (`seq > expected`) or a
    /// regression (`seq <= last`) is recorded as an [`OrderingAnomaly`]; the signal
    /// is still appended and still delivered. The first signal for a pair is
    /// accepted at any `seq` (it establishes the baseline). The subscriber fan-out
    /// happens after the append so a handler that reads `log()` sees the signal it
    /// is being notified about.
    pub fn publish(&self, signal: Signal) {
        // Validate ordering against the last seq seen for this (run, instance).
        let key = (signal.run_id.clone(), signal.instance.clone());
        {
            let mut last_seq = self.inner.last_seq.borrow_mut();
            match last_seq.get(&key).copied() {
                // First signal for this pair: establish the baseline, no check.
                None => {}
                // Contiguous: exactly one past the previous seq. The happy path.
                Some(prev) if signal.seq == prev + 1 => {}
                // Anything else is a gap (skipped a seq) or a regression
                // (out-of-order / duplicate). Record it; still accept the signal.
                Some(prev) => {
                    self.inner.anomalies.borrow_mut().push(OrderingAnomaly {
                        run_id: signal.run_id.clone(),
                        instance: signal.instance.clone(),
                        last_seq: prev,
                        got_seq: signal.seq,
                    });
                }
            }
            // Track the highest seq seen so a late duplicate doesn't rewind the
            // baseline and mask a subsequent real gap.
            let entry = last_seq.entry(key).or_insert(signal.seq);
            if signal.seq > *entry {
                *entry = signal.seq;
            }
        }

        // Append before fan-out so a subscriber reading `log()` sees this signal.
        self.inner.log.borrow_mut().push(signal.clone());

        // Clone the subscriber handles out of the borrow first: a handler may
        // itself call back into the bus (e.g. `log()`), and holding the
        // `subscribers` borrow across the callbacks would risk a borrow conflict.
        let subscribers = self.inner.subscribers.borrow().clone();
        for handler in &subscribers {
            handler(&signal);
        }
    }

    /// Register a subscriber. It receives every signal published *after* this call,
    /// in publish order; subscribers are invoked in registration order. To replay
    /// history, read [`Bus::log`] first, then subscribe.
    pub fn subscribe(&self, handler: Subscriber) {
        self.inner.subscribers.borrow_mut().push(handler);
    }

    /// A snapshot copy of the full, ordered log. Cloned out of the `RefCell` so the
    /// caller holds no borrow on the bus (which would block further `publish`).
    pub fn log(&self) -> Vec<Signal> {
        self.inner.log.borrow().clone()
    }

    /// How many signals have been published. O(1); avoids cloning the whole log
    /// just to count it.
    pub fn len(&self) -> usize {
        self.inner.log.borrow().len()
    }

    /// Whether the log is empty.
    pub fn is_empty(&self) -> bool {
        self.inner.log.borrow().is_empty()
    }

    /// A snapshot copy of every ordering anomaly detected so far. Empty when the
    /// stream has stayed contiguous on every `(run_id, instance)` pair.
    pub fn anomalies(&self) -> Vec<OrderingAnomaly> {
        self.inner.anomalies.borrow().clone()
    }
}

/// One row of [`RunProjection::timeline`] — the shape an event-log panel renders.
/// A flat, display-ready record: the emitting `instance`, a one-line `summary` of
/// the [`SignalKind`], and the `ts_ms`/`seq` the signal carried. Holds no
/// references, so the projection can be cloned into UI state freely.
#[derive(Clone, Debug, PartialEq)]
pub struct TimelineEntry {
    /// The component instance that emitted the signal.
    pub instance: InstanceName,
    /// A short human-readable label for the signal's kind.
    pub summary: String,
    /// The emitter's millisecond timestamp, carried verbatim from the signal.
    pub ts_ms: f64,
    /// The signal's per-run sequence number.
    pub seq: Seq,
}

/// The current lifecycle state of one component instance, folded from its
/// [`SignalKind::Lifecycle`] signals. `kind` is the [`ComponentKind`] the latest
/// transition named; `state` is its `to` label (the snake_case lifecycle variant).
#[derive(Clone, Debug, PartialEq)]
pub struct LifecycleState {
    /// Which kind of component this instance is (tool / agent / worker / phase).
    pub kind: ComponentKind,
    /// The latest lifecycle state the instance transitioned *to*.
    pub state: String,
}

/// A renderable fold of the signal log: per-instance lifecycle plus an ordered
/// timeline. This is what UI panels read — pure data, no DOM, no clock.
///
/// `lifecycle` answers "what state is each component in right now?" (the latest
/// `to` from each instance's lifecycle signals). `timeline` answers "what
/// happened, in order?" (one [`TimelineEntry`] per signal, in publish order). Fold
/// incrementally with [`RunProjection::apply`] as signals arrive, or batch the
/// whole log with [`RunProjection::from_log`].
#[derive(Clone, Debug, Default, PartialEq)]
pub struct RunProjection {
    /// The current lifecycle state of every instance that has emitted a
    /// [`SignalKind::Lifecycle`] signal, keyed by its address.
    pub lifecycle: HashMap<InstanceName, LifecycleState>,
    /// Every signal seen, in the order it was applied — the event-log panel feed.
    pub timeline: Vec<TimelineEntry>,
}

impl RunProjection {
    /// An empty projection — no instances tracked, no timeline rows.
    pub fn new() -> Self {
        Self::default()
    }

    /// Fold one signal into the projection: append a timeline row and, for a
    /// [`SignalKind::Lifecycle`] signal, update the emitting instance's current
    /// state to the transition's `to`. Idempotent only in the trivial sense — each
    /// call appends a row, so feed each signal exactly once.
    pub fn apply(&mut self, signal: &Signal) {
        if let SignalKind::Lifecycle { component, to, .. } = &signal.kind {
            self.lifecycle.insert(
                signal.instance.clone(),
                LifecycleState {
                    kind: *component,
                    state: to.clone(),
                },
            );
        }

        self.timeline.push(TimelineEntry {
            instance: signal.instance.clone(),
            summary: summarize(&signal.kind),
            ts_ms: signal.ts_ms,
            seq: signal.seq,
        });
    }

    /// Batch-fold a whole slice of signals (e.g. the bus log) into a fresh
    /// projection, in slice order. Equivalent to `apply`-ing each in turn.
    pub fn from_log(signals: &[Signal]) -> Self {
        let mut projection = Self::new();
        for signal in signals {
            projection.apply(signal);
        }
        projection
    }

    /// The current lifecycle state of one instance, if it has emitted any
    /// lifecycle signal.
    pub fn lifecycle_of(&self, instance: &InstanceName) -> Option<&LifecycleState> {
        self.lifecycle.get(instance)
    }
}

/// A short, stable, human-readable label for a [`SignalKind`] — the `summary`
/// column of a [`TimelineEntry`]. Deliberately terse: the rich detail lives on the
/// legacy event; the timeline is a scannable index, not the full record.
fn summarize(kind: &SignalKind) -> String {
    match kind {
        SignalKind::Lifecycle {
            component,
            from,
            to,
        } => format!("{}: {} -> {}", component_label(*component), from, to),
        SignalKind::RunStarted { lane, .. } => format!("run started: {}", lane.as_label()),
        SignalKind::LlmRequest => "llm request".to_string(),
        SignalKind::LlmDelta { .. } => "llm delta".to_string(),
        SignalKind::LlmResponse { .. } => "llm response".to_string(),
        SignalKind::ToolRequested { name, .. } => format!("tool requested: {name}"),
        SignalKind::ToolCompleted { ok, .. } if *ok => "tool completed".to_string(),
        SignalKind::ToolCompleted { .. } => "tool failed".to_string(),
        SignalKind::ObservationAppended { .. } => "observation".to_string(),
        SignalKind::ArtifactAppended { artifact } => format!("artifact: {}", artifact.name),
        SignalKind::WorkspaceChanged { view } => {
            format!("workspace: {} open file(s)", view.open_files.len())
        }
        SignalKind::StatusSet { status } => format!("status: {}", status.as_str()),
        SignalKind::StepsUsedSet { steps_used } => format!("steps used: {steps_used}"),
        SignalKind::Phase { name, done } if *done => format!("phase done: {name}"),
        SignalKind::Phase { name, .. } => format!("phase: {name}"),
        SignalKind::Memory => "memory".to_string(),
        SignalKind::Verification { passed } if *passed => "verification passed".to_string(),
        SignalKind::Verification { .. } => "verification failed".to_string(),
        SignalKind::Result { .. } => "result".to_string(),
        SignalKind::Error { .. } => "error".to_string(),
        SignalKind::Interrupted => "interrupted".to_string(),
    }
}

/// The snake_case-ish display label for a [`ComponentKind`], used in timeline
/// summaries.
fn component_label(kind: ComponentKind) -> &'static str {
    match kind {
        ComponentKind::Tool => "tool",
        ComponentKind::Agent => "agent",
        ComponentKind::Worker => "worker",
        ComponentKind::Phase => "phase",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn lifecycle_signal(
        seq: Seq,
        run: &str,
        instance: &str,
        component: ComponentKind,
        from: &str,
        to: &str,
    ) -> Signal {
        Signal::new(
            seq,
            run,
            instance,
            SignalKind::Lifecycle {
                component,
                from: from.to_string(),
                to: to.to_string(),
            },
            seq as f64,
        )
    }

    // --- Bus: publish / subscribe -------------------------------------------

    #[test]
    fn publish_delivers_to_a_registered_subscriber() {
        let bus = Bus::new();
        let received: Rc<RefCell<Vec<Signal>>> = Rc::new(RefCell::new(Vec::new()));
        let sink = received.clone();
        bus.subscribe(Rc::new(move |signal: &Signal| {
            sink.borrow_mut().push(signal.clone());
        }));

        let signal = Signal::new(0, "run-1", "agent-0", SignalKind::LlmRequest, 1.0);
        bus.publish(signal.clone());

        let got = received.borrow();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0], signal);
        // The same signal is also in the append-only log.
        assert_eq!(bus.log(), vec![signal]);
    }

    #[test]
    fn subscribers_fire_in_registration_order() {
        let bus = Bus::new();
        let order: Rc<RefCell<Vec<u8>>> = Rc::new(RefCell::new(Vec::new()));
        let (a, b) = (order.clone(), order.clone());
        bus.subscribe(Rc::new(move |_| a.borrow_mut().push(1)));
        bus.subscribe(Rc::new(move |_| b.borrow_mut().push(2)));

        bus.publish(Signal::new(
            0,
            "run-1",
            "agent-0",
            SignalKind::LlmRequest,
            0.0,
        ));

        assert_eq!(*order.borrow(), vec![1, 2]);
    }

    #[test]
    fn subscriber_added_after_a_publish_misses_the_earlier_signal() {
        let bus = Bus::new();
        bus.publish(Signal::new(
            0,
            "run-1",
            "agent-0",
            SignalKind::LlmRequest,
            0.0,
        ));

        let count = Rc::new(Cell::new(0u32));
        let sink = count.clone();
        bus.subscribe(Rc::new(move |_| sink.set(sink.get() + 1)));
        // The pre-subscription signal is not replayed.
        assert_eq!(count.get(), 0);

        bus.publish(Signal::new(
            1,
            "run-1",
            "agent-0",
            SignalKind::LlmResponse {
                text: String::new(),
            },
            1.0,
        ));
        assert_eq!(count.get(), 1);
        // But the full log still has both signals for late readers.
        assert_eq!(bus.len(), 2);
    }

    // --- Bus: per-(run, instance) FIFO ordering -----------------------------

    #[test]
    fn in_order_seqs_per_pair_record_no_anomaly() {
        let bus = Bus::new();
        // Two independent instances, each contiguous; they do NOT share a seq
        // space, so interleaving them is fine.
        bus.publish(Signal::new(
            0,
            "run-1",
            "agent-0",
            SignalKind::LlmRequest,
            0.0,
        ));
        bus.publish(Signal::new(
            0,
            "run-1",
            "worker-1",
            SignalKind::LlmRequest,
            0.0,
        ));
        bus.publish(Signal::new(
            1,
            "run-1",
            "agent-0",
            SignalKind::LlmResponse {
                text: String::new(),
            },
            1.0,
        ));
        bus.publish(Signal::new(
            1,
            "run-1",
            "worker-1",
            SignalKind::LlmResponse {
                text: String::new(),
            },
            1.0,
        ));

        assert!(
            bus.anomalies().is_empty(),
            "contiguous per-pair seqs must not trip the ordering check"
        );
    }

    #[test]
    fn a_seq_gap_is_detected_and_recorded() {
        let bus = Bus::new();
        bus.publish(Signal::new(
            0,
            "run-1",
            "agent-0",
            SignalKind::LlmRequest,
            0.0,
        ));
        // seq 1 is skipped: jump straight to 2 -> a gap.
        bus.publish(Signal::new(
            2,
            "run-1",
            "agent-0",
            SignalKind::LlmResponse {
                text: String::new(),
            },
            2.0,
        ));

        let anomalies = bus.anomalies();
        assert_eq!(anomalies.len(), 1);
        assert_eq!(anomalies[0].last_seq, 0);
        assert_eq!(anomalies[0].got_seq, 2);
        assert_eq!(anomalies[0].instance, InstanceName("agent-0".to_string()));
        // The signal is still accepted despite the gap.
        assert_eq!(bus.len(), 2);
    }

    #[test]
    fn a_seq_regression_is_detected_and_recorded() {
        let bus = Bus::new();
        bus.publish(Signal::new(
            0,
            "run-1",
            "agent-0",
            SignalKind::LlmRequest,
            0.0,
        ));
        bus.publish(Signal::new(
            1,
            "run-1",
            "agent-0",
            SignalKind::LlmResponse {
                text: String::new(),
            },
            1.0,
        ));
        // seq 1 again (a duplicate / out-of-order replay) -> a regression.
        bus.publish(Signal::new(
            1,
            "run-1",
            "agent-0",
            SignalKind::LlmResponse {
                text: String::new(),
            },
            1.0,
        ));

        let anomalies = bus.anomalies();
        assert_eq!(anomalies.len(), 1);
        assert_eq!(anomalies[0].last_seq, 1);
        assert_eq!(anomalies[0].got_seq, 1);
    }

    // --- RunProjection -------------------------------------------------------

    #[test]
    fn projection_folds_lifecycle_states_and_timeline() {
        // A crafted stream: an agent turn (idle->rendering->awaiting_model), a
        // tool call (requested then completed), and a final result.
        let signals = vec![
            lifecycle_signal(
                0,
                "run-1",
                "agent-0",
                ComponentKind::Agent,
                "idle",
                "rendering",
            ),
            lifecycle_signal(
                1,
                "run-1",
                "agent-0",
                ComponentKind::Agent,
                "rendering",
                "awaiting_model",
            ),
            Signal::new(
                0,
                "run-1",
                "tool:web_search",
                SignalKind::ToolRequested {
                    call_id: "c1".to_string(),
                    name: "web_search".to_string(),
                    arguments: serde_json::Value::Null,
                },
                2.0,
            ),
            Signal::new(
                1,
                "run-1",
                "tool:web_search",
                SignalKind::ToolCompleted {
                    call_id: "c1".to_string(),
                    ok: true,
                    content: "results...".to_string(),
                },
                3.0,
            ),
            Signal::new(
                2,
                "run-1",
                "agent-0",
                SignalKind::Result {
                    final_text: "the answer".to_string(),
                },
                4.0,
            ),
        ];

        let projection = RunProjection::from_log(&signals);

        // Timeline holds one row per signal, in order, carrying seq + ts.
        assert_eq!(projection.timeline.len(), 5);
        assert_eq!(projection.timeline[0].seq, 0);
        assert_eq!(projection.timeline[0].ts_ms, 0.0);
        assert_eq!(
            projection.timeline[0].instance,
            InstanceName("agent-0".to_string())
        );
        assert_eq!(projection.timeline.last().unwrap().summary, "result");

        // The agent's latest lifecycle state is the LAST transition's `to`.
        let agent = projection
            .lifecycle_of(&InstanceName("agent-0".to_string()))
            .expect("agent lifecycle tracked");
        assert_eq!(agent.kind, ComponentKind::Agent);
        assert_eq!(agent.state, "awaiting_model");

        // The tool emitted no Lifecycle signals, so it has no lifecycle entry —
        // only timeline rows. Two instances total transitioned.
        assert!(
            projection
                .lifecycle_of(&InstanceName("tool:web_search".to_string()))
                .is_none()
        );
        assert_eq!(projection.lifecycle.len(), 1);
    }

    #[test]
    fn projection_apply_matches_from_log() {
        let signals = vec![
            lifecycle_signal(0, "r", "w", ComponentKind::Worker, "spawned", "ready"),
            lifecycle_signal(1, "r", "w", ComponentKind::Worker, "ready", "busy"),
        ];
        let batch = RunProjection::from_log(&signals);

        let mut incremental = RunProjection::new();
        for signal in &signals {
            incremental.apply(signal);
        }

        assert_eq!(batch, incremental);
        // Latest worker state is `busy`, not the earlier `ready`.
        assert_eq!(
            incremental
                .lifecycle_of(&InstanceName("w".to_string()))
                .unwrap()
                .state,
            "busy"
        );
    }

    #[test]
    fn bus_log_feeds_projection_end_to_end() {
        // Wire the projection as a live subscriber AND confirm batch-from-log
        // agrees, so the two paths can't drift.
        let bus = Bus::new();
        let projection: Rc<RefCell<RunProjection>> = Rc::new(RefCell::new(RunProjection::new()));
        let sink = projection.clone();
        bus.subscribe(Rc::new(move |signal: &Signal| {
            sink.borrow_mut().apply(signal);
        }));

        bus.publish(lifecycle_signal(
            0,
            "run-1",
            "agent-0",
            ComponentKind::Agent,
            "idle",
            "rendering",
        ));
        bus.publish(Signal::new(
            1,
            "run-1",
            "agent-0",
            SignalKind::Result {
                final_text: "done".to_string(),
            },
            1.0,
        ));

        let live = projection.borrow().clone();
        let batch = RunProjection::from_log(&bus.log());
        assert_eq!(live, batch);
        assert_eq!(live.timeline.len(), 2);
    }
}
