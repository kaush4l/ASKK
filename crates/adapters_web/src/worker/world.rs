//! WHAT A SUB-AGENT'S WORLD IS MADE OF: the ports it gets, the two databases
//! it reaches, and the one thing it cannot do.
//!
//! Kept apart from the class next door because this is the only place a
//! sub-agent's capabilities are decided, and a capability granted by accident
//! is the failure I6 exists to prevent. The class is the boundary; this is the
//! grant, and it should be readable on its own.

use std::rc::Rc;

use wasm_bindgen::prelude::*;

use crate::{js_err, BrowserClock, BrowserRng, FetchModel, FetchNet, IdbStore};

/// The one database every SPACE lives in — the browser's answer to "the same
/// object for every caller" (Python `get_space`). One name, so the page and a
/// Worker cannot open two different ones.
pub(crate) const SPACES_DB: &str = "harness-spaces";

/// Where one sub-agent's own storage lives: its OWN database, not a corner of
/// the page's. Sharing one would replay the lead's whole event log into every
/// sub-agent and fight it for the `events/` keyspace; a database per agent is
/// the Python's folder per agent, and it is one string.
fn database(name: &str) -> String {
    format!("harness-agent-{name}")
}

/// A SUB-AGENT'S WORLD, and how it differs from the page's: its own log, the
/// page's shared spaces, the page's allowlist, and nobody to delegate to.
pub(super) async fn worker_ports(
    name: &str,
    model: Rc<FetchModel>,
) -> Result<core::Ports, JsValue> {
    Ok(core::Ports {
        model: Rc::clone(&model) as Rc<dyn kernel::ModelPort>,
        store: Rc::new(IdbStore::open(&database(name)).await.map_err(js_err)?),
        // Its own log, but the SAME spaces database the page opened: that
        // shared keyspace is what makes one space one space across Workers
        // that share no memory (increment 09).
        spaces: Rc::new(IdbStore::open(SPACES_DB).await.map_err(js_err)?) as Rc<dyn kernel::KvStore>,
        // The SAME allowlist the page has, because it rides in the same
        // profile record this Worker was booted from — a search a sub-agent
        // cannot make is a capability the roster has and half of it does not
        // (increment 21). Blank stays off the list.
        net: {
            let net = FetchNet::new();
            net.allow(kernel::SEARCH_ENDPOINT, &model.search_url());
            Rc::new(net)
        },
        clock: Rc::new(BrowserClock),
        rng: Rc::new(BrowserRng),
        // The SAME adapter the page uses, which refuses here in words: a
        // Worker has no `document` to load the engine into, and the one shell
        // the container serves is the page's. A sub-agent's exec therefore
        // comes back "the workspace runs in the page, not in an agent's
        // Worker" instead of quietly fighting the page for it (increment 10 —
        // routing it back to the page is not done).
        workspace: Rc::new(crate::C2wWorkspace),
        // A sub-agent delegates to nobody: the wiring is one level deep on
        // purpose, so a cycle of agents calling each other cannot exist.
        agents: Rc::new(NoSubAgents),
    })
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
