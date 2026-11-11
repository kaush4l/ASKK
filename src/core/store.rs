//! # Store: the only door to askk state
//!
//! Every piece of askk state — engines and their elements, the board, pages, components,
//! models, theme, layout, templates, jobs — is a text value at a **key**: a slash path relative
//! to the data root (`engines/askk/elements/history.json`). Nothing else in the app touches the
//! data folder; so a backup is "every key", and moving to a database (scan → open a db) means
//! one new [`Store`] impl, not edits across the app.
//!
//! This file is the contract and its pure parts; it never touches the disk. The forms that do
//! (a folder, a JSON file) are the host's: `host/store.rs`.
//!
//! Not app state, so not here: the workspace's files (`core/files.rs`).
//!
//! ## Sources: one standard form, any location
//! The standard form of askk's domain objects is **keys → text**. Where they live is a detail
//! of the impl, picked by the host: a folder or one JSON file holding every key
//! ([`Bundle`], also what [`export`] gives — a whole backup in one map). A database or SQL
//! dump is one more impl; boot ([`super::boot`]) reads any of them the same way.
//!
//! ## Change marks
//! The app's store is wrapped in [`Marked`]: every write marks its key in
//! [`super::changes`], so readers learn what changed without asking every object.
use crate::core::held::Held;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, OnceLock};

/// One child of a key.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Entry {
    pub name: String,
    /// It has children (a folder in the folder store).
    pub dir: bool,
}

pub trait Store: Send + Sync {
    /// The text at `key`; `None` if absent.
    fn get(&self, key: &str) -> Option<String>;
    /// Write the text at `key` (parents are created).
    fn put(&self, key: &str, text: &str) -> Result<(), String>;
    /// Children of `key`, sorted by name; empty if none.
    fn list(&self, key: &str) -> Vec<Entry>;
    /// `key` holds a value or children.
    fn has(&self, key: &str) -> bool;
    /// Move `from` (and everything under it) to `to`.
    fn rename(&self, from: &str, to: &str) -> Result<(), String>;
    /// Delete `key` and everything under it.
    fn remove(&self, key: &str) -> Result<(), String>;
}

/// Copy `from` (a value or a tree) in `src` to `to` in `dst`; the stores may differ (seeding).
pub fn copy(src: &dyn Store, from: &str, dst: &dyn Store, to: &str) -> Result<(), String> {
    let kids = src.list(from);
    if kids.is_empty() {
        return match src.get(from) {
            Some(text) => dst.put(to, &text),
            None if src.has(from) => Ok(()), // an empty folder: nothing to copy
            None => Err(format!("no key '{from}'")),
        };
    }
    for k in kids {
        copy(src, &join(from, &k.name), dst, &join(to, &k.name))?;
    }
    Ok(())
}

/// `a/b` from `a` and `b` (either may be empty).
pub fn join(a: &str, b: &str) -> String {
    match (a.is_empty(), b.is_empty()) {
        (true, _) => b.into(),
        (_, true) => a.into(),
        _ => format!("{}/{}", a.trim_end_matches('/'), b.trim_start_matches('/')),
    }
}

/// How a [`Bundle`] is saved after a write (the host writes one JSON file).
pub type Save = Box<dyn Fn(&BTreeMap<String, String>) -> Result<(), String> + Send + Sync>;

/// Every key in one map (a backup, a template pack, a test world). Reads come from memory;
/// with a [`Save`], every write hands the whole map to it.
pub struct Bundle {
    keys: Mutex<BTreeMap<String, String>>,
    save: Option<Save>,
}

impl Bundle {
    /// A bundle that is saved by `save` after every write.
    pub fn saved(keys: BTreeMap<String, String>, save: Save) -> Bundle {
        Bundle { keys: Mutex::new(keys), save: Some(save) }
    }
    /// An in-memory bundle (not saved).
    pub fn memory(keys: BTreeMap<String, String>) -> Bundle {
        Bundle { keys: Mutex::new(keys), save: None }
    }
    fn flush(&self, keys: &BTreeMap<String, String>) -> Result<(), String> {
        match &self.save {
            Some(save) => save(keys),
            None => Ok(()),
        }
    }
    fn under(key: &str, k: &str) -> bool {
        key.is_empty() || k == key || k.strip_prefix(key).is_some_and(|r| r.starts_with('/'))
    }
}

impl Store for Bundle {
    fn get(&self, key: &str) -> Option<String> {
        self.keys.held().get(key).cloned()
    }
    fn put(&self, key: &str, text: &str) -> Result<(), String> {
        if key.split('/').any(|p| p == ".." || p.is_empty()) {
            return Err(format!("bad key '{key}'"));
        }
        let mut k = self.keys.held();
        k.insert(key.into(), text.into());
        self.flush(&k)
    }
    fn list(&self, key: &str) -> Vec<Entry> {
        let key = key.trim_matches('/');
        let mut out: BTreeMap<String, bool> = BTreeMap::new();
        for k in self.keys.held().keys() {
            let rest = if key.is_empty() { Some(k.as_str()) } else { k.strip_prefix(key).and_then(|r| r.strip_prefix('/')) };
            if let Some(rest) = rest.filter(|r| !r.is_empty()) {
                let (name, dir) = match rest.split_once('/') {
                    Some((n, _)) => (n, true),
                    None => (rest, false),
                };
                *out.entry(name.into()).or_default() |= dir;
            }
        }
        out.into_iter().map(|(name, dir)| Entry { name, dir }).collect()
    }
    fn has(&self, key: &str) -> bool {
        self.keys.held().keys().any(|k| Self::under(key.trim_matches('/'), k))
    }
    fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        let mut k = self.keys.held();
        let moved: Vec<String> = k.keys().filter(|x| Self::under(from, x)).cloned().collect();
        if moved.is_empty() {
            return Err(format!("no key '{from}'"));
        }
        for x in moved {
            let v = k.remove(&x).unwrap();
            k.insert(format!("{to}{}", &x[from.len()..]), v);
        }
        self.flush(&k)
    }
    fn remove(&self, key: &str) -> Result<(), String> {
        let mut k = self.keys.held();
        k.retain(|x, _| !Self::under(key, x));
        self.flush(&k)
    }
}

/// Every key under `key` in `src` (the whole store for `""`): the standard form, ready for a
/// [`Bundle`] or any other store.
pub fn export(src: &dyn Store, key: &str) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for e in src.list(key) {
        let k = join(key, &e.name);
        if e.dir {
            out.extend(export(src, &k));
        } else if let Some(t) = src.get(&k) {
            out.insert(k, t);
        }
    }
    out
}

/// A store that marks every key it writes in [`super::changes`] (the app's data store).
pub struct Marked(pub Arc<dyn Store>);

impl Store for Marked {
    fn get(&self, key: &str) -> Option<String> {
        self.0.get(key)
    }
    fn put(&self, key: &str, text: &str) -> Result<(), String> {
        self.0.put(key, text)?;
        super::changes::mark(key);
        Ok(())
    }
    fn list(&self, key: &str) -> Vec<Entry> {
        self.0.list(key)
    }
    fn has(&self, key: &str) -> bool {
        self.0.has(key)
    }
    fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        self.0.rename(from, to)?;
        super::changes::mark(from);
        super::changes::mark(to);
        Ok(())
    }
    fn remove(&self, key: &str) -> Result<(), String> {
        self.0.remove(key)?;
        super::changes::mark(key);
        Ok(())
    }
}

/// Key holding the pid of the one process that writes this store.
pub const LOCK: &str = "askk.pid";

/// Take the store for this process: one writer per data folder. Refused while another live
/// process holds it (two processes would run the same engines and overwrite each other's
/// state). A lock left by a dead process is taken over. `alive` checks a pid.
pub fn lock(store: &dyn Store, me: u32, alive: &dyn Fn(u32) -> bool) -> Result<(), String> {
    if let Some(pid) = store.get(LOCK).and_then(|s| s.trim().parse::<u32>().ok()) {
        if pid != me && alive(pid) {
            return Err(format!("another askk process (pid {pid}) is using this data folder; stop it or use --desk <other dir>"));
        }
    }
    store.put(LOCK, &me.to_string())
}

static DATA: OnceLock<Arc<dyn Store>> = OnceLock::new();

/// Give the app its data store (the host does this once, at start). It is wrapped in
/// [`Marked`].
pub fn set_data(inner: Arc<dyn Store>) {
    let _ = DATA.set(Arc::new(Marked(inner)));
}

/// The app's data store. Until the host has set one it is an empty store in memory, so tests
/// and windows never touch a real data folder.
pub fn data() -> Arc<dyn Store> {
    DATA.get_or_init(|| Arc::new(Marked(Arc::new(Bundle::memory(Default::default()))))).clone()
}

/// A fresh folder store under the temp dir (tests).
#[cfg(test)]
pub fn temp(tag: &str) -> (Arc<dyn Store>, std::path::PathBuf) {
    crate::host::store::temp(tag)
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    /// Rigid rule: askk state reaches disk only through the store. The files allowed to use
    /// the filesystem are the store itself and the ones that work on things that are not askk
    /// state: the user's workspace and git (`workspace.rs`), the user's own data files, which
    /// are only read (`data.rs`), and attached media, which is not text (`media.rs`). A new
    /// writer of state must go through [`Store`].
    #[test]
    fn only_the_store_touches_the_data_folder() {
        const ALLOWED: &[&str] = &["host/store.rs", "host/workspace.rs", "host/data.rs", "host/media.rs", "structure.rs"];
        fn walk(d: &Path, out: &mut Vec<PathBuf>) {
            for e in std::fs::read_dir(d).unwrap().flatten() {
                if e.path().is_dir() { walk(&e.path(), out) } else if e.path().extension().is_some_and(|x| x == "rs") { out.push(e.path()) }
            }
        }
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = vec![];
        walk(&src, &mut files);
        for f in files {
            let rel = f.strip_prefix(&src).unwrap().to_string_lossy().replace('\\', "/");
            if ALLOWED.contains(&rel.as_str()) {
                continue;
            }
            let text = std::fs::read_to_string(&f).unwrap();
            // Test modules (`#[cfg(test)]`, `#[cfg(all(test, …))]`) may use temp files.
            let code = text.lines().take_while(|l| !(l.trim_start().starts_with("#[cfg(") && l.contains("test"))).collect::<Vec<_>>();
            for (n, line) in code.iter().enumerate() {
                for bad in ["std::fs::", "tokio::fs::"] {
                    assert!(!line.contains(bad), "{rel}:{}: uses {bad} outside the store: {}", n + 1, line.trim());
                }
            }
        }
    }
}
