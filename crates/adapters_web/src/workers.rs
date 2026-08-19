//! The page's side of one-Worker-per-agent: spawn one Worker per loaded agent
//! at boot, hand it a goal by `postMessage` when the lead — or a person —
//! calls it (ADR-008: the transport is messages, and there is no shared memory
//! to be tempted by). This is the `AgentPort` the core sees; the core names an
//! agent and waits, and cannot reach into its loop even by accident.
//!
//! One agent takes ONE turn at a time — the Python's per-agent loop is serial
//! too — so a Worker has at most one call outstanding. Two DIFFERENT agents
//! called on one line run at the same time, which is the whole point.
//!
//! Every lifecycle move is reported: `Starting` while it comes up, `Idle` when
//! it says it is ready, `Failed` WITH THE REASON if it cannot start, `Closed`
//! when it is stopped (Python `_start` and `aclose`). A Worker that failed used
//! to be a bare `console.warn` and no status write at all, so an agent with no
//! Worker rendered as "idle — nobody has called it".

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use wasm_bindgen_futures::JsFuture;

use kernel::{AgentPort, BoxFuture, DelegateError, Status};

mod spawn;

use spawn::{ask, bundle_urls, listen, start, Activity, Authored, Boot, Live, Memory};

/// A lifecycle fact the page has not told the core about yet.
type Report = (String, Status, String);

pub struct AgentWorkers {
    live: RefCell<HashMap<String, Live>>,
    /// Status moves waiting to be drained into the log. A queue, not a call
    /// into the core: these arrive from a JS callback, where the app is
    /// already borrowed by whatever handler is running.
    reports: Rc<RefCell<Vec<Report>>>,
    /// What each Worker last said about its own window. Same queue discipline
    /// as `reports`, and for the same reason: it arrives on a JS callback.
    memory: Rc<RefCell<Vec<Memory>>>,
    /// Agents a Worker WROTE with `write_agent` (increment 11). Same queue as
    /// `memory`: a sub-agent's log is not the page's, so an agent it authored
    /// reaches the roster only because the Worker says so.
    written: Rc<RefCell<Vec<Authored>>>,
    /// Tool calls and spend a Worker has reported and the page has not yet
    /// adopted. Same queue as the three above.
    did: Rc<RefCell<Vec<Activity>>>,
}

impl AgentWorkers {
    pub fn none() -> AgentWorkers {
        AgentWorkers {
            live: RefCell::new(HashMap::new()),
            reports: Rc::new(RefCell::new(Vec::new())),
            memory: Rc::new(RefCell::new(Vec::new())),
            written: Rc::new(RefCell::new(Vec::new())),
            did: Rc::new(RefCell::new(Vec::new())),
        }
    }

    /// Every lifecycle fact since the last call — drained by the composition
    /// root into `core::report_agent`, which is the one door a status moves
    /// through (I8).
    pub fn take_reports(&self) -> Vec<Report> {
        std::mem::take(&mut self.reports.borrow_mut())
    }

    /// Everything the Workers have DONE since the last call: one `(agent,
    /// activity JSON)` per message they sent.
    pub fn take_activity(&self) -> Vec<Activity> {
        std::mem::take(&mut self.did.borrow_mut())
    }

    /// Every window a Worker has reported since the last call, drained by the
    /// composition root into `core::report_memory`.
    pub fn take_memory(&self) -> Vec<Memory> {
        std::mem::take(&mut self.memory.borrow_mut())
    }

    /// Every agent a Worker has reported writing since the last call, drained
    /// by the composition root into `core::report_authored`.
    pub fn take_authored(&self) -> Vec<Authored> {
        std::mem::take(&mut self.written.borrow_mut())
    }

    /// Start a Worker for every agent except the one the page itself is.
    /// `agents_json`, `models_json` and `profile_json` are forwarded whole, so
    /// a sub-agent boots from exactly the files and endpoint the page did.
    pub fn spawn(
        &self,
        names: &[String],
        lead: &str,
        agents_json: &str,
        models_json: &str,
        profile_json: &str,
    ) {
        let boot = Boot {
            agents: agents_json,
            models: models_json,
            profile: profile_json,
        };
        let peers = || names.iter().filter(|n| n.as_str() != lead);
        let Some((glue, wasm)) = bundle_urls() else {
            // Not a warning in a console nobody has open: without the bundle
            // links there are no sub-agents at all, and every row must say so.
            let why = "this page's wasm bundle links were not found, so this agent \
                       could not be started";
            for name in peers() {
                self.report(name, Status::Failed, why);
            }
            return;
        };
        for name in peers() {
            self.start_one(name, &glue, &wasm, &boot);
        }
    }

    /// One agent's Worker, started and listened to — or the row that says in
    /// words why it is not there. Every outcome reaches the board (I8): a
    /// Worker that failed silently used to render as "idle — nobody has
    /// called it".
    fn start_one(&self, name: &str, glue: &str, wasm: &str, boot: &Boot<'_>) {
        match start(name, glue, wasm, boot) {
            Ok(worker) => {
                self.report(name, Status::Starting, "");
                let live = listen(
                    name,
                    worker,
                    Rc::clone(&self.reports),
                    Rc::clone(&self.memory),
                    Rc::clone(&self.written),
                    Rc::clone(&self.did),
                );
                self.live.borrow_mut().insert(name.to_string(), live);
            }
            Err(e) => self.report(name, Status::Failed, &crate::wire::js_message(&e)),
        }
    }

    /// Stop every Worker (Python `aclose`: close, stop the thread, mark the row
    /// CLOSED). Called before the page restarts them with a changed endpoint —
    /// a Worker was handed its profile at boot and cannot learn a new one.
    /// No `Closed` row is written. Stopping a Worker only ever happens as the
    /// first half of replacing it, and both facts drained in the same tick — so
    /// "closed — its Worker is stopped" was a board state no person could ever
    /// see (`ux-walker`, increment 07). The truthful row for this moment is the
    /// `Starting` the respawn writes a line later.
    pub fn close_all(&self) {
        for (_, live) in self.live.borrow_mut().drain() {
            live.worker.terminate();
        }
    }

    fn report(&self, agent: &str, status: Status, detail: &str) {
        self.reports
            .borrow_mut()
            .push((agent.to_string(), status, detail.to_string()));
    }

}

impl AgentPort for AgentWorkers {
    fn delegate<'a>(
        &'a self,
        agent: &'a str,
        goal: &'a str,
    ) -> BoxFuture<'a, Result<String, DelegateError>> {
        let call = self.live.borrow().get(agent).map(|live| ask(live, goal));
        Box::pin(async move {
            let Some(call) = call else {
                return Err(DelegateError::Unknown {
                    agent: agent.to_string(),
                });
            };
            JsFuture::from(call)
                .await
                .map(|v| v.as_string().unwrap_or_default())
                // Its OWN words, whatever they were: a sub-agent whose turn
                // raised must name its cause the way the lead's does.
                .map_err(|e| DelegateError::Failed {
                    agent: agent.to_string(),
                    message: crate::wire::js_message(&e),
                })
        })
    }
}
