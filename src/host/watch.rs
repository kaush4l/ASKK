//! # Watch: noticing a file a person edited by hand
//!
//! The service writes its home all day; a person edits a file in it now and then. To tell
//! the two apart without reading every file, the data folder is opened as [`Kept`]: it
//! remembers what each file a person may edit looked like from outside (when it was written,
//! how long it is) each time the service itself wrote it. A **look** ([`Kept::look`])
//! compares that with the disk: a file that looks different was changed by someone else.
//! The core then reads it again (`core/reread.rs`).
//!
//! Two rules follow from that memory:
//!
//! - **The owner's edit wins.** When the service is about to write a file that a person has
//!   changed and that was not read again yet, it leaves the file alone. The next look reads
//!   the person's text, and the service's later writes carry it.
//! - **A write is whole or not there.** Every write happens while a lock is held, and a
//!   service asked to stop takes that lock first ([`settle`]), so it never ends in the
//!   middle of a file.
//!
//! The looking itself is a modest timer ([`start`]): every `look_every_ms` (settings), a few
//! dozen files are asked their date. Nothing is read unless a date moved.
use crate::core::held::Held;
use crate::core::reread::{folders, own_folder, watched};
use crate::core::store::{join, Entry, Store};
use crate::host::store::Folder;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

/// What a file looks like from outside: when it was written, and its length.
type Stamp = (u128, u64);

/// The data folder, with the memory of what the service itself last wrote.
pub struct Kept {
    folder: Folder,
    /// `None` until the watch begins ([`Kept::begin`]): during boot nothing is remembered,
    /// because which files a person may edit is known only once the world is loaded.
    stamps: Mutex<Option<BTreeMap<String, Stamp>>>,
}

impl Kept {
    /// Open the folder at `root`. Nothing is watched yet.
    pub fn new(root: PathBuf) -> Arc<Kept> {
        Arc::new(Kept { folder: Folder(root), stamps: Mutex::default() })
    }

    /// Begin the watch: what is in the folder now is taken as read.
    pub fn begin(&self) {
        let mut known = self.stamps.held();
        *known = Some(self.on_disk());
    }

    /// Every file a person may edit, as it looks on the disk now.
    fn on_disk(&self) -> BTreeMap<String, Stamp> {
        fn walk(f: &Folder, key: &str, out: &mut BTreeMap<String, Stamp>) {
            for e in f.list(key) {
                let k = join(key, &e.name);
                if e.dir {
                    if !own_folder(&e.name) {
                        walk(f, &k, out);
                    }
                } else if watched(&k) {
                    if let Some(stamp) = f.stamp(&k) {
                        out.insert(k, stamp);
                    }
                }
            }
        }
        let mut out = BTreeMap::new();
        for e in self.folder.list("").into_iter().filter(|e| !e.dir && watched(&e.name)) {
            if let Some(stamp) = self.folder.stamp(&e.name) {
                out.insert(e.name, stamp);
            }
        }
        for root in folders() {
            walk(&self.folder, &root, &mut out);
        }
        out
    }

    /// Look at the folder: the keys someone else wrote, made or removed since the last look.
    /// Each is reported once.
    pub fn look(&self) -> Vec<String> {
        let mut held = self.stamps.held();
        let Some(known) = held.as_mut() else { return vec![] };
        let now = self.on_disk();
        let mut changed: Vec<String> = now.iter().filter(|(k, stamp)| known.get(*k) != Some(*stamp)).map(|(k, _)| k.clone()).collect();
        changed.extend(known.keys().filter(|k| !now.contains_key(*k)).cloned());
        *known = now;
        changed.sort();
        changed
    }

    /// Wait for the write in hand, and let no other begin (the service is about to end).
    fn settle(&self) -> MutexGuard<'_, Option<BTreeMap<String, Stamp>>> {
        self.stamps.held()
    }
}

impl Store for Kept {
    fn get(&self, key: &str) -> Option<String> {
        self.folder.get(key)
    }
    fn put(&self, key: &str, text: &str) -> Result<(), String> {
        let mut held = self.stamps.held();
        let Some(known) = held.as_mut().filter(|_| watched(key)) else { return self.folder.put(key, text) };
        // A person changed this file and it was not read again yet: their text stays.
        if let (Some(mine), Some(theirs)) = (known.get(key), self.folder.stamp(key)) {
            if *mine != theirs {
                return Ok(());
            }
        }
        self.folder.put(key, text)?;
        if let Some(stamp) = self.folder.stamp(key) {
            known.insert(key.into(), stamp);
        }
        Ok(())
    }
    fn list(&self, key: &str) -> Vec<Entry> {
        self.folder.list(key)
    }
    fn has(&self, key: &str) -> bool {
        self.folder.has(key)
    }
    fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        let mut held = self.stamps.held();
        self.folder.rename(from, to)?;
        // The service moved them itself: what is there now is taken as read.
        if held.is_some() {
            *held = Some(self.on_disk());
        }
        Ok(())
    }
    fn remove(&self, key: &str) -> Result<(), String> {
        let mut held = self.stamps.held();
        self.folder.remove(key)?;
        if let Some(known) = held.as_mut() {
            known.retain(|k, _| !(k == key || k.strip_prefix(key).is_some_and(|r| r.starts_with('/'))));
        }
        Ok(())
    }
}

/// The app's own data folder, once it is open.
static HOME: OnceLock<Arc<Kept>> = OnceLock::new();

/// Open the data folder at `root` as the one the app keeps under watch.
pub fn open(root: PathBuf) -> Arc<dyn Store> {
    let kept = Kept::new(root);
    let _ = HOME.set(kept.clone());
    kept
}

/// Finish the write in hand and begin no other, for the rest of this process's life.
pub fn settle() {
    if let Some(home) = HOME.get() {
        std::mem::forget(home.settle());
    }
}

/// Start looking: tell the core how a look is done here, then look on a timer and put in
/// force what was found. Called once, by the process that holds the home, after boot.
pub fn start() {
    crate::core::reread::looks_with(|| match HOME.get() {
        Some(home) => Ok(home.look()),
        None => Err(format!("this home is one file ({}), which is read at start only: an edit to it holds after `askk restart`", crate::core::places::data().display())),
    });
    let Some(home) = HOME.get() else { return };
    home.begin();
    tokio::spawn(async {
        loop {
            // The settings are asked each round, so `look_every_ms` itself changes in place.
            let every = crate::core::settings::settings().look_every_ms;
            if every == 0 {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                continue;
            }
            tokio::time::sleep(std::time::Duration::from_millis(every)).await;
            let did = crate::core::reread::reload();
            for line in &did.reread {
                eprintln!("askk: read again: {line}");
            }
            for line in &did.needs_restart {
                eprintln!("askk: changed, but waits for a restart: {line}");
            }
            for line in &did.refused {
                eprintln!("askk: not read: {line}");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home(tag: &str) -> (Arc<Kept>, PathBuf) {
        let root = std::env::temp_dir().join(format!("askk-watch-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("engines/a")).unwrap();
        std::fs::write(root.join("engines/a/goal.md"), "there before the service").unwrap();
        let kept = Kept::new(root.clone());
        kept.put("engines/a/goal.md", "written while booting").unwrap();
        assert!(kept.look().is_empty(), "nothing is news before the watch begins");
        kept.begin();
        (kept, root)
    }

    /// A person's save: the text changes, and so does how the file looks from outside.
    fn by_hand(root: &std::path::Path, key: &str, text: &str) {
        std::fs::write(root.join(key), text).unwrap();
    }

    #[test]
    fn the_services_own_writes_are_not_news_and_a_persons_edit_is_news_once() {
        let (kept, root) = home("news");
        assert!(kept.look().is_empty(), "what was there at start is taken as read");
        kept.put("models.json", "{}").unwrap();
        kept.put("engines/a/goal.md", "written by the service").unwrap();
        kept.put("engines/a/memory/history.json", "[]").unwrap();
        assert!(kept.look().is_empty(), "the service's own writes are not news");
        by_hand(&root, "models.json", r#"{"default": "x"}"#);
        by_hand(&root, "engines/a/engine.json", r#"{"name": "a"}"#);
        by_hand(&root, "engines/a/memory/history.json", "[1, 2, 3]");
        assert_eq!(kept.look(), ["engines/a/engine.json", "models.json"], "an edit and a new file are news; the service's own memory is not looked at");
        assert!(kept.look().is_empty(), "news is told once");
        std::fs::remove_file(root.join("models.json")).unwrap();
        assert_eq!(kept.look(), ["models.json"], "a file taken away is news too");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn the_owners_edit_wins_over_a_write_the_service_was_about_to_make() {
        let (kept, root) = home("wins");
        kept.put("engines/a/goal.md", "the service's text").unwrap();
        by_hand(&root, "engines/a/goal.md", "the owner's new goal, longer than before");
        kept.put("engines/a/goal.md", "the service's text").unwrap();
        assert_eq!(kept.get("engines/a/goal.md").unwrap(), "the owner's new goal, longer than before", "the unread edit was not written over");
        assert_eq!(kept.look(), ["engines/a/goal.md"], "and it is still news");
        kept.put("engines/a/goal.md", "the service's text, after reading").unwrap();
        assert_eq!(kept.get("engines/a/goal.md").unwrap(), "the service's text, after reading", "once read, the service writes again");
        kept.rename("engines/a", "engines/b").unwrap();
        kept.remove("engines/b").unwrap();
        assert!(kept.look().is_empty(), "what the service moved or removed itself is not news");
        let _ = std::fs::remove_dir_all(root);
    }
}
