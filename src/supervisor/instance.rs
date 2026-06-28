//! A live, managed agent: the runtime object the supervisor spins up — one per
//! agent file in a team. It bundles the agent's identity with its mutable runtime
//! surface: current [`AgentStatus`], its message [`Mailbox`], and a progress log.
//! Pure data + small mutators, so it is host-testable with no browser/async deps.

use crate::state::Agent;

use super::mailbox::{Mailbox, Message};
use super::status::AgentStatus;

/// One managed agent instance. The supervisor creates these from the loaded
/// [`Agent`] definitions (nothing about the count is hardcoded — it is one per
/// member file the folder yielded) and owns them for the lifetime of a team run.
#[derive(Clone, Debug)]
pub struct AgentInstance {
    /// The agent id this instance runs as (the namespaced team-member id).
    pub id: String,
    /// The team this agent belongs to, if any.
    pub team: Option<String>,
    /// Display name (the member role, e.g. "Planner").
    pub role: String,
    /// Position within the team (the numeric filename prefix); members run
    /// ascending.
    pub order: u32,
    /// What this instance is doing right now.
    pub status: AgentStatus,
    /// Messages addressed to this agent, awaiting its next run.
    pub inbox: Mailbox,
    /// A human-readable milestone log (most recent last), surfaced as progress.
    pub progress: Vec<String>,
}

impl AgentInstance {
    /// Build a fresh, idle instance from a loaded agent definition.
    pub fn from_agent(agent: &Agent) -> Self {
        Self {
            id: agent.id.clone(),
            team: agent.team.clone(),
            role: agent.name.clone(),
            order: agent.order,
            status: AgentStatus::Idle,
            inbox: Mailbox::new(),
            progress: Vec::new(),
        }
    }

    /// Replace the current status.
    pub fn set_status(&mut self, status: AgentStatus) {
        self.status = status;
    }

    /// Append a progress milestone (bounded so a long run cannot grow it without
    /// limit; the freshest entries are the useful ones).
    pub fn note_progress(&mut self, note: impl Into<String>) {
        const MAX_PROGRESS: usize = 200;
        if self.progress.len() >= MAX_PROGRESS {
            self.progress.remove(0);
        }
        self.progress.push(note.into());
    }

    /// Enqueue a message into this instance's inbox.
    pub fn receive(&mut self, message: Message) {
        self.inbox.push(message);
    }

    /// Drain and return this instance's pending inbox messages.
    pub fn drain_inbox(&mut self) -> Vec<Message> {
        self.inbox.drain()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member(id: &str, order: u32) -> Agent {
        let mut agent = Agent::new(id, "Do work.", Vec::new());
        agent.id = id.to_string();
        agent.team = Some("coder".into());
        agent.order = order;
        agent
    }

    #[test]
    fn from_agent_starts_idle_with_empty_inbox() {
        let instance = AgentInstance::from_agent(&member("coder-planner", 1));
        assert_eq!(instance.id, "coder-planner");
        assert_eq!(instance.team.as_deref(), Some("coder"));
        assert_eq!(instance.order, 1);
        assert_eq!(instance.status, AgentStatus::Idle);
        assert!(instance.inbox.is_empty());
        assert!(instance.progress.is_empty());
    }

    #[test]
    fn status_progress_and_inbox_mutate() {
        let mut instance = AgentInstance::from_agent(&member("coder-coder", 2));
        instance.set_status(AgentStatus::Running {
            turn: 1,
            phase: "execute".into(),
        });
        assert!(instance.status.is_running());

        instance.note_progress("started");
        instance.note_progress("done");
        assert_eq!(instance.progress, vec!["started", "done"]);

        instance.receive(Message::new("orchestrator", "focus on src/lib.rs"));
        let drained = instance.drain_inbox();
        assert_eq!(drained.len(), 1);
        assert_eq!(drained[0].body, "focus on src/lib.rs");
        assert!(instance.inbox.is_empty());
    }
}
