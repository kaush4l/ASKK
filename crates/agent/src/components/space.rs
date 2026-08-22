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
use crate::toolbox::Toolbox;

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
    /// WHAT THIS AGENT MAY ACTUALLY DO IN THAT FOLDER (I15). The paragraph
    /// below names tools by name, and a name here that the agent was never
    /// granted is the environment advertising a capability that is not there —
    /// which is the one failure this product may not ship. So the wording is
    /// DERIVED from the resolved toolbox rather than written once for the
    /// best-equipped agent and shown to every other one.
    pub tools: Toolbox,
}

impl SharedSpace {
    /// This block as flat text. Empty exactly when there is no space, which is
    /// what makes the block vanish rather than head a blank one.
    pub fn text(&self) -> String {
        self.space.as_ref().map(|s| lines(s, &self.tools)).unwrap_or_default()
    }
}

/// The space as the PARTS a host leaves in `AgentState.senses["space"]` for
/// `components::Sensed` to render.
///
/// `None` is an agent that works alone and it yields NOTHING — no heading, no
/// apology. Emptiness becomes `Fidelity::Elided` (`assemble` starts a partless
/// section there, `crates/context/src/assemble.rs:110`), which is how the
/// paper already spells "absent".
///
/// `tools` is the agent's RESOLVED toolbox (`AgentState.toolbox`), because the
/// folder reads differently to an agent that can search it and one that cannot.
pub fn space_parts(space: &Option<Space>, tools: &Toolbox) -> Vec<Part> {
    text(SharedSpace { space: space.clone(), tools: tools.clone() }.text())
}

/// The space as CONTEXT lines (Python `Space.context`). Empty areas render
/// nothing at all: a `shared facts:` heading over no facts spends budget
/// saying that nothing has been settled.
fn lines(space: &Space, tools: &Toolbox) -> String {
    let mut out = format!(
        "space: {}\nworkspace: {} ({})",
        space.name,
        space.path(),
        folder(tools)
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

/// The parenthesis after the path: what the folder IS, and only the tools this
/// agent actually holds for it.
///
/// TWO SENTENCES, TWO KINDS OF FACT. The first names capability and is earned
/// tool by tool — an agent granted neither reader is told about a folder it can
/// see the state of and not act on, which is the true description of its
/// situation (I15). The second is a property of the SUBSTRATE and is said to
/// everyone, because it is true whether or not anything can write there.
///
/// WHAT THE MODEL IS TOLD MUST BE WHAT THE PERSON IS TOLD (26 walk). That
/// second sentence once said "What you WRITE there survives a reload" — true of
/// the engine removed on 2026-08-18, and the exact opposite of what every pane
/// now tells the person reading the same folder. It is the one clause here that
/// no grant may take away.
fn folder(tools: &Toolbox) -> String {
    let held: Vec<&str> = READERS
        .iter()
        .filter(|(name, _)| tools.get(name).is_some())
        .map(|(_, clause)| *clause)
        .collect();
    let reading = match held.is_empty() {
        true => String::new(),
        false => format!("; {}", held.join(" and ")),
    };
    // THE SUBSTRATE SENTENCE LIVES HERE AND NOWHERE ELSE, and which of the two
    // places was chosen is a fact a test settled rather than an argument.
    // `environment::facts` is a function of the TOOLBOX, so it renders nothing
    // for an agent that has a folder and no workspace tools — the shipped
    // `critic` exactly — and putting the sentence there described that agent's
    // folder without its one important property. This block renders whenever
    // there IS a folder to describe, which is precisely when the fact applies.
    // One truth, one wording, one place: `is_loopback`'s rule, one component over.
    let started = match tools.get("start_process").is_some() {
        true => ", and nothing start_process started is still running after one",
        false => "",
    };
    format!(
        "a real folder in a Linux running in this browser{reading}. That Linux {}, \
         so nothing written there survives a reload{started}",
        crate::environment::MEMORY
    )
}

/// The tools that let an agent LOOK at the folder, each with the clause that
/// says so. A pair rather than a name alone because the clause cannot be spelled
/// out of the name, and a list rather than two `if`s so the joining reads once.
const READERS: [(&str, &str); 2] = [
    ("observe", "observe says what the machine is"),
    ("find_files", "find_files searches it"),
];
