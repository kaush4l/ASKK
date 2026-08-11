//! One agent, inside its own Worker. The Python's `AgentThread` — "a private
//! event loop running on its own thread" — has exactly one browser equivalent,
//! and this is it: a Worker is its own JS context with its own Wasm instance,
//! reached only by `postMessage` (ARCHITECTURE §10, ADR-008: no shared
//! memory). One agent's slow turn therefore cannot block another's, because
//! there is no lock, no queue and no allocator between them to contend on.
//!
//! The Worker is handed everything it needs in the boot message — the agent
//! files, the model catalogue, the endpoint profile — rather than fetching
//! them again: one page, one download, and the sub-agent calls the endpoint
//! the user configured on the page it was opened from.

use std::cell::RefCell;
use std::rc::Rc;

use wasm_bindgen::prelude::*;

use crate::{js_err, BrowserClock, BrowserRng, FetchModel, FetchNet, IdbStore};

/// Where one sub-agent's own storage lives: its OWN database, not a corner of
/// the page's. Sharing one would replay the lead's whole event log into every
/// sub-agent and fight it for the `events/` keyspace; a database per agent is
/// the Python's folder per agent, and it is one string.
/// The one database every SPACE lives in — the browser's answer to "the same
/// object for every caller" (Python `get_space`). One name, so the page and a
/// Worker cannot open two different ones.
pub(crate) const SPACES_DB: &str = "harness-spaces";

fn database(name: &str) -> String {
    format!("harness-agent-{name}")
}

/// One sub-agent, booted in its Worker and answering goals one at a time.
/// Exported through the same wasm-bindgen glue the page loads, so there is one
/// build, one wasm binary and one set of ports — a sub-agent is not a
/// different program, it is the same program somewhere else.
#[wasm_bindgen]
pub struct AgentWorker {
    app: Rc<RefCell<core::App>>,
    name: String,
}

#[wasm_bindgen]
impl AgentWorker {
    /// Build this agent's app. `agents_json` is the `[[folder, text], …]` the
    /// page already fetched, `models_json` the catalogue, `profile_json` the
    /// user's endpoint choice and keys — a same-origin Worker is inside the
    /// same trust boundary as the page that spawned it (ADR-006).
    pub async fn boot(
        name: String,
        agents_json: String,
        models_json: String,
        profile_json: String,
    ) -> Result<AgentWorker, JsValue> {
        let model = Rc::new(FetchModel::new("config/keys/"));
        if !models_json.is_empty() {
            model.set_catalogue(&models_json);
        }
        if !profile_json.is_empty() {
            model.load_profile(&profile_json);
        }
        let ports = core::Ports {
            model: Rc::clone(&model) as Rc<dyn kernel::ModelPort>,
            store: Rc::new(IdbStore::open(&database(&name)).await.map_err(js_err)?),
            // Its own log, but the SAME spaces database the page opened: that
            // shared keyspace is what makes one space one space across
            // Workers that share no memory (increment 09).
            spaces: Rc::new(
                IdbStore::open(SPACES_DB)
                    .await
                    .map_err(js_err)?,
            ) as Rc<dyn kernel::KvStore>,
            net: Rc::new(FetchNet::new(Vec::new())),
            clock: Rc::new(BrowserClock),
            rng: Rc::new(BrowserRng),
            // The SAME adapter the page uses, which refuses here in words: a
            // Worker has no `document` to load the engine into, and two
            // overlays over one IndexedDB cache would be two writers on one
            // disk. A sub-agent's exec therefore comes back "no workspace is
            // available here" instead of quietly corrupting the page's
            // (increment 10 — routing it back to the page is not done).
            workspace: Rc::new(crate::CheerpxWorkspace),
            // A sub-agent delegates to nobody: the wiring is one level deep on
            // purpose, so a cycle of agents calling each other cannot exist.
            agents: Rc::new(NoSubAgents),
        };
        let files: Vec<(String, String)> = serde_json::from_str(&agents_json).unwrap_or_default();
        let mut app = core::boot(ports).await.map_err(js_err)?;
        core::install_agents_as(&mut app, files, &name);
        // A reload is a new Worker, but it is not a new conversation: this
        // agent's own window comes back out of its own log (increment 08 —
        // the open item 07 recorded).
        core::restore_log(&mut app).await.map_err(js_err)?;
        Ok(AgentWorker {
            app: Rc::new(RefCell::new(app)),
            name,
        })
    }

    /// What this agent HOLDS right now: the size of its window and whether its
    /// oldest turns are a summary. The page cannot work this out — the window
    /// lives in this Wasm instance — so the Worker says, and the page prints
    /// what it was told (`ux-walker`, increment 08: a sub-agent had no memory
    /// indicator at all).
    pub fn memory(&self) -> String {
        let (entries, summary) = core::memory_held(&self.app.borrow());
        serde_json::json!({ "window": entries, "summary": summary }).to_string()
    }

    /// Every agent THIS one wrote with `write_agent` (increment 11). Its own
    /// log is not the page's, so without this the create-agent superagent would
    /// author into a Worker nobody reads. The page adopts them through
    /// `core::report_authored`, which records the same fact its own form does.
    pub fn authored(&self) -> String {
        serde_json::to_string(&core::authored_here(&self.app.borrow()))
            .unwrap_or_else(|_| "[]".into())
    }

    /// Take one turn on this agent's own loop and hand back what it said —
    /// the Python `ThreadedAgent.invoke`, minus the marshalling, because the
    /// message already crossed the boundary. An answerless turn is an error,
    /// not an empty string: the caller must be able to tell them apart.
    ///
    /// And the error carries the CAUSE. This used to discard whatever went
    /// wrong and return "<name> produced no answer" — four words naming
    /// nothing, where the page's own failure said which endpoint could not be
    /// reached and why. The Python's `invoke` re-raises and records `str(e)`;
    /// this is the same thing across a `postMessage` boundary.
    pub async fn run(&self, goal: String) -> Result<String, JsValue> {
        core::handle(
            &mut self.app.borrow_mut(),
            kernel::Request::post_form("/chat", &[("message", &goal)]),
        );
        core::drive(Rc::clone(&self.app)).await.map_err(js_err)?;
        let app = self.app.borrow();
        if let Some(answer) = core::answer(&app) {
            return Ok(answer);
        }
        // The cause, in the sentence the page would have shown for its own
        // turn — unprefixed, because the transcript and the board already say
        // which agent this is and a doubled name reads as a stutter.
        // The TYPED payload, not the rendered sentence: the page re-renders it
        // into the same failure card — with the same disclosure — that it shows
        // for its own turns (`ux-walker`, increment 07b).
        Err(JsValue::from_str(&match core::last_failure_payload(&app) {
            Some(payload) => payload,
            None => format!("{} produced no answer", self.name),
        }))
    }
}

/// A sub-agent's own `AgentPort`: nothing to delegate to.
struct NoSubAgents;

impl kernel::AgentPort for NoSubAgents {
    fn delegate<'a>(
        &'a self,
        agent: &'a str,
        _goal: &'a str,
    ) -> kernel::BoxFuture<'a, Result<String, kernel::DelegateError>> {
        Box::pin(std::future::ready(Err(kernel::DelegateError::Unknown {
            agent: agent.to_string(),
        })))
    }
}
