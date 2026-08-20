//! THE STANDING GOAL, AS THE MODEL READS IT.
//!
//! `goal.outcome` and `goal.done_when` are the agent's own declaration of what
//! it is for and what ends the work. If they only lived in Rust they would be
//! the failure this codebase names most often — a setting that looks applied:
//! the loop gated on a goal the model was never told, working toward whatever
//! it inferred from the last message instead.
//!
//! THE COMMAND IS NOT RENDERED HERE, AND THAT IS DELIBERATE. `goal.check` is
//! the machine's instrument, not the model's instruction, and the model meets
//! it the honest way — by being shown its result. `goal::said` quotes the
//! command and what it printed into `observations` on every lap that goes round
//! again, so the order is: aim at the outcome, then read what the machine
//! actually observed. Printing the command up here instead hands a model that
//! has been acting for sixty rounds a target, and satisfying the command is not
//! the same act as satisfying the outcome.
//!
//! IT IS NOT THE `task`, EITHER. The task is what the person typed on this turn
//! and changes with every message; this is what the agent's FILE says it is for
//! and outlives every turn. Two lifetimes, two owners, two components — which
//! is why it sits at `Slot::GOAL`, up in the stable cacheable head beside the
//! soul it was declared next to, rather than beside the task.

use context::{text, Component, Fidelity, Part, Slot, Stability};
use kernel::SectionId;

/// The two declared lines. Both empty is an agent that declared no goal, and
/// `adopt_spec` does not attach this block at all in that case — so a file
/// with no `goal.*` key assembles the paper it always did, byte for byte.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct Goal {
    pub outcome: String,
    pub done_when: String,
}

impl Component for Goal {
    fn id(&self) -> SectionId {
        SectionId("goal".into())
    }
    fn slot(&self) -> Slot {
        Slot::GOAL
    }
    fn intent(&self) -> String {
        "What this agent is for, and what ends the work.".into()
    }
    /// Static: it comes from the agent file and cannot change within a run,
    /// which is also what lets it sit in the cacheable head without breaking
    /// the stability order `context::law::interleaved` enforces.
    fn stability(&self) -> Stability {
        Stability::Static
    }
    /// Elided when absent — a goal nobody declared renders as nothing rather
    /// than as an empty heading — and never degraded when present: a finish
    /// line summarised down to its gist is a finish line nobody can observe.
    fn floor(&self) -> Fidelity {
        Fidelity::Elided
    }
    fn budget_priority(&self) -> u8 {
        1
    }
    fn render(&self) -> Vec<Part> {
        let mut said = Vec::new();
        if !self.outcome.trim().is_empty() {
            said.push(format!("OUTCOME — {}", self.outcome.trim()));
        }
        if !self.done_when.trim().is_empty() {
            said.push(format!("DONE WHEN — {}", self.done_when.trim()));
        }
        text(said.join("\n"))
    }
}
