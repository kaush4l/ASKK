//! What is true right now: the clock and space, the task, the last results.

use context::{text, Component, Fidelity, Part, Slot, Stability};
use kernel::SectionId;

/// Time, locale, device — what is available right now.
///
/// The one component that is never cached. A cached clock is a wrong clock:
/// reusing it would hand the model a confident statement about a moment that
/// has already passed. The shared space is NOT in here; it is a FACULTY's
/// block now, declared at `Slot::SPACE` by `crate::faculty::space` and
/// rendered by `Sensed`, because a peer's note changes rarely and this changes
/// every call, and fusing them made the space uncacheable and this one bulky.
/// WHAT IS AVAILABLE RIGHT NOW INCLUDES THE COMPUTER (I16, T48). The clock is
/// `text`; `guest` is what `crate::environment` declares about the Linux this
/// browser runs commands in, already rendered for the grant this stage holds.
/// It is EMPTY for an agent that holds no workspace tool, which is how an
/// agent with nothing to run is told nothing about a shell (I15).
///
/// The two arrive as separate fields rather than one pre-joined string because
/// they have different lifetimes and different authors: the clock is rebuilt
/// from the injected timestamp every call, the guest is a property of a frozen
/// image. Joining them here is the component's own job, which is the only
/// place I13 allows a prompt's bytes to be decided.
///
/// The guest lines never repeat the workspace PATH. `## space` renders that
/// path, five slots above, and one fact in two blocks is two things to keep in
/// agreement — so these sentences say "your space's folder" and let the block
/// that owns the path own it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct Environment {
    pub text: String,
    pub guest: String,
}

impl Component for Environment {
    fn id(&self) -> SectionId {
        SectionId("environment".into())
    }
    fn slot(&self) -> Slot {
        Slot::ENVIRONMENT
    }
    fn intent(&self) -> String {
        "Time, locale, device, what is available right now.".into()
    }
    fn stability(&self) -> Stability {
        Stability::Dynamic
    }
    fn floor(&self) -> Fidelity {
        Fidelity::Elided
    }
    fn budget_priority(&self) -> u8 {
        5
    }
    fn cacheable(&self) -> bool {
        false
    }
    fn render(&self) -> Vec<Part> {
        let clock = match self.text.trim().is_empty() {
            true => "A browser tab; environment sensing not yet implemented.",
            false => self.text.trim_end(),
        };
        match self.guest.trim().is_empty() {
            true => text(clock),
            false => text(&format!("{clock}\n{}", self.guest.trim_end())),
        }
    }
}

/// What is being attempted. Kept apart from the transcript on purpose: the
/// request the model is serving should not have to be re-derived by reading
/// the conversation back, and it must survive the compaction that eventually
/// eats the turn it arrived in.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct Task {
    pub text: String,
}

impl Component for Task {
    fn id(&self) -> SectionId {
        SectionId("task".into())
    }
    fn slot(&self) -> Slot {
        Slot::TASK
    }
    fn intent(&self) -> String {
        "What is being attempted.".into()
    }
    fn stability(&self) -> Stability {
        Stability::Dynamic
    }
    fn floor(&self) -> Fidelity {
        Fidelity::Summarized
    }
    fn budget_priority(&self) -> u8 {
        2
    }
    fn cacheable(&self) -> bool {
        false
    }
    fn render(&self) -> Vec<Part> {
        match self.text.trim().is_empty() {
            true => text("Idle; awaiting a task."),
            false => text(self.text.trim_end()),
        }
    }
}

/// Results of the last actions — the most volatile block, and last before the
/// response contract, so a tool result is the freshest thing the model read.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct Observations {
    pub lines: Vec<String>,
}

impl Component for Observations {
    fn id(&self) -> SectionId {
        SectionId("observations".into())
    }
    fn slot(&self) -> Slot {
        Slot::OBSERVATIONS
    }
    fn intent(&self) -> String {
        "Results of the last actions.".into()
    }
    fn stability(&self) -> Stability {
        Stability::Volatile
    }
    fn floor(&self) -> Fidelity {
        Fidelity::Elided
    }
    fn budget_priority(&self) -> u8 {
        7
    }
    fn cacheable(&self) -> bool {
        false
    }
    fn render(&self) -> Vec<Part> {
        match self.lines.is_empty() {
            true => text("No actions taken yet."),
            false => text(self.lines.join("\n")),
        }
    }
}
