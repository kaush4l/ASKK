//! The supervisor: the orchestration layer that sits ABOVE the per-agent ReAct
//! engine. Where the engine runs a single agent's loop, the supervisor manages a
//! *roster* of agents — spinning up one runtime [`AgentInstance`] (object + inbox
//! queue + status) per agent file a team folder yielded, tracking each one's live
//! status, routing messages to a specific agent, and reporting progress.
//!
//! Nothing about the number of agents is hardcoded anywhere: [`Supervisor::spawn_team`]
//! reads the membership from [`crate::state::teams`] (a projection of the
//! `agents/<team>/` folder) and instantiates exactly what is on disk. Dropping a new
//! member `.md` into the folder grows the team with no code change.
//!
//! The supervisor owns the *coordination* state; the actual running of a member's
//! loop is delegated to the engine via [`driver::run_team`], which drives the pure
//! [`pipeline::TeamPipeline`] sequencer. Splitting coordination (here, host-testable)
//! from execution (the async engine call) keeps every routing/status branch testable
//! without a live model.

mod driver;
mod instance;
mod mailbox;
mod pipeline;
mod registry;
mod status;

use std::collections::BTreeMap;

use crate::state::{Agent, teams};

pub use driver::run_team;
pub use instance::AgentInstance;
pub use mailbox::Message;
pub use pipeline::TeamPipeline;
pub use registry::{SupervisorHandle, install, with_active};
pub use status::AgentStatus;

/// The roster manager. Holds one [`AgentInstance`] per managed agent, keyed by id,
/// and exposes the supervision surface: spin up a team, message a specific agent,
/// read an agent's status/progress, and list the roster. Insertion-ordered display
/// is provided by sorting on each instance's `order`.
#[derive(Clone, Debug, Default)]
pub struct Supervisor {
    roster: BTreeMap<String, AgentInstance>,
}

impl Supervisor {
    pub fn new() -> Self {
        Self {
            roster: BTreeMap::new(),
        }
    }

    /// Spin up runtime instances for every member of `team_id`, discovered from the
    /// loaded `agents` (i.e. from the `agents/<team>/` folder). Returns the member
    /// ids in run order. The count is whatever the folder yielded — never hardcoded.
    /// An unknown team (no matching folder) is a clean error, never a panic.
    pub fn spawn_team(&mut self, agents: &[Agent], team_id: &str) -> Result<Vec<String>, String> {
        let team = teams(agents)
            .into_iter()
            .find(|team| team.id == team_id)
            .ok_or_else(|| {
                format!("Unknown team `{team_id}`. No `agents/{team_id}/` folder is loaded.")
            })?;

        if team.member_ids.is_empty() {
            return Err(format!("Team `{team_id}` has no members."));
        }

        for member_id in &team.member_ids {
            if let Some(agent) = agents.iter().find(|agent| &agent.id == member_id) {
                let mut instance = AgentInstance::from_agent(agent);
                instance.set_status(AgentStatus::Queued);
                self.roster.insert(agent.id.clone(), instance);
            }
        }

        Ok(team.member_ids)
    }

    /// Borrow a managed instance by id.
    pub fn instance(&self, id: &str) -> Option<&AgentInstance> {
        self.roster.get(id)
    }

    /// Route a message to a specific agent's inbox. The agent folds it into its
    /// next run's goal. Unknown recipients are a clean error.
    pub fn send_to(&mut self, id: &str, message: Message) -> Result<(), String> {
        match self.roster.get_mut(id) {
            Some(instance) => {
                instance.receive(message);
                Ok(())
            }
            None => Err(format!("No managed agent `{id}` to message.")),
        }
    }

    /// The current status of a specific agent, if managed.
    #[allow(dead_code)]
    pub fn progress_of(&self, id: &str) -> Option<&AgentStatus> {
        self.roster.get(id).map(|instance| &instance.status)
    }

    /// Set a managed agent's status (no-op if the id is unknown).
    pub fn set_status(&mut self, id: &str, status: AgentStatus) {
        if let Some(instance) = self.roster.get_mut(id) {
            instance.set_status(status);
        }
    }

    /// Append a progress milestone to a managed agent (no-op if unknown).
    pub fn note_progress(&mut self, id: &str, note: impl Into<String>) {
        if let Some(instance) = self.roster.get_mut(id) {
            instance.note_progress(note);
        }
    }

    /// Drain a managed agent's inbox (no-op returning empty if unknown).
    pub fn drain_inbox(&mut self, id: &str) -> Vec<Message> {
        self.roster
            .get_mut(id)
            .map(AgentInstance::drain_inbox)
            .unwrap_or_default()
    }

    /// The whole roster, sorted by team then run order — the supervisor's view of
    /// every managed agent and what it is doing, for the orchestrator and the UI.
    pub fn list(&self) -> Vec<&AgentInstance> {
        let mut instances: Vec<&AgentInstance> = self.roster.values().collect();
        instances.sort_by(|a, b| {
            a.team
                .cmp(&b.team)
                .then(a.order.cmp(&b.order))
                .then(a.id.cmp(&b.id))
        });
        instances
    }

    /// Number of managed agents.
    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.roster.len()
    }

    /// Whether the roster is empty (companion to [`Supervisor::len`]; used by the
    /// fleet view's empty-state and kept as part of the supervision surface).
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.roster.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::agent_from_markdown;

    fn coder_team_agents() -> Vec<Agent> {
        vec![
            agent_from_markdown("agents/coder/2_coder.md", "---\n---\nWrite code.").unwrap(),
            agent_from_markdown("agents/coder/1_planner.md", "---\n---\nPlan.").unwrap(),
            agent_from_markdown("agents/coder/3_verifier.md", "---\n---\nVerify.").unwrap(),
            agent_from_markdown("agents/1_orchestrator.md", "---\n---\nCoordinate.").unwrap(),
        ]
    }

    #[test]
    fn spawn_team_instantiates_one_per_member_in_order() {
        let agents = coder_team_agents();
        let mut supervisor = Supervisor::new();
        let members = supervisor.spawn_team(&agents, "coder").unwrap();

        assert_eq!(
            members,
            vec!["coder-planner", "coder-coder", "coder-verifier"]
        );
        assert_eq!(supervisor.len(), 3);
        // Every member starts Queued.
        for id in &members {
            assert_eq!(supervisor.progress_of(id), Some(&AgentStatus::Queued));
        }
        // The flat orchestrator is not a team member, so it was not spun up.
        assert!(supervisor.instance("orchestrator").is_none());
    }

    #[test]
    fn unknown_team_is_a_clean_error() {
        let agents = coder_team_agents();
        let mut supervisor = Supervisor::new();
        let error = supervisor.spawn_team(&agents, "nope").unwrap_err();
        assert!(error.contains("Unknown team"));
    }

    #[test]
    fn send_to_routes_to_the_named_agent_only() {
        let agents = coder_team_agents();
        let mut supervisor = Supervisor::new();
        supervisor.spawn_team(&agents, "coder").unwrap();

        supervisor
            .send_to("coder-coder", Message::new("orchestrator", "use file_edit"))
            .unwrap();

        assert_eq!(supervisor.instance("coder-coder").unwrap().inbox.len(), 1);
        assert_eq!(supervisor.instance("coder-planner").unwrap().inbox.len(), 0);

        let drained = supervisor.drain_inbox("coder-coder");
        assert_eq!(drained[0].body, "use file_edit");
        assert!(supervisor.send_to("ghost", Message::new("x", "y")).is_err());
    }

    #[test]
    fn list_is_sorted_by_team_then_order() {
        let agents = coder_team_agents();
        let mut supervisor = Supervisor::new();
        supervisor.spawn_team(&agents, "coder").unwrap();

        let ids: Vec<&str> = supervisor
            .list()
            .iter()
            .map(|instance| instance.id.as_str())
            .collect();
        assert_eq!(ids, vec!["coder-planner", "coder-coder", "coder-verifier"]);
    }
}
