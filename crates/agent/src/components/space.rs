//! The shared space as a block of its own: the folder a group builds in, the
//! facts it has settled, and the notes it has left for each other.
//!
//! It used to be three paragraphs appended to `## environment` by
//! `now::environment`, built with `format!` and `push_str` in a file that is
//! not a component. That is the ad-hoc string building I13 forbids, and it was
//! a category error besides: a peer's note is SemiStatic and changes rarely,
//! the clock is Dynamic and can never be cached. Fused, the clock's
//! uncacheability infected the space and the space's bulk rode inside a block
//! the budget is told is small. Two things, two components, two slots.

use context::{text, Component, Fidelity, Part, Slot, Stability};
use kernel::SectionId;

use crate::space::Space;

/// The space this agent works in, as of the last time it was read from the
/// store. Named apart from [`Space`] on purpose: that type is the space's
/// *decisions and data*, this one is the paragraph the model reads.
///
/// `None` is an agent that works alone, and it renders NOTHING — no heading,
/// no apology. Emptiness is `Fidelity::Elided`, which is how the paper already
/// spells "absent".
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SharedSpace {
    pub space: Option<Space>,
}

impl SharedSpace {
    /// This block as flat text. For the tests that read what the model was
    /// shown — and it is empty exactly when there is no space, which is what
    /// makes the block vanish rather than head a blank one.
    pub fn text(&self) -> String {
        self.space.as_ref().map(lines).unwrap_or_default()
    }
}

impl Component for SharedSpace {
    fn id(&self) -> SectionId {
        SectionId("space".into())
    }
    fn slot(&self) -> Slot {
        Slot::SPACE
    }
    fn intent(&self) -> String {
        "The folder this group shares, what it has settled, what it has posted.".into()
    }
    /// SemiStatic, and slotted ahead of the clock for that reason. A group's
    /// facts change on the scale of a session, not of a turn, so the block
    /// belongs inside the cacheable head — above the one section that can
    /// never be cached rather than behind it.
    fn stability(&self) -> Stability {
        Stability::SemiStatic
    }
    /// Elided, and it has to be. An agent that named no space renders no
    /// parts, and `assemble` starts a partless section at `Fidelity::Elided`
    /// (`assemble.rs:97`) — which `law::validate` rejects as BelowFloor for
    /// anything whose floor is higher. A floor of `Summarized` here would make
    /// every spaceless agent's paper an illegal document, which is how this
    /// number was chosen rather than assumed.
    fn floor(&self) -> Fidelity {
        Fidelity::Elided
    }
    /// More durable than the transcript, less critical than the task.
    fn budget_priority(&self) -> u8 {
        4
    }
    fn render(&self) -> Vec<Part> {
        match self.text() {
            empty if empty.is_empty() => Vec::new(),
            block => text(block),
        }
    }
}

/// The space as CONTEXT lines (Python `Space.context`). Empty areas render
/// nothing at all: a `shared facts:` heading over no facts spends budget
/// saying that nothing has been settled.
fn lines(space: &Space) -> String {
    let mut out = format!(
        // WHAT THE MODEL IS TOLD MUST BE WHAT THE PERSON IS TOLD (26 walk).
        // This said "What you WRITE there survives a reload" — true of the
        // engine removed on 2026-08-18, and the exact opposite of what every
        // pane now tells the person reading the same folder.
        "space: {}\nworkspace: {} (a real folder in a Linux running in this browser; \
         observe says what the machine is and find_files searches it. That Linux keeps \
         its filesystem in memory, so nothing written there survives a reload, and \
         nothing start_process started is still running after one)",
        space.name,
        space.path()
    );
    if !space.facts.is_empty() {
        out.push_str("\nshared facts:");
        for (key, value) in &space.facts {
            out.push_str(&format!("\n  {key}: {value}"));
        }
    }
    if !space.notes.is_empty() {
        out.push_str("\nrecent notes:");
        for note in &space.notes {
            out.push_str(&format!("\n  {note}"));
        }
    }
    out
}
