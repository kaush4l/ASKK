//! Keeping the Workers level with the roster. An agent authored in the browser
//! (increment 11) has to get its own Worker without a reload, and a deleted one
//! has to lose it — otherwise the agent list and the things that can actually
//! answer disagree, which is the same class of lie as a board that says `idle`
//! about an agent with no Worker at all (increment 06's finding).
//!
//! Composition-root work: the core names an agent and waits, and never knows a
//! Worker exists (ADR-008).

use crate::WebApp;

impl WebApp {
    /// Start a Worker for every agent that has none, and stop the ones whose
    /// agent has gone. Called after every seam round-trip; a no-op — one `Vec`
    /// comparison — whenever the roster has not moved, which is almost always.
    ///
    /// Coarse on purpose: every Worker is replaced, not just the new one. A
    /// Worker is handed its whole world at boot and cannot learn a new agent,
    /// so a page that authored `haiku` must hand the OTHER agents the file too
    /// or `main` could not delegate to it. ponytail: replacing all of them
    /// costs a boot each and happens only when the roster actually changes; a
    /// per-Worker "here is one more agent" message is the upgrade if it ever
    /// matters.
    pub(crate) fn sync_workers(&self) {
        // Compared on the FILES, not on the names: editing a running agent's
        // prompt changes no name, and a Worker is handed its file once — so
        // without this the page adopted the new prompt and the sub-agent in its
        // Worker kept answering from the old one.
        let world = self.agents_json();
        if *self.spawned.borrow() == world {
            return;
        }
        *self.spawned.borrow_mut() = world.clone();
        self.workers.close_all();
        self.workers.spawn(
            &self.agent_names(),
            core::ENTRY_AGENT,
            &world,
            &self.models.borrow(),
            &self.model.profile_json(),
        );
    }

    /// Every agent file, as the JSON blob a Worker boots from — read from the
    /// core rather than remembered here, so an agent authored a moment ago is
    /// in it (`core::agent_files` owns the precedence rule).
    pub(crate) fn agents_json(&self) -> String {
        serde_json::to_string(&core::agent_files(&self.app.borrow())).unwrap_or_else(|_| "[]".into())
    }

    /// Stop every sub-agent Worker and start it again on the CURRENT endpoint.
    /// A Worker is handed its profile once, at boot; without this, changing the
    /// endpoint in Settings left every sub-agent calling the old one while the
    /// page called the new — the same question answered two ways depending on
    /// which pane you asked.
    pub fn restart_agents(&self) {
        self.spawned.borrow_mut().clear();  // force: the endpoint moved, not the roster
        self.sync_workers();
    }
}
