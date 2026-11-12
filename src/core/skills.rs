//! # Skills: the port to the skills on disk
//!
//! A message can name a skill with `$`. Where skills are, and how one is read, is the host's
//! business (`host/skills.rs` on the server). The core only asks; with no host behind it there
//! are none.
use std::sync::OnceLock;

/// One skill: its name, what its head says it is for, and where its `SKILL.md` is.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Found {
    pub name: String,
    pub about: String,
    pub file: String,
}

/// Who finds the skills for a workspace at a root (none: only the owner's).
pub type Finder = fn(Option<&str>) -> Vec<Found>;

static FINDER: OnceLock<Finder> = OnceLock::new();

/// Name who finds skills in this build. The first call wins.
pub fn set(f: Finder) {
    let _ = FINDER.set(f);
}

/// The skills for a workspace at `root`; none where no host finds them.
pub fn find(root: Option<&str>) -> Vec<Found> {
    FINDER.get().map(|f| f(root)).unwrap_or_default()
}
