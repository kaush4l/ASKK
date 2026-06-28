//! The **FleetView model + coalescer** — the render-only projection of the
//! telemetry plane.
//!
//! Where [`crate::core::telemetry`] defines the *wire vocabulary*
//! ([`TelemetrySignal`], [`AgentActivity`], [`ThreadKind`]), this module owns the
//! *fold*: a batch of telemetry deltas is coalesced (per-thread, last-wins) into a
//! [`FleetView`] — the flat-but-tree-aware snapshot the main thread repaints
//! rAF-gated. It is the deliberate counterpart to the durable state projection
//! ([`crate::runtime::RunProjection`]): telemetry is ephemeral, lossy-OK, and never
//! persisted, so the view is rebuilt from the stream and dropped on reload.
//!
//! Pure value types only — no clock, no web APIs — so the whole thing compiles and
//! unit-tests on the host. The live feed (worker → watcher coalesce → main `apply`)
//! wires onto this at a later core step; for now the coalescer is the
//! self-contained, host-tested heart.
//!
//! ## Coalescing contract
//!
//! Folding is **monotone and idempotent-per-key**: every signal addresses exactly
//! one thread ([`TelemetrySignal::id`]), and the fold touches only that node:
//!
//! - [`Spawned`](TelemetrySignal::Spawned) — inserts (or, on a re-`Spawned` id,
//!   refreshes) a node from `kind` / `parent` / `label`, resurrecting it `alive`.
//! - [`StatusChanged`](TelemetrySignal::StatusChanged) — overwrites `activity`
//!   (last-wins; an intermediate badge dropped before flush is harmless).
//! - [`Progress`](TelemetrySignal::Progress) — overwrites the `tokens` / `elapsed_ms`
//!   counters (last-wins; counters are cumulative at source).
//! - [`Terminated`](TelemetrySignal::Terminated) — marks the node `alive = false`
//!   and records `reason`. **The node is kept, not removed**: a freshly-dead thread
//!   should linger in the fleet UI for a beat (so a flash-completing agent is still
//!   legible) and a caller that wants it gone can [`FleetView::reap`] terminated
//!   nodes on its own cadence.
//!
//! A `StatusChanged` / `Progress` for an id that was never `Spawned` is dropped (no
//! ghost nodes): the telemetry plane is lossy, so a missing spawn is treated as the
//! thread simply not existing yet rather than fabricated from a status delta.

use std::collections::HashMap;

use crate::core::telemetry::{AgentActivity, TelemetrySignal, ThreadKind};

/// One live (or freshly-dead) thread in the fleet — an engine, the watcher, the
/// tool-host, or an MCP host. Built and kept current entirely by the coalescer; the
/// UI reads it and never mutates it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FleetNode {
    /// Thread id — the coalescer's grouping key and the tree edge target.
    pub id: String,
    /// Which lane/icon this node belongs to.
    pub kind: ThreadKind,
    /// Parent thread id, if this node was spawned under another (engine sub-agents,
    /// hosts under the watcher). `None` is a fleet root.
    pub parent: Option<String>,
    /// Human label for the node (agent name, server name, …).
    pub label: String,
    /// Current activity badge — last-wins from `StatusChanged`. Starts `Idle`.
    pub activity: AgentActivity,
    /// Cumulative token counter — last-wins from `Progress`.
    pub tokens: u32,
    /// Cumulative elapsed milliseconds — last-wins from `Progress`.
    pub elapsed_ms: u64,
    /// `false` once a `Terminated` has been folded; the node lingers until reaped.
    pub alive: bool,
    /// Short human reason captured at termination (empty while alive).
    pub terminated_reason: String,
}

impl FleetNode {
    /// A just-spawned node: `Idle`, zeroed counters, alive.
    fn spawn(id: String, kind: ThreadKind, parent: Option<String>, label: String) -> Self {
        FleetNode {
            id,
            kind,
            parent,
            label,
            activity: AgentActivity::Idle,
            tokens: 0,
            elapsed_ms: 0,
            alive: true,
            terminated_reason: String::new(),
        }
    }
}

/// The coalesced, render-only snapshot of every known thread.
///
/// Insertion order is preserved (so the UI lane order is stable across repaints
/// regardless of which thread happens to tick) while lookups stay O(1) via a side
/// index. The view exposes both a flat ordered list ([`nodes`](FleetView::nodes))
/// and a parent→children adjacency for tree rendering
/// ([`roots`](FleetView::roots) / [`children_of`](FleetView::children_of)).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FleetView {
    /// Nodes in stable insertion order — the render order.
    order: Vec<FleetNode>,
    /// id → index into `order`, kept in lockstep with it.
    index: HashMap<String, usize>,
}

impl FleetView {
    /// An empty fleet.
    pub fn new() -> Self {
        FleetView::default()
    }

    /// Every node in stable insertion (render) order, alive or freshly-dead.
    pub fn nodes(&self) -> &[FleetNode] {
        &self.order
    }

    /// Total node count (alive + lingering-dead).
    pub fn len(&self) -> usize {
        self.order.len()
    }

    /// Whether the fleet has no nodes at all.
    pub fn is_empty(&self) -> bool {
        self.order.is_empty()
    }

    /// Count of nodes still `alive` — the headline "N running" number.
    pub fn live_count(&self) -> usize {
        self.order.iter().filter(|node| node.alive).count()
    }

    /// Borrow a node by id, if present.
    pub fn get(&self, id: &str) -> Option<&FleetNode> {
        self.index.get(id).map(|&i| &self.order[i])
    }

    /// The fleet roots — nodes whose `parent` is `None` *or* points at an id not in
    /// the view (a dangling parent is treated as a root so the node never vanishes).
    pub fn roots(&self) -> impl Iterator<Item = &FleetNode> {
        self.order.iter().filter(move |node| match &node.parent {
            None => true,
            Some(parent_id) => !self.index.contains_key(parent_id),
        })
    }

    /// The direct children of `parent_id`, in insertion order.
    pub fn children_of<'a>(&'a self, parent_id: &'a str) -> impl Iterator<Item = &'a FleetNode> {
        self.order
            .iter()
            .filter(move |node| node.parent.as_deref() == Some(parent_id))
    }

    /// Drop every terminated node from the view, in one pass. Callers reap on their
    /// own cadence (e.g. a few hundred ms after a flush) so freshly-dead threads
    /// stay legible first. Rebuilds the side index to stay in lockstep with `order`.
    pub fn reap(&mut self) {
        self.order.retain(|node| node.alive);
        self.reindex();
    }

    /// Rebuild `index` from `order` after a structural change (a removal).
    fn reindex(&mut self) {
        self.index.clear();
        for (i, node) in self.order.iter().enumerate() {
            self.index.insert(node.id.clone(), i);
        }
    }

    /// Fold a single telemetry delta into the view (per-thread, last-wins). See the
    /// module-level coalescing contract for the per-variant rules.
    pub fn apply(&mut self, signal: TelemetrySignal) {
        match signal {
            TelemetrySignal::Spawned {
                id,
                kind,
                parent,
                label,
            } => {
                if let Some(&i) = self.index.get(&id) {
                    // Re-spawn of a known id: refresh identity + resurrect. Counters
                    // and activity reset so a reused id reads as a fresh thread.
                    let node = &mut self.order[i];
                    node.kind = kind;
                    node.parent = parent;
                    node.label = label;
                    node.activity = AgentActivity::Idle;
                    node.tokens = 0;
                    node.elapsed_ms = 0;
                    node.alive = true;
                    node.terminated_reason = String::new();
                } else {
                    self.index.insert(id.clone(), self.order.len());
                    self.order.push(FleetNode::spawn(id, kind, parent, label));
                }
            }
            TelemetrySignal::StatusChanged { id, activity } => {
                if let Some(&i) = self.index.get(&id) {
                    self.order[i].activity = activity;
                }
                // else: status for an unspawned id — dropped (no ghost nodes).
            }
            TelemetrySignal::Progress {
                id,
                tokens,
                elapsed_ms,
            } => {
                if let Some(&i) = self.index.get(&id) {
                    let node = &mut self.order[i];
                    node.tokens = tokens;
                    node.elapsed_ms = elapsed_ms;
                }
                // else: progress for an unspawned id — dropped.
            }
            TelemetrySignal::Terminated { id, reason } => {
                if let Some(&i) = self.index.get(&id) {
                    let node = &mut self.order[i];
                    node.alive = false;
                    node.terminated_reason = reason;
                }
                // else: termination of an unknown id — nothing to mark.
            }
        }
    }

    /// Fold a whole batch in order — the watcher's `flush` shape. Equivalent to
    /// calling [`apply`](FleetView::apply) per signal; provided so the call site
    /// reads as "apply this coalesced batch".
    pub fn apply_batch<I>(&mut self, batch: I)
    where
        I: IntoIterator<Item = TelemetrySignal>,
    {
        for signal in batch {
            self.apply(signal);
        }
    }

    /// Build a fresh view by folding a batch from empty — the rebuild-from-stream
    /// path (telemetry is never persisted, so this is how a view comes to exist).
    pub fn from_batch<I>(batch: I) -> Self
    where
        I: IntoIterator<Item = TelemetrySignal>,
    {
        let mut view = FleetView::new();
        view.apply_batch(batch);
        view
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spawn(id: &str, kind: ThreadKind, parent: Option<&str>, label: &str) -> TelemetrySignal {
        TelemetrySignal::Spawned {
            id: id.into(),
            kind,
            parent: parent.map(Into::into),
            label: label.into(),
        }
    }

    #[test]
    fn ordered_stream_rebuilds_expected_view() {
        // A small ordered stream: spawn a watcher root, an engine under it, a
        // sub-agent under the engine, then status, progress, and a terminate.
        let stream = vec![
            spawn("watcher", ThreadKind::Watcher, None, "supervisor"),
            spawn("engine-1", ThreadKind::Engine, Some("watcher"), "planner"),
            spawn(
                "engine-2",
                ThreadKind::Engine,
                Some("engine-1"),
                "researcher",
            ),
            TelemetrySignal::StatusChanged {
                id: "engine-1".into(),
                activity: AgentActivity::AwaitingChild {
                    child_id: "engine-2".into(),
                },
            },
            TelemetrySignal::StatusChanged {
                id: "engine-2".into(),
                activity: AgentActivity::WaitingLlm,
            },
            // last-wins: this overwrites WaitingLlm.
            TelemetrySignal::StatusChanged {
                id: "engine-2".into(),
                activity: AgentActivity::CallingTool {
                    name: "web_search".into(),
                },
            },
            TelemetrySignal::Progress {
                id: "engine-2".into(),
                tokens: 100,
                elapsed_ms: 1_000,
            },
            // last-wins: counters are cumulative, so this replaces the earlier pair.
            TelemetrySignal::Progress {
                id: "engine-2".into(),
                tokens: 256,
                elapsed_ms: 2_500,
            },
            TelemetrySignal::Terminated {
                id: "engine-2".into(),
                reason: "done".into(),
            },
        ];

        let view = FleetView::from_batch(stream);

        // Three nodes, insertion order preserved.
        assert_eq!(view.len(), 3);
        assert_eq!(
            view.nodes()
                .iter()
                .map(|n| n.id.as_str())
                .collect::<Vec<_>>(),
            vec!["watcher", "engine-1", "engine-2"],
        );

        // One terminated → two still alive.
        assert_eq!(view.live_count(), 2);

        // Status is last-wins.
        let e1 = view.get("engine-1").unwrap();
        assert_eq!(
            e1.activity,
            AgentActivity::AwaitingChild {
                child_id: "engine-2".into()
            }
        );
        let e2 = view.get("engine-2").unwrap();
        assert_eq!(
            e2.activity,
            AgentActivity::CallingTool {
                name: "web_search".into()
            }
        );

        // Counters are last-wins.
        assert_eq!(e2.tokens, 256);
        assert_eq!(e2.elapsed_ms, 2_500);

        // Terminated marks (not removes) the node and records the reason.
        assert!(!e2.alive);
        assert_eq!(e2.terminated_reason, "done");
        assert!(view.get("engine-2").is_some());
    }

    #[test]
    fn tree_views_thread_parent_and_children() {
        let view = FleetView::from_batch(vec![
            spawn("watcher", ThreadKind::Watcher, None, "supervisor"),
            spawn("engine-1", ThreadKind::Engine, Some("watcher"), "planner"),
            spawn(
                "engine-2",
                ThreadKind::Engine,
                Some("engine-1"),
                "researcher",
            ),
            spawn(
                "mcp-fs",
                ThreadKind::McpProcess,
                Some("watcher"),
                "filesystem",
            ),
        ]);

        // Only the watcher is a root.
        let roots: Vec<_> = view.roots().map(|n| n.id.as_str()).collect();
        assert_eq!(roots, vec!["watcher"]);

        // The watcher's direct children are the planner engine and the MCP host.
        let kids: Vec<_> = view.children_of("watcher").map(|n| n.id.as_str()).collect();
        assert_eq!(kids, vec!["engine-1", "mcp-fs"]);

        // The planner's only child is the researcher sub-agent.
        let grandkids: Vec<_> = view
            .children_of("engine-1")
            .map(|n| n.id.as_str())
            .collect();
        assert_eq!(grandkids, vec!["engine-2"]);
    }

    #[test]
    fn status_and_progress_for_unspawned_id_are_dropped() {
        let mut view = FleetView::new();
        view.apply(TelemetrySignal::StatusChanged {
            id: "ghost".into(),
            activity: AgentActivity::Thinking,
        });
        view.apply(TelemetrySignal::Progress {
            id: "ghost".into(),
            tokens: 10,
            elapsed_ms: 10,
        });
        view.apply(TelemetrySignal::Terminated {
            id: "ghost".into(),
            reason: "never lived".into(),
        });
        // No ghost node fabricated from deltas alone.
        assert!(view.is_empty());
        assert!(view.get("ghost").is_none());
    }

    #[test]
    fn respawn_resurrects_and_resets_a_terminated_id() {
        let mut view = FleetView::from_batch(vec![
            spawn("engine-1", ThreadKind::Engine, None, "first"),
            TelemetrySignal::Progress {
                id: "engine-1".into(),
                tokens: 999,
                elapsed_ms: 9_999,
            },
            TelemetrySignal::Terminated {
                id: "engine-1".into(),
                reason: "done".into(),
            },
        ]);
        assert_eq!(view.live_count(), 0);

        // Re-spawn under the same id: identity refreshed, counters/activity reset.
        view.apply(spawn("engine-1", ThreadKind::Engine, None, "second"));
        let node = view.get("engine-1").unwrap();
        assert!(node.alive);
        assert_eq!(node.label, "second");
        assert_eq!(node.tokens, 0);
        assert_eq!(node.elapsed_ms, 0);
        assert_eq!(node.activity, AgentActivity::Idle);
        assert!(node.terminated_reason.is_empty());
        // Still one node — re-spawn updates in place, no duplicate.
        assert_eq!(view.len(), 1);
        assert_eq!(view.live_count(), 1);
    }

    #[test]
    fn reap_drops_terminated_and_keeps_index_consistent() {
        let mut view = FleetView::from_batch(vec![
            spawn("a", ThreadKind::Engine, None, "a"),
            spawn("b", ThreadKind::Engine, None, "b"),
            spawn("c", ThreadKind::Engine, None, "c"),
            TelemetrySignal::Terminated {
                id: "b".into(),
                reason: "done".into(),
            },
        ]);
        assert_eq!(view.len(), 3);

        view.reap();
        assert_eq!(view.len(), 2);
        assert!(view.get("b").is_none());

        // Index is rebuilt: a status delta after reap still lands on the right node.
        view.apply(TelemetrySignal::StatusChanged {
            id: "c".into(),
            activity: AgentActivity::Thinking,
        });
        assert_eq!(view.get("c").unwrap().activity, AgentActivity::Thinking);
        assert_eq!(
            view.nodes()
                .iter()
                .map(|n| n.id.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "c"],
        );
    }
}
