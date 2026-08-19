//! THE WORDS THE SPACE IS WRITTEN IN: the folder a group builds in, the facts
//! it has settled, and the notes it has left for each other.
//!
//! It used to be three paragraphs appended to `## environment` by
//! `now::environment`, built with `format!` and `push_str` in a file that is
//! not a component. That is the ad-hoc string building I13 forbids, and it was
//! a category error besides: a peer's note is SemiStatic and changes rarely,
//! the clock is Dynamic and can never be cached. Fused, the clock's
//! uncacheability infected the space and the space's bulk rode inside a block
//! the budget is told is small. Two things, two components, two slots.
//!
//! It is no longer a `Component`. The space is a FACULTY now
//! (`crate::faculty::space`), which declares the block — id, slot, intent,
//! stability — and `components::Sensed` renders whatever a host wrote for it.
//! What could not move is this file's VOCABULARY: [`lines`] is the exact
//! wording the model reads, and it stays in one place, reached through
//! [`space_parts`]. Splitting the declaration from the wording is the whole
//! point of the seam — a browser faculty declares its own block and writes its
//! own words, and neither has to touch the other.

use context::{text, Part};

use crate::space::Space;

/// The space this agent works in, as of the last time it was read from the
/// store. Named apart from [`Space`] on purpose: that type is the space's
/// *decisions and data*, this one is the paragraph the model reads.
///
/// It is kept as a NAMED VIEW rather than deleted because `tests/space.rs`
/// reads the block through it — the one place that asks "what was the model
/// actually shown about this space", which is a question worth a name.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SharedSpace {
    pub space: Option<Space>,
}

impl SharedSpace {
    /// This block as flat text. Empty exactly when there is no space, which is
    /// what makes the block vanish rather than head a blank one.
    pub fn text(&self) -> String {
        self.space.as_ref().map(lines).unwrap_or_default()
    }
}

/// The space as the PARTS a host leaves in `AgentState.senses["space"]` for
/// `components::Sensed` to render.
///
/// `None` is an agent that works alone and it yields NOTHING — no heading, no
/// apology. Emptiness becomes `Fidelity::Elided` (`assemble` starts a partless
/// section there, `crates/context/src/assemble.rs:110`), which is how the
/// paper already spells "absent".
pub fn space_parts(space: &Option<Space>) -> Vec<Part> {
    text(SharedSpace { space: space.clone() }.text())
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
