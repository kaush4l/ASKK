//! # The store on disk
//!
//! The two file forms of [`crate::core::store::Store`]: a folder ([`Folder`]: a key is a path
//! under its root) and one JSON file holding every key ([`bundle`]). [`open`] picks by
//! location; [`start`] opens the data place and hands it to the core. A data folder is
//! opened through `watch.rs`, so that a file a person edits by hand is noticed.
use crate::core::store::{Bundle, Entry, Store};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// The folder store: a key is a path under `root`.
pub struct Folder(pub PathBuf);

impl Folder {
    pub fn new(root: impl Into<PathBuf>) -> Arc<dyn Store> {
        Arc::new(Folder(root.into()))
    }
    fn path(&self, key: &str) -> Result<PathBuf, String> {
        if key.split('/').any(|p| p == "..") || Path::new(key).is_absolute() {
            return Err(format!("bad key '{key}'"));
        }
        Ok(self.0.join(key))
    }
    /// What the file at `key` looks like from outside, without reading it: when it was last
    /// written (nanoseconds since 1970) and how long it is. `None` when there is no such file.
    pub fn stamp(&self, key: &str) -> Option<(u128, u64)> {
        let m = std::fs::metadata(self.path(key).ok()?).ok()?;
        let at = m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos();
        m.is_file().then_some((at, m.len()))
    }
}

/// A file that is only ever added to (the service's log), made with its folder when missing.
pub fn appended(file: &Path) -> Result<std::fs::File, String> {
    if let Some(d) = file.parent().filter(|d| !d.as_os_str().is_empty()) {
        std::fs::create_dir_all(d).map_err(|e| format!("{}: {e}", d.display()))?;
    }
    std::fs::OpenOptions::new().create(true).append(true).open(file).map_err(|e| format!("{}: {e}", file.display()))
}

/// The last `lines` lines of a text file (the end of the log, for a person to read).
pub fn tail(file: &Path, lines: usize) -> String {
    let text = std::fs::read_to_string(file).unwrap_or_default();
    let all: Vec<&str> = text.lines().collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

impl Store for Folder {
    fn get(&self, key: &str) -> Option<String> {
        std::fs::read_to_string(self.path(key).ok()?).ok()
    }
    fn put(&self, key: &str, text: &str) -> Result<(), String> {
        let p = self.path(key)?;
        if let Some(d) = p.parent() {
            std::fs::create_dir_all(d).map_err(|e| format!("{}: {e}", d.display()))?;
        }
        // Written beside the file and then put in its place in one move: a process that ends
        // in the middle of a write leaves the old text whole, never an empty or half file.
        let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let beside = p.with_file_name(format!(".{name}.{}.writing", std::process::id()));
        std::fs::write(&beside, text).and_then(|()| std::fs::rename(&beside, &p)).map_err(|e| {
            let _ = std::fs::remove_file(&beside);
            format!("{}: {e}", p.display())
        })
    }
    fn list(&self, key: &str) -> Vec<Entry> {
        let Ok(p) = self.path(key) else { return vec![] };
        let mut v: Vec<Entry> = std::fs::read_dir(p)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| Entry { name: e.file_name().to_string_lossy().into(), dir: e.path().is_dir() })
            .filter(|e| !e.name.starts_with('.'))
            .collect();
        v.sort();
        v
    }
    fn has(&self, key: &str) -> bool {
        self.path(key).map(|p| p.exists()).unwrap_or(false)
    }
    fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        let (f, t) = (self.path(from)?, self.path(to)?);
        if let Some(d) = t.parent() {
            std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
        }
        std::fs::rename(&f, &t).map_err(|e| format!("{} → {}: {e}", f.display(), t.display()))
    }
    fn remove(&self, key: &str) -> Result<(), String> {
        let p = self.path(key)?;
        if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) }.map_err(|e| format!("{}: {e}", p.display()))
    }
}

/// The bundle in `file` (empty if the file does not exist yet); every write rewrites the file.
pub fn bundle(file: impl Into<PathBuf>) -> Result<Bundle, String> {
    let file: PathBuf = file.into();
    let keys: BTreeMap<String, String> = match std::fs::read_to_string(&file) {
        Ok(t) => serde_json::from_str(&t).map_err(|e| format!("{}: {e}", file.display()))?,
        Err(_) => BTreeMap::new(),
    };
    Ok(Bundle::saved(
        keys,
        Box::new(move |keys| {
            if let Some(d) = file.parent().filter(|d| !d.as_os_str().is_empty()) {
                std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
            }
            std::fs::write(&file, serde_json::to_string_pretty(keys).unwrap()).map_err(|e| format!("{}: {e}", file.display()))
        }),
    ))
}

/// The store at `location`: a `.json` file is a bundle, anything else a [`Folder`].
pub fn open(location: &str) -> Result<Arc<dyn Store>, String> {
    if location.ends_with(".json") {
        Ok(Arc::new(bundle(location)?))
    } else {
        Ok(Folder::new(location))
    }
}

/// Open the data place (`core/places.rs`) and make it the app's data store. A folder is kept
/// under watch (`watch.rs`); one file holding every key is read at start only.
pub fn start() {
    let at = crate::core::places::data();
    let opened = if at.to_string_lossy().ends_with(".json") { open(&at.to_string_lossy()) } else { Ok(super::watch::open(at.clone())) };
    match opened {
        Ok(s) => crate::core::store::set_data(s),
        Err(e) => eprintln!("askk: data store: {e} (nothing will be saved)"),
    }
}

/// Whether a process is running (`kill -0`).
pub fn alive(pid: u32) -> bool {
    std::process::Command::new("kill").arg("-0").arg(pid.to_string()).stderr(std::process::Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
}

/// A fresh folder store under the temp dir (tests).
#[cfg(test)]
pub fn temp(tag: &str) -> (Arc<dyn Store>, PathBuf) {
    let root = std::env::temp_dir().join(format!("askk-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    (Folder::new(root.clone()), root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::store::{copy, export, lock, Marked, LOCK};

    #[test]
    fn a_write_replaces_the_whole_file_and_leaves_nothing_beside_it() {
        let (s, root) = temp("whole");
        s.put("a/b.json", "one").unwrap();
        s.put("a/b.json", "two, and longer").unwrap();
        assert_eq!(s.get("a/b.json").unwrap(), "two, and longer");
        let left: Vec<String> = std::fs::read_dir(root.join("a")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(left, ["b.json"], "the file written beside it was moved into place");
        // A write cut off before the move leaves the old text: what is beside it is not listed.
        std::fs::write(root.join("a/.b.json.1.writing"), "").unwrap();
        assert_eq!((s.get("a/b.json").unwrap().as_str(), s.list("a").len()), ("two, and longer", 1));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn one_live_process_holds_the_store() {
        let (s, root) = temp("lock");
        lock(&*s, 10, &|_| true).unwrap();
        assert!(lock(&*s, 11, &|p| p == 10).unwrap_err().contains("pid 10"), "a live holder refuses others");
        lock(&*s, 10, &|_| true).unwrap();
        lock(&*s, 11, &|_| false).unwrap();
        assert_eq!(s.get(LOCK).unwrap(), "11", "a dead holder's lock is taken over");
        assert!(alive(std::process::id()));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_bundle_is_the_same_store_in_one_file_and_export_round_trips() {
        let (f, root) = temp("bundle-src");
        f.put("engines/a/engine.json", "{}").unwrap();
        f.put("engines/a/elements/h.json", "1").unwrap();
        f.put("theme.json", "{}").unwrap();
        let (_, out) = temp("bundle-file");
        let file = out.join("all.json");
        let b = bundle(&file).unwrap();
        for (k, v) in export(&*f, "") {
            b.put(&k, &v).unwrap();
        }
        let b = open(&file.to_string_lossy()).unwrap();
        assert_eq!(export(&*b, ""), export(&*f, ""), "same keys, same text");
        assert_eq!(b.list(""), f.list(""));
        assert_eq!(b.list("engines/a"), vec![Entry { name: "elements".into(), dir: true }, Entry { name: "engine.json".into(), dir: false }]);
        assert!(b.has("engines/a") && !b.has("engines/ab"));
        b.rename("engines/a", "dismissed/a").unwrap();
        assert!(b.has("dismissed/a/elements/h.json") && !b.has("engines"));
        b.remove("dismissed").unwrap();
        assert!(b.put("../x", "").is_err());
        let _ = (std::fs::remove_dir_all(root), std::fs::remove_dir_all(out));
    }

    #[test]
    fn a_marked_store_marks_what_it_writes() {
        let (f, root) = temp("marked");
        let s = Marked(f);
        let seen = crate::core::changes::now();
        s.put("t-marked/x.json", "1").unwrap();
        assert!(crate::core::changes::since(seen).1.iter().any(|(k, _)| k == "t-marked/x.json"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn folder_store_puts_lists_copies_moves_and_refuses_escapes() {
        let (s, root) = temp("store");
        s.put("a/b/c.json", "1").unwrap();
        s.put("a/x.md", "2").unwrap();
        assert_eq!(s.get("a/b/c.json").as_deref(), Some("1"));
        assert_eq!(s.list("a"), vec![Entry { name: "b".into(), dir: true }, Entry { name: "x.md".into(), dir: false }]);
        copy(&*s, "a", &*s, "z").unwrap();
        assert_eq!(s.get("z/b/c.json").as_deref(), Some("1"));
        s.rename("z", "moved/z").unwrap();
        assert!(!s.has("z") && s.has("moved/z/x.md"));
        s.remove("moved").unwrap();
        assert!(!s.has("moved"));
        assert!(s.put("../out", "x").is_err() && s.get("/etc/hosts").is_none());
        let _ = std::fs::remove_dir_all(root);
    }
}
