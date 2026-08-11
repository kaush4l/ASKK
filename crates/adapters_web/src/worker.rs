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

use crate::{js_err, BrowserClock, BrowserRng, FetchModel, FetchNet};

/// Storage for a sub-agent's turn: in memory, gone with the Worker.
///
/// ponytail: NOT IndexedDB. A sub-agent's own persistent log is increment 08;
/// sharing the page's database here would replay the lead's whole history into
/// every sub-agent and fight it for the `events/` keyspace. In-memory is the
/// honest scope of what a delegation needs today.
#[derive(Default)]
struct TurnStore {
    kv: RefCell<std::collections::HashMap<String, String>>,
}

fn ready<'a, T: 'a>(value: T) -> kernel::BoxFuture<'a, T> {
    Box::pin(std::future::ready(value))
}

impl kernel::KvStore for TurnStore {
    fn get<'a>(&'a self, key: &'a str) -> kernel::BoxFuture<'a, Result<Option<String>, kernel::StoreError>> {
        ready(Ok(self.kv.borrow().get(key).cloned()))
    }
    fn put<'a>(&'a self, key: &'a str, value: &'a str) -> kernel::BoxFuture<'a, Result<(), kernel::StoreError>> {
        self.kv.borrow_mut().insert(key.into(), value.into());
        ready(Ok(()))
    }
    fn delete<'a>(&'a self, key: &'a str) -> kernel::BoxFuture<'a, Result<(), kernel::StoreError>> {
        self.kv.borrow_mut().remove(key);
        ready(Ok(()))
    }
    fn list_prefix<'a>(&'a self, prefix: &'a str) -> kernel::BoxFuture<'a, Result<Vec<String>, kernel::StoreError>> {
        let mut keys: Vec<String> = self
            .kv
            .borrow()
            .keys()
            .filter(|k| k.starts_with(prefix))
            .cloned()
            .collect();
        keys.sort();
        ready(Ok(keys))
    }
}

/// No blobs in a Worker turn: nothing here writes one, and a store that
/// pretends otherwise would be a lie with a HashMap behind it.
impl kernel::BlobStore for TurnStore {
    fn read<'a>(&'a self, _p: &'a str) -> kernel::BoxFuture<'a, Result<Option<Vec<u8>>, kernel::StoreError>> {
        ready(Ok(None))
    }
    fn write<'a>(&'a self, _p: &'a str, _b: &'a [u8]) -> kernel::BoxFuture<'a, Result<(), kernel::StoreError>> {
        ready(Ok(()))
    }
    fn delete<'a>(&'a self, _p: &'a str) -> kernel::BoxFuture<'a, Result<(), kernel::StoreError>> {
        ready(Ok(()))
    }
    fn list_prefix<'a>(&'a self, _p: &'a str) -> kernel::BoxFuture<'a, Result<Vec<String>, kernel::StoreError>> {
        ready(Ok(Vec::new()))
    }
}

impl kernel::StorePort for TurnStore {
    fn kv(&self) -> &dyn kernel::KvStore {
        self
    }
    fn blob(&self) -> &dyn kernel::BlobStore {
        self
    }
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
            store: Rc::new(TurnStore::default()),
            net: Rc::new(FetchNet::new(Vec::new())),
            clock: Rc::new(BrowserClock),
            rng: Rc::new(BrowserRng),
            // A sub-agent delegates to nobody: the wiring is one level deep on
            // purpose, so a cycle of agents calling each other cannot exist.
            agents: Rc::new(NoSubAgents),
        };
        let files: Vec<(String, String)> = serde_json::from_str(&agents_json).unwrap_or_default();
        let mut app = core::boot(ports).await.map_err(js_err)?;
        core::install_agents_as(&mut app, files, &name);
        Ok(AgentWorker {
            app: Rc::new(RefCell::new(app)),
            name,
        })
    }

    /// Take one turn on this agent's own loop and hand back what it said —
    /// the Python `ThreadedAgent.invoke`, minus the marshalling, because the
    /// message already crossed the boundary. An answerless turn is an error,
    /// not an empty string: the caller must be able to tell them apart.
    pub async fn run(&self, goal: String) -> Result<String, JsValue> {
        core::handle(
            &mut self.app.borrow_mut(),
            kernel::Request::post_form("/chat", &[("message", &goal)]),
        );
        core::drive(Rc::clone(&self.app)).await.map_err(js_err)?;
        core::answer(&self.app.borrow()).ok_or_else(|| {
            JsValue::from_str(&format!("{} produced no answer", self.name))
        })
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
