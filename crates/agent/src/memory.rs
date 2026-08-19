//! MEMORY: one agent's OWN durable lines — what it chose to keep, read back to
//! it before every model call, surviving this conversation being compacted and
//! surviving a reload. Pure: this file holds memory's *decisions*; the bytes
//! are moved by the host through the store, exactly as `crate::space` splits
//! from `core::space` (I3, I7).
//!
//! It is NOT a private corner of the shared space, and the three differences
//! are the reason it is a faculty of its own rather than three more tools on
//! `space`:
//!
//! 1. **It needs no space.** The space faculty is declared only when
//!    `Space::named` resolves (`crate::faculty::declared`), so an agent that
//!    names no space has nowhere at all to keep anything. Memory is declared by
//!    writing its name and nothing else. (The shipped `main` is NOT that agent
//!    — it names `space: research` — so this distinction is the one reason for
//!    the faculty that its own first user does not demonstrate.)
//! 2. **It is PRIVATE to one agent.** A space is shared by everyone who names
//!    it, and its noticeboard is read inside every one of their prompts. These
//!    lines are read inside exactly one.
//! 3. **It brings no workspace with it.** Naming a space drags the whole
//!    Linux toolset along, because the folder is the space's (ADR-006, default
//!    deny). Memory brings two tools and its own block — nothing else.
//!
//! That hole was already named twice in the shipped product, which is the
//! argument for building this rather than something more impressive. The
//! `main` agent file told the model "The space is what the *group* needs, not
//! a diary" and then offered nowhere to put a diary; that sentence now ends by
//! naming this faculty (`public/agents/main/agent.md:162`). And `Slot::MEMORY`
//! — "Retained knowledge across sessions" — had sat in
//! `crates/context/src/slot.rs:47` with no component filling it. This is the
//! component; the slot number is not new and neither is the need.

use serde::{Deserialize, Serialize};

use crate::tools::Tool;

/// Newest kept; older lines fall off rather than grow every prompt forever.
/// The same rule and the same number as the space's `NOTE_LIMIT`, because both
/// are read inside a prompt and neither may become the prompt.
pub const MEMORY_LIMIT: usize = 20;

/// One agent's own kept lines, in the order they were kept. A `Vec` rather
/// than a set so the whole thing stays `Eq` and serializable inside
/// `AgentState`, and so "oldest" is a question that has an answer (see
/// [`Memory::trim`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Memory {
    pub notes: Vec<String>,
}

/// What a mutation asks the store to do. The pure half decides; the host
/// performs it, and there is exactly one operation per call — there is no half
/// of a single put.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Kept {
    Line { line: String },
    Dropped { line: String },
}

impl Memory {
    /// Keep one line. Collapsed to a single line because it is read inside a
    /// prompt, the same rule `Space::post` follows.
    ///
    /// Both refusals are SPOKEN. A silent success on an empty note or on a
    /// line already held leaves the agent believing it wrote something new,
    /// and it will spend the next turn acting on a memory that is not there.
    pub fn keep(&mut self, note: &str) -> (String, Option<Kept>) {
        let line = note.split_whitespace().collect::<Vec<_>>().join(" ");
        if line.is_empty() {
            return ("Nothing kept: the note was empty.".into(), None);
        }
        if self.notes.contains(&line) {
            return ("That line is already in your memory.".into(), None);
        }
        self.notes.push(line.clone());
        self.trim();
        (
            "Kept. You will see this in your ## memory block from your next reply onward.".into(),
            Some(Kept::Line { line }),
        )
    }

    /// Drop a line that stopped being true, and say plainly when there was
    /// nothing to drop — naming what IS held, because the model's next move
    /// after a failed removal is to guess the wording, and this is the wording.
    pub fn discard(&mut self, note: &str) -> (String, Option<Kept>) {
        let line = note.split_whitespace().collect::<Vec<_>>().join(" ");
        let Some(at) = self.notes.iter().position(|n| *n == line) else {
            let held = match self.notes.is_empty() {
                true => "nothing".to_string(),
                false => self.notes.join(", "),
            };
            return (
                format!("Nothing called that in your memory. It holds: {held}"),
                None,
            );
        };
        self.notes.remove(at);
        (
            "Discarded. It will not be in your ## memory block from your next reply onward."
                .into(),
            Some(Kept::Dropped { line }),
        )
    }

    /// Keep the newest `MEMORY_LIMIT` lines and drop the rest. Applied on read
    /// as well as on write: a reader that found 21 keys mid-trim must still see
    /// a memory of the size the rule promises.
    pub fn trim(&mut self) {
        let over = self.notes.len().saturating_sub(MEMORY_LIMIT);
        self.notes.drain(..over);
    }
}

/// The two tools memory brings with it, and nothing else — no workspace, no
/// shell, no folder (ADR-006). The descriptions are written for a 12B model:
/// they say what the capability IS and what it is FOR, and they claim exactly
/// what the store delivers and no more, because a tool description that
/// overstates a boundary is the worst place in the product to be wrong.
pub fn memory_tools() -> Vec<Tool> {
    vec![
        Tool::new(
            "keep",
            "Keep one line in your own memory. It is yours alone, it survives this conversation \
             being shortened and it survives a reload, and it is read back to you before every \
             reply. Use it for something about this person or this work you would otherwise have \
             to be told again.",
            &["note"],
        ),
        Tool::new(
            "discard",
            "Remove one line from your own memory, word for word as it appears in your ## memory \
             block. Use it when what you kept stopped being true.",
            &["note"],
        ),
    ]
}

/// Whether this tool name is one of memory's own.
pub fn is_memory_tool(name: &str) -> bool {
    matches!(name, "keep" | "discard")
}
