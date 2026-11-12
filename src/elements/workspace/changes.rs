//! # What a run changed in the workspace
//!
//! A run can change files in two ways: through the workspace's own tools (`write_file`,
//! `edit_file`), and through programs it runs (`run`, `spawn`, a job). The tools say which file
//! they are about to change, so its text is noted then. A program says nothing, so when a run
//! begins the workspace's text files are read once ([`Watch`]), and when it ends they are
//! compared with what is there now.
//!
//! | question | answer |
//! | --- | --- |
//! | which files are read at the start? | the visible ones (the workspace's `exclude`, and always `.git/`, `target/`, `node_modules/`), text only (UTF-8, no NUL), each at most [`MAX_FILE`] bytes, at most [`MAX_WATCH`] bytes in all |
//! | where is that held? | in memory, for the length of the run |
//! | what is kept after? | the run, and each changed file as it was before ([`Last`]), in the store under the engine's key, so a restart still shows it; at most [`MAX_KEPT`] bytes of earlier text |
//! | a run that changes nothing? | the last run that did stays in sight |
//! | a file a program removed? | shown as gone |
//!
//! A program that writes after its run has ended (a job left running) is seen by the next run
//! that ends.
use crate::core::held::Held;
use crate::core::store::{self, join};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

/// The largest file read at the start of a run, in bytes.
pub const MAX_FILE: u64 = 256 * 1024;
/// The most bytes read at the start of a run, in all.
pub const MAX_WATCH: usize = 16 * 1024 * 1024;
/// The most bytes of earlier text kept in the store for the last run that changed files.
pub const MAX_KEPT: usize = 2 * 1024 * 1024;
/// Folders never read, whatever the workspace excludes.
const NEVER: [&str; 3] = [".git/", "target/", "node_modules/"];
/// Where the last changes are kept, under the engine's key.
const KEPT: &str = "workspace-changes.json";

/// A run going now: the files as they were when it began, and those its tools changed first.
#[derive(Default)]
struct Watch {
    run: u64,
    /// Every text file read at the start, by path.
    start: BTreeMap<String, String>,
    /// Every visible file there was at the start, read or not (too long, not text).
    seen: std::collections::BTreeSet<String>,
    /// Files the tools changed, each as it was just before (`None`: it did not exist).
    touched: BTreeMap<String, Option<String>>,
}

/// The last run of an engine that changed files, and each changed file as it was before it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Last {
    pub run: u64,
    pub before: BTreeMap<String, Option<String>>,
}

fn watches() -> &'static Mutex<BTreeMap<String, Watch>> {
    static W: OnceLock<Mutex<BTreeMap<String, Watch>>> = OnceLock::new();
    W.get_or_init(Default::default)
}

fn lasts() -> &'static Mutex<BTreeMap<String, Last>> {
    static L: OnceLock<Mutex<BTreeMap<String, Last>>> = OnceLock::new();
    L.get_or_init(Default::default)
}

fn key(engine: &str) -> String {
    join(&crate::core::manifest::manifest().engine(engine), KEPT)
}

/// A file's text when it is text and small enough to watch.
fn text_of(full: &Path) -> Option<String> {
    let files = crate::core::files::files();
    if files.size(full).is_some_and(|n| n > MAX_FILE) {
        return None;
    }
    files.read(full).ok().filter(|t| t.len() as u64 <= MAX_FILE && !t.contains('\0'))
}

fn visible(root: &Path, exclude: &[String]) -> Vec<String> {
    let mut all: Vec<String> = exclude.to_vec();
    all.extend(NEVER.iter().map(|s| s.to_string()));
    super::snapshot(root, &all)
}

/// A run of `engine` begins: read its workspace's text files as they are now.
pub fn begin(engine: &str, run: u64, root: &Path, exclude: &[String]) {
    if engine.is_empty() {
        return;
    }
    let mut start = BTreeMap::new();
    let seen: std::collections::BTreeSet<String> = visible(root, exclude).into_iter().collect();
    let mut size = 0usize;
    for rel in &seen {
        if size >= MAX_WATCH {
            break;
        }
        let Some(text) = text_of(&root.join(rel)) else { continue };
        size += text.len();
        start.insert(rel.clone(), text);
    }
    watches().held().insert(engine.to_string(), Watch { run, start, seen, touched: BTreeMap::new() });
}

/// A tool of `run` is about to change `rel`: note it as it is, the first time.
pub fn before_change(engine: &str, run: u64, root: &Path, rel: &str) {
    let mut w = watches().held();
    let watch = w.entry(engine.to_string()).or_default();
    if watch.run != run {
        *watch = Watch { run, ..Default::default() };
    }
    if !watch.touched.contains_key(rel) {
        let full = root.join(rel);
        let files = crate::core::files::files();
        watch.touched.insert(rel.to_string(), files.is_file(&full).then(|| files.read(&full).unwrap_or_default()));
    }
}

/// The run of `engine` has ended: what changed since it began becomes the last changes (kept
/// in the store), unless nothing did.
pub fn end(engine: &str, run: u64, root: &Path, exclude: &[String]) {
    let Some(w) = watches().held().remove(engine).filter(|w| w.run == run) else { return };
    let mut before = w.touched;
    let now = visible(root, exclude);
    for rel in &now {
        if before.contains_key(rel) {
            continue;
        }
        let after = text_of(&root.join(rel));
        match (w.start.get(rel), after) {
            (Some(was), Some(is)) if *was != is => {
                before.insert(rel.clone(), Some(was.clone()));
            }
            // New since the start, and text.
            (None, Some(_)) if !w.seen.contains(rel) => {
                before.insert(rel.clone(), None);
            }
            _ => {}
        }
    }
    // Read at the start and gone now.
    for (rel, was) in &w.start {
        if !before.contains_key(rel) && !now.contains(rel) {
            before.insert(rel.clone(), Some(was.clone()));
        }
    }
    // A file written back to what it was is no change.
    before.retain(|rel, was| *was != crate::core::files::files().read(&root.join(rel)).ok());
    if before.is_empty() {
        return;
    }
    let last = Last { run, before };
    keep(engine, &last);
    lasts().held().insert(engine.to_string(), last);
}

/// Keep `last` in the store: as much earlier text as [`MAX_KEPT`] allows (a file whose earlier
/// text does not fit is left out of what is kept, not out of what is shown now).
fn keep(engine: &str, last: &Last) {
    let mut kept = Last { run: last.run, before: BTreeMap::new() };
    let mut size = 0usize;
    for (rel, was) in &last.before {
        size += was.as_ref().map_or(0, String::len) + rel.len();
        if size > MAX_KEPT {
            continue;
        }
        kept.before.insert(rel.clone(), was.clone());
    }
    if let Ok(text) = serde_json::to_string(&kept) {
        let _ = store::data().put(&key(engine), &text);
    }
}

/// The last changes of `engine`, together with those the run going now has made through its
/// tools: from memory, else from the store (after a restart).
pub fn last(engine: &str) -> Option<Last> {
    let going = watches().held().get(engine).filter(|w| !w.touched.is_empty()).map(|w| Last { run: w.run, before: w.touched.clone() });
    if going.is_some() {
        return going;
    }
    if let Some(l) = lasts().held().get(engine) {
        return Some(l.clone());
    }
    let l: Last = serde_json::from_str(&store::data().get(&key(engine))?).ok()?;
    lasts().held().insert(engine.to_string(), l.clone());
    Some(l)
}

#[cfg(test)]
pub(super) fn forget(engine: &str) {
    lasts().held().remove(engine);
}
