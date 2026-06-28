//! The watcher's pure logic — the supervisor "brain" that the central hub runs:
//! the worker [`WorkerRegistry`], the [`HostTable`] (generalizing the MCP runtime's
//! bookkeeping), frame [`route`]ing, and in-flight call/deadline tracking
//! ([`PendingCalls`]).
//!
//! This is deliberately split from the wasm wiring. Spawning a real `web_sys::Worker`,
//! posting [`HubFrame`](super::hub_frame::HubFrame)s, brokering `MessageChannel` ports,
//! and resolving `oneshot` waiters all live in the browser-only watcher runtime; *what*
//! to spawn, *where* to route, *which* host serves a tool, and *when* a call has timed
//! out are decisions made here, with no web APIs and no clock (callers pass timestamps
//! in). So the supervisor's correctness is host-tested in full before any of it touches
//! a worker.
//!
//! Not wired into a caller yet (the in-browser cutover wires it), so dead_code is
//! allowed crate-wide here until then.

#![allow(dead_code)]

use crate::core::contract::HostAddr;
use crate::core::lifecycle::{McpLifecycle, WorkerLifecycle};

use super::hub_frame::Endpoint;

// ===========================================================================
// Worker registry — one engine worker per agent, FRESH per spawn (no reuse).
// ===========================================================================

/// One tracked engine worker. The watcher owns this row from spawn to terminate;
/// because the model is fresh-per-agent, [`WorkerRegistry::terminate`] removes the
/// row entirely rather than returning it to a pool.
#[derive(Clone, Debug, PartialEq)]
pub struct WorkerEntry {
    pub id: String,
    pub run_id: String,
    /// Parent worker id, for the fleet tree (root agent has `None`).
    pub parent: Option<String>,
    pub status: WorkerLifecycle,
    /// Emitter-supplied spawn stamp (epoch ms); the registry reads no clock.
    pub spawned_at_ms: f64,
}

/// The supervisor's table of live engine workers. Insertion-ordered; cap is a knob
/// (`None` = unbounded, the prototype default — "spawn as many as needed").
#[derive(Debug, Default)]
pub struct WorkerRegistry {
    workers: Vec<WorkerEntry>,
    max_workers: Option<usize>,
}

impl WorkerRegistry {
    pub fn new(max_workers: Option<usize>) -> Self {
        Self {
            workers: Vec::new(),
            max_workers,
        }
    }

    /// Count of non-terminated workers (terminated rows are removed, so this is just
    /// the row count — kept as a named concept for the cap check and the fleet badge).
    pub fn live_count(&self) -> usize {
        self.workers.len()
    }

    /// Whether another worker may be spawned under the cap. Always true when
    /// `max_workers` is `None`.
    pub fn can_spawn(&self) -> bool {
        match self.max_workers {
            Some(cap) => self.workers.len() < cap,
            None => true,
        }
    }

    /// Register a freshly spawned worker as [`WorkerLifecycle::Spawned`]. Errors if the
    /// cap is reached (backpressure) or the id is already registered.
    pub fn register(
        &mut self,
        id: impl Into<String>,
        run_id: impl Into<String>,
        parent: Option<String>,
        spawned_at_ms: f64,
    ) -> Result<(), String> {
        let id = id.into();
        if self.workers.iter().any(|w| w.id == id) {
            return Err(format!("worker `{id}` already registered"));
        }
        if !self.can_spawn() {
            return Err(format!(
                "worker cap reached ({}/{:?})",
                self.workers.len(),
                self.max_workers
            ));
        }
        self.workers.push(WorkerEntry {
            id,
            run_id: run_id.into(),
            parent,
            status: WorkerLifecycle::Spawned,
            spawned_at_ms,
        });
        Ok(())
    }

    /// Advance a worker's lifecycle, enforcing the legal-transition predicate. Errors
    /// on an unknown id or an illegal edge.
    pub fn transition(&mut self, id: &str, to: WorkerLifecycle) -> Result<(), String> {
        let entry = self
            .workers
            .iter_mut()
            .find(|w| w.id == id)
            .ok_or_else(|| format!("unknown worker `{id}`"))?;
        if !entry.status.can_transition(to) {
            return Err(format!(
                "illegal worker transition {:?} -> {:?} for `{id}`",
                entry.status, to
            ));
        }
        entry.status = to;
        Ok(())
    }

    /// Reap a worker (fresh-per-agent: the row is dropped, not pooled). Returns the
    /// removed entry if it existed.
    pub fn terminate(&mut self, id: &str) -> Option<WorkerEntry> {
        let index = self.workers.iter().position(|w| w.id == id)?;
        Some(self.workers.remove(index))
    }

    pub fn get(&self, id: &str) -> Option<&WorkerEntry> {
        self.workers.iter().find(|w| w.id == id)
    }

    /// Every live worker belonging to a run — used to cancel a run's whole subtree.
    pub fn workers_for_run(&self, run_id: &str) -> Vec<&WorkerEntry> {
        self.workers.iter().filter(|w| w.run_id == run_id).collect()
    }
}

// ===========================================================================
// Host table — external MCP servers + tool hosts, with fingerprint reuse and
// evict-on-fault (the generalization of today's MCP_RUNTIME).
// ===========================================================================

/// One tracked tool/MCP host. `fingerprint` is the config hash used to reuse an
/// existing connection instead of re-spawning; `tools` is its advertised tool set
/// once [`McpLifecycle::Ready`].
#[derive(Clone, Debug, PartialEq)]
pub struct HostEntry {
    pub addr: HostAddr,
    pub fingerprint: String,
    pub status: McpLifecycle,
    pub tools: Vec<String>,
}

/// The watcher's table of tool/MCP hosts. A fault evicts only the offending host (and
/// its tools); siblings are untouched — the "shared host, per-server connection"
/// isolation choice.
#[derive(Debug, Default)]
pub struct HostTable {
    hosts: Vec<HostEntry>,
}

impl HostTable {
    /// Reuse an existing host with the same config fingerprint, if any is still live
    /// (not faulted/evicted) — the connection-reuse fast path.
    pub fn find_by_fingerprint(&self, fingerprint: &str) -> Option<&HostEntry> {
        self.hosts
            .iter()
            .find(|h| h.fingerprint == fingerprint && !h.status.is_terminal())
    }

    /// Insert (or reset) a host as [`McpLifecycle::Configured`]. Returns whether a new
    /// row was created (`true`) versus an existing addr being reset (`false`).
    pub fn upsert(&mut self, addr: HostAddr, fingerprint: impl Into<String>) -> bool {
        let fingerprint = fingerprint.into();
        if let Some(entry) = self.hosts.iter_mut().find(|h| h.addr == addr) {
            entry.fingerprint = fingerprint;
            entry.status = McpLifecycle::Configured;
            entry.tools.clear();
            false
        } else {
            self.hosts.push(HostEntry {
                addr,
                fingerprint,
                status: McpLifecycle::Configured,
                tools: Vec::new(),
            });
            true
        }
    }

    /// Advance a host's lifecycle, enforcing the legal-transition predicate.
    pub fn transition(&mut self, addr: &HostAddr, to: McpLifecycle) -> Result<(), String> {
        let entry = self
            .hosts
            .iter_mut()
            .find(|h| &h.addr == addr)
            .ok_or_else(|| format!("unknown host `{addr:?}`"))?;
        if !entry.status.can_transition(to) {
            return Err(format!(
                "illegal host transition {:?} -> {:?} for `{addr:?}`",
                entry.status, to
            ));
        }
        entry.status = to;
        Ok(())
    }

    /// Mark a host [`McpLifecycle::Ready`] and record its advertised tools. The host
    /// must be [`McpLifecycle::Handshaking`] (the legal predecessor).
    pub fn set_ready(&mut self, addr: &HostAddr, tools: Vec<String>) -> Result<(), String> {
        self.transition(addr, McpLifecycle::Ready)?;
        if let Some(entry) = self.hosts.iter_mut().find(|h| &h.addr == addr) {
            entry.tools = tools;
        }
        Ok(())
    }

    /// Fault a host (it errored) — reachable from any live state.
    pub fn fault(&mut self, addr: &HostAddr) -> Result<(), String> {
        self.transition(addr, McpLifecycle::Faulted)
    }

    /// Evict a host: drop its row. Only this host and its tools go away; the rest of
    /// the table is untouched.
    pub fn evict(&mut self, addr: &HostAddr) -> Option<HostEntry> {
        let index = self.hosts.iter().position(|h| &h.addr == addr)?;
        Some(self.hosts.remove(index))
    }

    /// The host serving `tool_name`, considering only [`McpLifecycle::Ready`]/`Idle`/
    /// `Busy` hosts (a faulted host's tools are not routable).
    pub fn host_for_tool(&self, tool_name: &str) -> Option<&HostAddr> {
        self.hosts
            .iter()
            .find(|h| {
                matches!(
                    h.status,
                    McpLifecycle::Ready | McpLifecycle::Idle | McpLifecycle::Busy
                ) && h.tools.iter().any(|t| t == tool_name)
            })
            .map(|h| &h.addr)
    }

    pub fn get(&self, addr: &HostAddr) -> Option<&HostEntry> {
        self.hosts.iter().find(|h| &h.addr == addr)
    }
}

// ===========================================================================
// Routing — classify a frame's destination, validating it against live state.
// ===========================================================================

/// Where the hub will send a frame, after validating the [`Endpoint`] against the
/// registry/host table.
#[derive(Clone, Debug, PartialEq)]
pub enum RouteDecision {
    ToMain,
    ToWatcher,
    /// A live engine worker.
    ToEngine(String),
    /// A routable (non-faulted) host.
    ToHost(HostAddr),
    /// The endpoint names nothing the watcher currently knows; the caller drops the
    /// frame and logs the reason rather than posting into the void.
    Undeliverable(String),
}

/// Decide where an addressed frame goes. `Main`/`Watcher` are always deliverable;
/// `Engine`/`Host` are validated against live state so a frame for a dead worker or an
/// evicted host is caught here instead of vanishing.
pub fn route(endpoint: &Endpoint, registry: &WorkerRegistry, hosts: &HostTable) -> RouteDecision {
    match endpoint {
        Endpoint::Main => RouteDecision::ToMain,
        Endpoint::Watcher => RouteDecision::ToWatcher,
        Endpoint::Engine(id) => {
            if registry.get(id).is_some() {
                RouteDecision::ToEngine(id.clone())
            } else {
                RouteDecision::Undeliverable(format!("no live engine `{id}`"))
            }
        }
        Endpoint::Host(addr) => match hosts.get(addr) {
            Some(entry) if !entry.status.is_terminal() => RouteDecision::ToHost(addr.clone()),
            Some(_) => RouteDecision::Undeliverable(format!("host `{addr:?}` is evicted")),
            None => RouteDecision::Undeliverable(format!("unknown host `{addr:?}`")),
        },
    }
}

// ===========================================================================
// Pending calls — in-flight tool RPC correlation + deadline supervision.
// ===========================================================================

/// One in-flight tool call awaiting its [`ToolResponse`](crate::core::contract::ToolResponse).
#[derive(Clone, Debug, PartialEq)]
pub struct PendingCall {
    pub req_id: String,
    pub agent_id: String,
    /// Absolute deadline (epoch ms). The watcher reaps calls past this.
    pub deadline_ms: u64,
}

/// The set of in-flight tool calls the watcher is supervising. Correlates a response
/// back to its request and surfaces timed-out calls (the clock is passed in, so this
/// stays pure).
#[derive(Debug, Default)]
pub struct PendingCalls {
    calls: Vec<PendingCall>,
}

impl PendingCalls {
    /// Record a dispatched call. Errors if `req_id` is already in flight (a bug —
    /// req_ids must be unique).
    pub fn open(
        &mut self,
        req_id: impl Into<String>,
        agent_id: impl Into<String>,
        deadline_ms: u64,
    ) -> Result<(), String> {
        let req_id = req_id.into();
        if self.calls.iter().any(|c| c.req_id == req_id) {
            return Err(format!("duplicate in-flight req_id `{req_id}`"));
        }
        self.calls.push(PendingCall {
            req_id,
            agent_id: agent_id.into(),
            deadline_ms,
        });
        Ok(())
    }

    /// Resolve a call by `req_id` (a response arrived), removing and returning it.
    pub fn close(&mut self, req_id: &str) -> Option<PendingCall> {
        let index = self.calls.iter().position(|c| c.req_id == req_id)?;
        Some(self.calls.remove(index))
    }

    /// The req_ids whose deadline is at or before `now_ms`, without removing them.
    pub fn expired(&self, now_ms: u64) -> Vec<String> {
        self.calls
            .iter()
            .filter(|c| c.deadline_ms <= now_ms)
            .map(|c| c.req_id.clone())
            .collect()
    }

    /// Remove and return every call whose deadline has passed — the watcher fails these
    /// with a timeout and unblocks their waiters.
    pub fn drain_expired(&mut self, now_ms: u64) -> Vec<PendingCall> {
        let mut expired = Vec::new();
        let mut kept = Vec::with_capacity(self.calls.len());
        for call in self.calls.drain(..) {
            if call.deadline_ms <= now_ms {
                expired.push(call);
            } else {
                kept.push(call);
            }
        }
        self.calls = kept;
        expired
    }

    pub fn len(&self) -> usize {
        self.calls.len()
    }

    pub fn is_empty(&self) -> bool {
        self.calls.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- worker registry ---

    #[test]
    fn register_then_lifecycle_then_terminate() {
        let mut reg = WorkerRegistry::new(None);
        reg.register("e1", "run-1", None, 0.0).unwrap();
        assert_eq!(reg.live_count(), 1);
        assert_eq!(reg.get("e1").unwrap().status, WorkerLifecycle::Spawned);

        reg.transition("e1", WorkerLifecycle::Ready).unwrap();
        reg.transition("e1", WorkerLifecycle::Busy).unwrap();
        assert_eq!(reg.get("e1").unwrap().status, WorkerLifecycle::Busy);

        // Fresh-per-agent: terminate drops the row.
        let removed = reg.terminate("e1").unwrap();
        assert_eq!(removed.id, "e1");
        assert_eq!(reg.live_count(), 0);
        assert!(reg.get("e1").is_none());
    }

    #[test]
    fn illegal_transition_and_unknown_worker_error() {
        let mut reg = WorkerRegistry::new(None);
        reg.register("e1", "run-1", None, 0.0).unwrap();
        // Spawned -> Busy skips Ready: illegal.
        assert!(reg.transition("e1", WorkerLifecycle::Busy).is_err());
        assert!(reg.transition("ghost", WorkerLifecycle::Ready).is_err());
    }

    #[test]
    fn duplicate_registration_errors() {
        let mut reg = WorkerRegistry::new(None);
        reg.register("e1", "run-1", None, 0.0).unwrap();
        assert!(reg.register("e1", "run-1", None, 1.0).is_err());
    }

    #[test]
    fn cap_none_is_unbounded_but_a_set_cap_backpressures() {
        let mut unbounded = WorkerRegistry::new(None);
        for i in 0..50 {
            unbounded
                .register(format!("e{i}"), "run", None, 0.0)
                .unwrap();
        }
        assert!(unbounded.can_spawn());

        let mut capped = WorkerRegistry::new(Some(2));
        capped.register("a", "run", None, 0.0).unwrap();
        capped.register("b", "run", None, 0.0).unwrap();
        assert!(!capped.can_spawn());
        assert!(capped.register("c", "run", None, 0.0).is_err());
    }

    #[test]
    fn workers_for_run_filters_by_run() {
        let mut reg = WorkerRegistry::new(None);
        reg.register("e1", "run-1", None, 0.0).unwrap();
        reg.register("e2", "run-1", Some("e1".into()), 0.0).unwrap();
        reg.register("e3", "run-2", None, 0.0).unwrap();
        assert_eq!(reg.workers_for_run("run-1").len(), 2);
        assert_eq!(reg.workers_for_run("run-2").len(), 1);
    }

    // --- host table ---

    fn mcp(id: &str) -> HostAddr {
        HostAddr::McpServer {
            server_id: id.to_string(),
        }
    }

    #[test]
    fn host_handshake_to_ready_exposes_tools_for_routing() {
        let mut table = HostTable::default();
        let addr = mcp("chrome");
        assert!(table.upsert(addr.clone(), "fp-1"));
        table.transition(&addr, McpLifecycle::Connecting).unwrap();
        table.transition(&addr, McpLifecycle::Handshaking).unwrap();
        table
            .set_ready(&addr, vec!["navigate".into(), "screenshot".into()])
            .unwrap();

        assert_eq!(table.host_for_tool("navigate"), Some(&addr));
        assert_eq!(table.host_for_tool("missing"), None);
    }

    #[test]
    fn fingerprint_reuse_finds_live_host_only() {
        let mut table = HostTable::default();
        let addr = mcp("a");
        table.upsert(addr.clone(), "fp-x");
        assert!(table.find_by_fingerprint("fp-x").is_some());

        table.fault(&addr).unwrap();
        // A faulted host is not yet evicted but is no longer reusable.
        table.transition(&addr, McpLifecycle::Evicted).unwrap();
        assert!(table.find_by_fingerprint("fp-x").is_none());
    }

    #[test]
    fn fault_evicts_only_the_offending_host() {
        let mut table = HostTable::default();
        let (a, b) = (mcp("a"), mcp("b"));
        table.upsert(a.clone(), "fa");
        table.upsert(b.clone(), "fb");
        table.transition(&a, McpLifecycle::Connecting).unwrap();
        table.transition(&a, McpLifecycle::Handshaking).unwrap();
        table.set_ready(&a, vec!["ta".into()]).unwrap();
        table.transition(&b, McpLifecycle::Connecting).unwrap();
        table.transition(&b, McpLifecycle::Handshaking).unwrap();
        table.set_ready(&b, vec!["tb".into()]).unwrap();

        table.fault(&a).unwrap();
        table.evict(&a);

        // a is gone; b and its tools survive.
        assert!(table.get(&a).is_none());
        assert_eq!(table.host_for_tool("tb"), Some(&b));
        // a's tool is no longer routable.
        assert_eq!(table.host_for_tool("ta"), None);
    }

    #[test]
    fn faulted_host_tools_are_not_routable() {
        let mut table = HostTable::default();
        let addr = mcp("a");
        table.upsert(addr.clone(), "fp");
        table.transition(&addr, McpLifecycle::Connecting).unwrap();
        table.transition(&addr, McpLifecycle::Handshaking).unwrap();
        table.set_ready(&addr, vec!["t".into()]).unwrap();
        assert_eq!(table.host_for_tool("t"), Some(&addr));
        table.fault(&addr).unwrap();
        assert_eq!(table.host_for_tool("t"), None);
    }

    // --- routing ---

    #[test]
    fn route_validates_engine_and_host_targets() {
        let mut reg = WorkerRegistry::new(None);
        reg.register("e1", "run-1", None, 0.0).unwrap();
        let mut hosts = HostTable::default();
        let addr = mcp("h1");
        hosts.upsert(addr.clone(), "fp");

        assert_eq!(route(&Endpoint::Main, &reg, &hosts), RouteDecision::ToMain);
        assert_eq!(
            route(&Endpoint::Watcher, &reg, &hosts),
            RouteDecision::ToWatcher
        );
        assert_eq!(
            route(&Endpoint::Engine("e1".into()), &reg, &hosts),
            RouteDecision::ToEngine("e1".into())
        );
        assert!(matches!(
            route(&Endpoint::Engine("ghost".into()), &reg, &hosts),
            RouteDecision::Undeliverable(_)
        ));
        assert_eq!(
            route(&Endpoint::Host(addr.clone()), &reg, &hosts),
            RouteDecision::ToHost(addr.clone())
        );
        // Evicted host is undeliverable.
        hosts.evict(&addr);
        assert!(matches!(
            route(&Endpoint::Host(addr), &reg, &hosts),
            RouteDecision::Undeliverable(_)
        ));
    }

    // --- pending calls / deadlines ---

    #[test]
    fn open_close_correlates_by_req_id() {
        let mut pending = PendingCalls::default();
        pending.open("r1", "agent-0", 100).unwrap();
        pending.open("r2", "agent-1", 200).unwrap();
        assert_eq!(pending.len(), 2);
        let closed = pending.close("r1").unwrap();
        assert_eq!(closed.agent_id, "agent-0");
        assert_eq!(pending.len(), 1);
        assert!(pending.close("r1").is_none());
    }

    #[test]
    fn duplicate_req_id_errors() {
        let mut pending = PendingCalls::default();
        pending.open("r1", "a", 100).unwrap();
        assert!(pending.open("r1", "a", 100).is_err());
    }

    #[test]
    fn deadlines_expire_at_or_before_now_and_drain_removes_them() {
        let mut pending = PendingCalls::default();
        pending.open("soon", "a", 50).unwrap();
        pending.open("later", "a", 500).unwrap();

        assert_eq!(pending.expired(100), vec!["soon".to_string()]);
        let drained = pending.drain_expired(100);
        assert_eq!(drained.len(), 1);
        assert_eq!(drained[0].req_id, "soon");
        // The not-yet-expired call remains in flight.
        assert_eq!(pending.len(), 1);
        assert!(pending.close("later").is_some());
    }
}
