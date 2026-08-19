//! Spaces (Python `core/space.py`): a folder agents build in, and the state
//! they share while doing it. Pure — this file holds the space's *decisions*;
//! the bytes are moved by `core::space` through the store, because in a
//! browser "the same object for every agent" cannot be an object at all.
//!
//! That is the one place the port is not a transliteration. The Python hands
//! every agent naming `research` the SAME `Space` instance and locks each
//! mutation; here every agent is a Worker with its own Wasm instance and no
//! shared memory (ADR-008), so the shared thing has to be somewhere both can
//! see: one IndexedDB database, one key per fact and one per note, read fresh
//! before every model call the way the clock is. Every mutation is therefore
//! ONE store operation — there is no half of a single put, which is the
//! property the Python's tmp-then-`replace` buys.

use serde::{Deserialize, Serialize};

use crate::tools::Tool;

/// Newest kept; older notes fall off rather than grow the prompt forever
/// (Python `NOTE_LIMIT`).
pub const NOTE_LIMIT: usize = 20;

/// One shared space: a workspace path, some settled facts, and a noticeboard.
/// Facts are a `Vec` rather than a map so the whole thing stays `Eq` and
/// serializable inside `AgentState` — order is the store's key order.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Space {
    pub name: String,
    pub facts: Vec<(String, String)>,
    pub notes: Vec<String>,
}

/// What a mutation asks the store to do. The pure half decides; `core::space`
/// performs it, and there is exactly one operation per call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Change {
    Fact { key: String, value: String },
    Forget { key: String },
    Note { line: String },
}

impl Space {
    /// The space called `name`, or `None` if that is not a usable name.
    ///
    /// A space name becomes a directory name, so it may only be a name — no
    /// slashes, no dots, nothing that could walk out of `spaces/` and write
    /// somewhere else (Python `NAME_PATTERN`). A stray space around it is
    /// trimmed, so `" research "` and `"research"` are one space and not two.
    pub fn named(name: &str) -> Option<Space> {
        let name = name.trim();
        let usable = !name.is_empty()
            && name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
        usable.then(|| Space {
            name: name.to_string(),
            facts: Vec::new(),
            notes: Vec::new(),
        })
    }

    /// The folder this space's agents share, in the workspace's own Linux. It
    /// is under `/root` because that is where the image puts a home; the model
    /// never writes it — it names files relative to it, and the grant supplies
    /// the root (I6).
    pub fn path(&self) -> String {
        format!("/root/spaces/{}", self.name)
    }

    /// Settle a fact. Writing the same key again REPLACES it — a space that
    /// held two values for one key would put both in every agent's prompt and
    /// let the model pick.
    pub fn remember(&mut self, key: &str, value: &str) -> (String, Option<Change>) {
        let (key, value) = (key.trim().to_string(), value.trim().to_string());
        if key.is_empty() {
            return ("Nothing recorded: a fact needs a key.".into(), None);
        }
        match self.facts.iter_mut().find(|(k, _)| *k == key) {
            Some(slot) => slot.1 = value.clone(),
            None => self.facts.push((key.clone(), value.clone())),
        }
        (
            format!("Recorded in the {} space: {key} = {value}", self.name),
            Some(Change::Fact { key, value }),
        )
    }

    /// Remove a fact that is no longer true, and say plainly when there was
    /// nothing to remove: a silent success leaves the agent believing it
    /// corrected something.
    pub fn forget(&mut self, key: &str) -> (String, Option<Change>) {
        let key = key.trim().to_string();
        let Some(at) = self.facts.iter().position(|(k, _)| *k == key) else {
            let known: Vec<&str> = self.facts.iter().map(|(k, _)| k.as_str()).collect();
            let known = match known.is_empty() {
                true => "nothing".to_string(),
                false => known.join(", "),
            };
            return (
                format!("No fact called '{key}'. The space holds: {known}"),
                None,
            );
        };
        self.facts.remove(at);
        (
            format!("Removed '{key}' from the {} space.", self.name),
            Some(Change::Forget { key }),
        )
    }

    /// Leave the group a note, prefixed with its author. One line: the board
    /// is read inside a prompt. The newest `NOTE_LIMIT` are kept.
    pub fn post(&mut self, author: &str, note: &str) -> (String, Option<Change>) {
        let note = note.split_whitespace().collect::<Vec<_>>().join(" ");
        if note.is_empty() {
            return ("Nothing posted: the note was empty.".into(), None);
        }
        let line = format!("[{author}] {note}");
        // The same note twice is one fact: the board is read inside every
        // agent's prompt (09 walk). Told plainly, so nobody thinks it landed.
        if self.notes.contains(&line) {
            return (
                format!("That note is already on the {} board.", self.name),
                None,
            );
        }
        self.notes.push(line.clone());
        self.trim();
        (
            format!(
                "Posted to the {} space. Everyone working here will see it.",
                self.name
            ),
            Some(Change::Note { line }),
        )
    }

    /// Keep the newest `NOTE_LIMIT` notes and drop the rest. Applied on read
    /// as well as on write: a reader that found 21 keys mid-trim must still
    /// see a space of the size the rule promises.
    pub fn trim(&mut self) {
        let over = self.notes.len().saturating_sub(NOTE_LIMIT);
        self.notes.drain(..over);
    }
}

/// The three tools a space brings with it (Python `Space.tools_for`). The
/// AUTHOR is not an argument: the Python closes over the agent's name so a
/// note says who left it, and here the same binding happens where the tool
/// runs — the caller is the process, which cannot be misreported by a model.
pub fn space_tools() -> Vec<Tool> {
    vec![
        Tool::new(
            "remember",
            "Record a fact in the shared space, for every agent working here to see.",
            &["key", "value"],
        ),
        Tool::new(
            "forget",
            "Remove a fact from the shared space once it is no longer true.",
            &["key"],
        ),
        Tool::new(
            "post_note",
            "Leave a note for the other agents working in this space.",
            &["note"],
        ),
    ]
}

/// Whether this tool name is one of the space's own.
pub fn is_space_tool(name: &str) -> bool {
    matches!(name, "remember" | "forget" | "post_note")
}
