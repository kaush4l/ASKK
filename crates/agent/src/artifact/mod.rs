//! AN ARTIFACT: a thing this group produced that outlives the turn that made
//! it — named, described, addressed, and readable by an agent in another
//! thread. Pure: this file holds the shelf's *decisions*; the bytes are moved
//! by `core::space::artifact` through the spaces store and the workspace port,
//! exactly as `crate::space` splits from `core::space` (I3, I7).
//!
//! It is a FILE IN THE SPACE'S WORKSPACE plus a RECORD IN THE SPACE'S STORE,
//! and the split is the whole design. The file is where the work is; the record
//! is what every agent in the space can see without reading it. `name` is both
//! halves at once — the workspace-relative path of the file AND the key the
//! record lives under (`space/<space>/a/<name>`) — so there is one name for one
//! thing and nothing to keep in step.
//!
//! ## THE CROSS-THREAD DECISION, WRITTEN HERE BECAUSE THE CRITERION ASKED FOR IT
//!
//! `crates/adapters_web/src/worker/world.rs:52-58` hands a sub-agent's Worker
//! the same `C2wWorkspace` the page has, and it REFUSES there in words: the
//! workspace runs in the page, not in an agent's Worker. So a `record_artifact`
//! call made inside a Worker cannot look at the file it is recording, and the
//! existence check is dead in every thread but the page's.
//!
//! The criterion offered two ways out — store the artifact's TEXT beside the
//! record, or GATE THE WORDS on what the port actually answered. **This takes
//! the second.** Storing the text would put a second copy of every deliverable
//! in IndexedDB that can disagree with the file, and would give `read_artifact`
//! two sources to choose between — which is precisely the "no second file
//! reader" the same criterion forbids one line above. Gating costs one field:
//!
//! - [`Artifact::bytes`] is `Some(n)` ONLY when a port in the recording thread
//!   really read the file and counted it. It is `None` when the port refused to
//!   answer at all, and the catalog then says `(unconfirmed)` rather than
//!   claiming a size nobody measured. A record with `None` is not a lie about a
//!   file; it is an honest note that this thread could not look.
//! - A port that DID answer and said the file is not there is a REFUSAL, not a
//!   record. The difference between "no" and "I cannot see" is the whole reason
//!   the host reads a `Result` and this half reads an `Option`.
//!
//! I16 in one field: the truth the system holds — whether anything confirmed
//! this file — is stated rather than assumed, and the sentence is gated on the
//! port's real answer rather than written once for the thread that has one.

use serde::{Deserialize, Serialize};

mod tools;

pub use tools::{artifact_tools, is_artifact_tool, READ_ARTIFACT, RECORD_ARTIFACT};

/// The faculty's name, which is also its block's id and the key a host writes
/// its rendered parts under in `AgentState.senses`. One string, three jobs, so
/// they cannot drift apart — `space` and `memory`'s rule, unchanged.
pub const ARTIFACTS_FACULTY: &str = "artifacts";

/// HOW MANY ARTIFACTS THE PROMPT MAY NAME. A RENDER cap and not a store cap,
/// and the difference is deliberate: the registry is keyed by NAME
/// (`space/<space>/a/<name>`) so that re-recording replaces in place, which
/// means key order is alphabetical and there is no "oldest" to evict. Deleting
/// the 21st artifact because the paper is small would destroy a deliverable to
/// save a line of prompt.
///
/// So the shelf keeps everything and the BLOCK shows this many, saying how many
/// it did not show (I16 — a shelf that quietly truncated would be the paper
/// lying about what the group has). `crates/agent/tests/artifact.rs` pins what a
/// full one costs, so the number has a measurement behind it.
pub const SHELF_LIMIT: usize = 20;

/// One artifact: what it is, who it is for, and whether anyone confirmed it.
/// `Eq` and serializable for the reason `Space` is: it rides in state (I11).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Artifact {
    /// Its address, `artifact://<space>/<name>`. Assigned by [`Shelf::record`]
    /// from the space and the name, never by the model: an identity a caller
    /// could write is an identity two callers can collide on.
    pub uri: String,
    /// The workspace-relative path of the file, and the key its record lives
    /// under. One name for one thing (see this module's header).
    pub name: String,
    /// What KIND of thing it is, in the model's own words — report, dataset,
    /// patch. Defaulted, not refused: see [`Shelf::record`].
    pub kind: String,
    /// What it is, in one line. Required, and refused when blank.
    pub description: String,
    /// Who it is for. Defaulted rather than refused: see [`Shelf::record`].
    pub audience: String,
    /// 1 the first time this name is recorded, and one more each time it is
    /// recorded again. The record REPLACES; the number is what says it moved.
    pub revision: u32,
    /// The agent that recorded it — the process, taken where the tool runs,
    /// never an argument a model could write as somebody else's name (the rule
    /// `Space::post`'s author already follows).
    pub by: String,
    /// THE PORT'S REAL ANSWER, and the field this module's header is about.
    /// `Some(n)` only when a workspace in the recording thread read the file and
    /// counted it; `None` when no workspace there would answer.
    pub bytes: Option<u64>,
}

/// Everything one space has produced. A single-`Vec` struct, the shape
/// `agent::Memory` already has, so the lookup has one home.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Shelf {
    pub items: Vec<Artifact>,
}

impl Shelf {
    /// Put one artifact on the shelf, or say plainly why nothing was recorded.
    ///
    /// `draft` arrives with the four fields a model wrote and the one the port
    /// answered; this assigns the three it may not — `uri`, `revision`, `by`.
    ///
    /// TWO FIELDS ARE REQUIRED AND TWO ARE DEFAULTED, which is a ruling and not
    /// an oversight. Without a `name` there is no file and no key; without a
    /// `description` the entry is a filename in a list, which every agent
    /// reading the block could already have got from `list_files`. `kind` and
    /// `audience` sharpen an entry and no reader is stuck without them, so a
    /// blank one takes a plain word rather than costing the model a round trip.
    pub fn record(&mut self, space: &str, by: &str, draft: Artifact) -> (String, Option<Artifact>) {
        let name = draft.name.trim().to_string();
        if name.is_empty() {
            return (NO_NAME.into(), None);
        }
        if draft.description.trim().is_empty() {
            return (
                format!(
                    "Nothing recorded about '{name}': an artifact needs a description. A name \
                     on its own tells the others nothing list_files could not."
                ),
                None,
            );
        }
        let artifact = Artifact {
            uri: format!("artifact://{space}/{name}"),
            kind: plain(&draft.kind, "file"),
            description: draft.description.trim().to_string(),
            audience: plain(&draft.audience, "anyone working in this space"),
            revision: self.find(&name).map(|a| a.revision + 1).unwrap_or(1),
            by: by.to_string(),
            name,
            bytes: draft.bytes,
        };
        match self.items.iter().position(|a| a.name == artifact.name) {
            Some(at) => self.items[at] = artifact.clone(),
            None => self.items.push(artifact.clone()),
        }
        (said(&artifact, space), Some(artifact))
    }

    /// The artifact of this name, or `None`. The one lookup, so the block, the
    /// reader and the revision counter agree about what "already there" means.
    pub fn find(&self, name: &str) -> Option<&Artifact> {
        let name = name.trim();
        self.items.iter().find(|a| a.name == name)
    }

    /// Every name on the shelf, for a refusal that has to say what IS here —
    /// `Memory::discard`'s discipline, and for its reason: the model's next move
    /// after a miss is to guess the wording, and this is the wording.
    pub fn names(&self) -> String {
        match self.items.is_empty() {
            true => "nothing".to_string(),
            false => {
                self.items.iter().map(|a| a.name.as_str()).collect::<Vec<_>>().join(", ")
            }
        }
    }
}

/// The refusal a nameless call gets, ending in the line the model should have
/// written — every refusal in this tree does (`gate::files::shape`).
const NO_NAME: &str = "Nothing recorded: an artifact needs a name — the path of the file in \
                       your workspace folder. Call it as record_artifact({\"name\": \
                       \"report.md\", \"description\": \"what it is\"}).";

/// A blank field takes a plain word. Trimmed first, because " " is blank.
fn plain(said: &str, fallback: &str) -> String {
    match said.trim() {
        "" => fallback.to_string(),
        given => given.to_string(),
    }
}

/// What the recording agent is told. It states the REVISION, because recording
/// the same name twice replaces the record, and an agent that thought it had
/// added a second artifact would go looking for one that is not there.
fn said(artifact: &Artifact, space: &str) -> String {
    let known = match artifact.bytes {
        Some(n) => format!("{n} bytes"),
        // The header's decision, said out loud to the agent that made the call:
        // no workspace answered here, so nothing confirmed the file.
        None => "size unconfirmed — no workspace answered in this thread".to_string(),
    };
    let opening = match artifact.revision {
        1 => "On the shelf".to_string(),
        n => format!("Revision {n}"),
    };
    format!(
        "{opening}: {} ({known}). Every agent in the {space} space sees it in their \
         ## artifacts block from their next reply onward.",
        artifact.uri
    )
}
