//! # Capabilities: what this build can do, said by the build itself
//!
//! One source makes several builds (a server, a Mac app, a page that runs wholly in a browser
//! tab). They differ only in which ports a host fills. So "what can this build do?" is not a
//! table kept by hand: a host notes here each thing it provides ([`provided`]), right beside
//! the line where it fills the port, and anyone may ask for the whole list ([`all`]).
//!
//! A capability that is missing is not an error. Its line says what the app does without it,
//! so a person sees the limit before running into it.
//!
//! | name | the port | without it |
//! | --- | --- | --- |
//! | `store` | `core/store.rs` | state is kept in memory and lost when the app stops |
//! | `engines` | `core/world.rs` | no engine is booted |
//! | `background` | `core/tasks.rs` | an engine runs only while someone waits for it |
//! | `files` | `core/files.rs` | no project files can be read or written |
//! | `senses` | `core/media.rs` | attached images, sound and video are not understood |
//! | `tables` | `core/tables.rs` | a figure cannot take numbers from the user's files |
//! | `code` | `core/code.rs` | an engine cannot run a program it wrote |
use super::held::Held;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Mutex;

/// One line of the answer.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Cap {
    pub name: String,
    /// True: this build has it.
    pub here: bool,
    /// With it: who provides it (`a folder on this machine`). Without it: what that means.
    pub note: String,
}

/// Every capability the core knows, with what its absence means.
const KNOWN: &[(&str, &str)] = &[
    ("store", "state is kept in memory and lost when the app stops"),
    ("engines", "no engine is booted"),
    ("background", "an engine runs only while someone waits for it"),
    ("files", "no project files can be read or written"),
    ("senses", "attached images, sound and video are not understood"),
    ("tables", "a figure cannot take numbers from the user's own files"),
    ("code", "an engine cannot run a program it wrote"),
];

/// What has been provided: name → by whom. Names outside [`KNOWN`] are a host's extras.
static GIVEN: Mutex<BTreeMap<String, String>> = Mutex::new(BTreeMap::new());

/// Note that this build has `name`, provided `by` (a few words a person can read).
pub fn provided(name: &str, by: &str) {
    GIVEN.held().insert(name.into(), by.into());
}

/// The whole list: the known capabilities in their order, then the host's extras by name.
pub fn all() -> Vec<Cap> {
    let given = GIVEN.held().clone();
    let known = KNOWN.iter().map(|(name, without)| match given.get(*name) {
        Some(by) => Cap { name: name.to_string(), here: true, note: by.clone() },
        None => Cap { name: name.to_string(), here: false, note: without.to_string() },
    });
    let extras = given.iter().filter(|(n, _)| !KNOWN.iter().any(|(k, _)| k == n)).map(|(n, by)| Cap { name: n.clone(), here: true, note: by.clone() });
    known.chain(extras).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_capability_says_what_it_means_and_a_provided_one_says_by_whom() {
        provided("test-extra", "a test");
        let caps = all();
        assert_eq!(caps.iter().take(KNOWN.len()).map(|c| c.name.as_str()).collect::<Vec<_>>(), KNOWN.iter().map(|(n, _)| *n).collect::<Vec<_>>(), "known ones first, in order");
        assert!(caps.iter().all(|c| !c.note.is_empty()), "every line explains itself");
        assert!(caps.iter().any(|c| c.name == "test-extra" && c.here && c.note == "a test"));
    }
}
