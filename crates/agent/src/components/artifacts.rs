//! THE WORDS THE SHELF IS WRITTEN IN: what this group has produced, who each
//! piece is for, and whether anything confirmed it is there.
//!
//! It is not a `Component`. Artifacts are a FACULTY (`crate::faculty::artifact`),
//! which declares the block — id, slot, intent, stability — and
//! `components::Sensed` renders whatever a host most recently wrote for it.
//! What lives here is the VOCABULARY, in one place, exactly as `space_parts`
//! holds the space's (`crates/agent/src/components/space.rs:63`) and
//! `memory_parts` holds memory's.
//!
//! **NO DURABILITY SENTENCE HERE, AND NO `WorkspacePort` ON THE SENSE.** That
//! wording belongs to `components::space`, which renders whenever there IS a
//! folder to describe, and `crates/agent/src/environment/mod.rs:166-173` records
//! that a TEST decided that rather than an argument. One truth, one wording, one
//! place; a second copy of it here would be the drift that note exists to stop.

use context::{text, Part};

use crate::artifact::{Artifact, Shelf, SHELF_LIMIT, READ_ARTIFACT, RECORD_ARTIFACT};
use crate::toolbox::Toolbox;

/// The parts a host leaves in `AgentState.senses["artifacts"]` for
/// `components::Sensed` to render.
///
/// EMPTY when the shelf is empty, and that is the whole rule: emptiness becomes
/// `Fidelity::Elided` (`assemble` starts a partless section there,
/// `crates/context/src/assemble.rs:110`), so a group that has produced nothing
/// gets no heading and no blank section rather than a paragraph saying so.
/// Every capability may be absent (I15), and this is how the paper spells it.
///
/// `tools` is the agent's RESOLVED toolbox, and it is here for the reason
/// `space_parts` takes one: the closing line names calls by name, and a name
/// the agent was never granted advertises a capability that is not there — the
/// one failure I15 forbids. An agent holding neither call is told what is on
/// the shelf and offered nothing, which is the true description of its
/// situation.
pub fn artifact_parts(shelf: &Shelf, tools: &Toolbox) -> Vec<Part> {
    if shelf.items.is_empty() {
        return Vec::new();
    }
    let mut lines: Vec<String> = shelf.items.iter().take(SHELF_LIMIT).map(line).collect();
    // I16: a shelf that quietly showed twenty of twenty-five would be the paper
    // lying about what the group has. The count is the cheapest true sentence.
    if let Some(hidden) = shelf.items.len().checked_sub(SHELF_LIMIT).filter(|n| *n > 0) {
        lines.push(format!("…and {hidden} more on this shelf, not listed here."));
    }
    if let Some(closing) = offered(tools) {
        lines.push(closing);
    }
    text(lines.join("\n"))
}

/// One artifact, one line. The `uri` is not rendered: it is `artifact://<space>/
/// <name>` by construction and the space is already named one block up, so
/// printing it spends budget restating two things the model was just told.
///
/// `(unconfirmed)` is the gate this whole faculty's header argues for — the
/// port's real answer, or an honest note that nothing in the recording thread
/// could look. A size claimed for an artifact nobody measured is exactly the
/// sentence I16 exists to forbid.
fn line(artifact: &Artifact) -> String {
    let size = match artifact.bytes {
        Some(n) => format!("{n} bytes"),
        None => "unconfirmed".to_string(),
    };
    format!(
        "- {} ({}, rev {}, {size}) for {} — {} [by {}]",
        artifact.name,
        artifact.kind,
        artifact.revision,
        artifact.audience,
        artifact.description,
        artifact.by
    )
}

/// The closing line: only the calls this agent actually holds, and nothing at
/// all when it holds neither. A pair rather than a name alone because the clause
/// cannot be spelled out of the name — `components::space`'s `READERS` rule.
fn offered(tools: &Toolbox) -> Option<String> {
    let held: Vec<&str> = CALLS
        .iter()
        .filter(|(name, _)| tools.get(name).is_some())
        .map(|(_, clause)| *clause)
        .collect();
    match held.is_empty() {
        true => None,
        false => Some(held.join(" ")),
    }
}

const CALLS: [(&str, &str); 2] = [
    (READ_ARTIFACT, "read_artifact opens any of these by name."),
    (RECORD_ARTIFACT, "record_artifact puts one more on this shelf."),
];
