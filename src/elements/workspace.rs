//! # workspace
//! The developer's file space, as an artifact: tools to open, write and edit files, and a view
//! of the current file tree with the open files. Rules decide what the engine sees and changes:
//! - `exclude`: paths left out of the snapshot entirely (never listed, opened or written);
//! - `protect`: paths that can be opened but never written (the core stays protected).
//!
//! The snapshot is the visible file space: every file under the root minus the exclusions. All
//! tools act on the snapshot only, so what the engine may see and change is known up front.
//! `open_file` only answers true: the file's current text is in the prompt from then on.
//!
//! Patterns: `dir/` matches that folder at any depth; `*.ext` matches a suffix; anything else
//! matches the exact path, the folder with that path, or a file name.
//!
//! ```json
//! {"kind": "workspace", "config": {"exclude": ["target/", ".git/", "*.lock"], "protect": ["src/core/"]}}
//! ```
use crate::core::{read, tool, value, Component, Event, Spec, Tool};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const DOC: &str = "File space artifact: exclude/protect rules, a snapshot tree in the prompt, open_file/close_file/write_file/edit_file/find_files on the snapshot only; open files shown live.";
const MAX_FILES: usize = 3000;
const MAX_OPEN: usize = 4;
const MAX_CHARS: usize = 20_000;
/// Lines of each open file shown in the prompt (the window moves with `open_file {line}`).
const WINDOW: usize = 200;

fn default_exclude() -> Vec<String> {
    ["target/", ".git/", ".worktrees/", "node_modules/", "archive/", "dist/", "*.lock", ".DS_Store"].map(String::from).to_vec()
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Cfg {
    /// Root folder, relative to the process workspace (default: the workspace itself).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    root: String,
    #[serde(default = "default_exclude")]
    exclude: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    protect: Vec<String>,
}

impl Default for Cfg {
    fn default() -> Self {
        Self { root: String::new(), exclude: default_exclude(), protect: vec![] }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct St {
    /// Open files, oldest first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    open: Vec<String>,
    /// Line each open file is centred on (from `open_file {line}`); absent = the top.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    at: std::collections::BTreeMap<String, usize>,
}

/// One open file as the UI shows it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct OpenFile {
    pub path: String,
    pub text: String,
}

/// The workspace as the IDE view draws it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct WorkspaceView {
    pub root: String,
    /// Visible files (the snapshot), sorted.
    pub files: Vec<String>,
    pub exclude: Vec<String>,
    pub protect: Vec<String>,
    pub open: Vec<OpenFile>,
}

/// Does `path` (slash-separated, relative) match `pat`?
pub fn matches(pat: &str, path: &str) -> bool {
    if let Some(dir) = pat.strip_suffix('/') {
        let dir = dir.trim_start_matches('/');
        return path.starts_with(&format!("{dir}/")) || path.contains(&format!("/{dir}/"));
    }
    if let Some(ext) = pat.strip_prefix('*') {
        return path.ends_with(ext);
    }
    path == pat || path.starts_with(&format!("{pat}/")) || path.rsplit('/').next() == Some(pat)
}

fn any(pats: &[String], path: &str) -> bool {
    pats.iter().any(|p| matches(p, path))
}

/// The visible file space under `root`: every file minus the exclusions, sorted.
pub fn snapshot(root: &Path, exclude: &[String]) -> Vec<String> {
    fn walk(root: &Path, dir: &Path, exclude: &[String], out: &mut Vec<String>) {
        for (name, is_dir) in crate::core::files::files().list(dir) {
            let p = dir.join(name);
            if out.len() >= MAX_FILES {
                return;
            }
            let rel = p.strip_prefix(root).unwrap_or(&p).to_string_lossy().replace('\\', "/");
            if is_dir {
                if !any(exclude, &format!("{rel}/")) {
                    walk(root, &p, exclude, out);
                }
            } else if !any(exclude, &rel) {
                out.push(rel);
            }
        }
    }
    let mut out = vec![];
    walk(root, root, exclude, &mut out);
    out
}

/// The files as an indented tree (folders end with `/`).
pub fn tree(files: &[String]) -> String {
    let mut out = vec![];
    let mut prev: Vec<&str> = vec![];
    for f in files {
        let parts: Vec<&str> = f.split('/').collect();
        let (dirs, name) = parts.split_at(parts.len() - 1);
        let same = prev.iter().zip(dirs).take_while(|(a, b)| a == b).count();
        for (i, d) in dirs.iter().enumerate().skip(same) {
            out.push(format!("{}{d}/", "  ".repeat(i)));
        }
        out.push(format!("{}{}", "  ".repeat(dirs.len()), name[0]));
        prev = dirs.to_vec();
    }
    out.join("\n")
}

pub struct Workspace {
    name: String,
    cfg: Cfg,
    st: St,
    /// The engine it belongs to, and the run going now (what the files it changes are tied to).
    engine: String,
    run: u64,
}

/// A file a run changed: as it was before the run first changed it (`None`: it did not exist),
/// and as it is now.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct FileChange {
    pub path: String,
    pub before: Option<String>,
    pub after: String,
}

/// The files the last run that changed any changed, per engine: `(run, file → before)`. Held in
/// memory only, so a restart forgets what came before.
type Touched = std::collections::BTreeMap<String, (u64, std::collections::BTreeMap<String, Option<String>>)>;

fn touched() -> &'static std::sync::Mutex<Touched> {
    static T: std::sync::OnceLock<std::sync::Mutex<Touched>> = std::sync::OnceLock::new();
    T.get_or_init(Default::default)
}

/// Note a file as it is before `run` changes it, the first time that run does.
fn before_change(engine: &str, run: u64, root: &Path, rel: &str) {
    use crate::core::held::Held;
    let mut t = touched().held();
    let entry = t.entry(engine.to_string()).or_default();
    if entry.0 != run {
        *entry = (run, Default::default());
    }
    if !entry.1.contains_key(rel) {
        let full = root.join(rel);
        let files = crate::core::files::files();
        entry.1.insert(rel.to_string(), files.is_file(&full).then(|| files.read(&full).unwrap_or_default()));
    }
}

/// What the last run of `engine` that changed files changed in the workspace `spec` describes:
/// the run, and each file before and now.
pub fn changes_of(spec: Spec, engine: &str) -> Result<(u64, Vec<FileChange>), String> {
    use crate::core::held::Held;
    let cfg: Cfg = if spec.config.is_null() { Cfg::default() } else { read(&spec.config)? };
    let root = base().join(&cfg.root);
    let Some((run, files)) = touched().held().get(engine).cloned() else { return Ok((0, vec![])) };
    let out = files
        .into_iter()
        .map(|(path, before)| {
            let after = crate::core::files::files().read(&root.join(&path)).unwrap_or_default();
            FileChange { path, before, after }
        })
        .filter(|c| c.before.as_deref() != Some(c.after.as_str()))
        .collect();
    Ok((run, out))
}

/// One visible file's text, for reading only (excluded files are not shown).
pub fn read_of(spec: Spec, rel: &str) -> Result<String, String> {
    let cfg: Cfg = if spec.config.is_null() { Cfg::default() } else { read(&spec.config)? };
    let r = Rules { root: base().join(&cfg.root), exclude: cfg.exclude, protect: cfg.protect };
    let rel = r.visible(rel)?;
    let text = crate::core::files::files().read(&r.root.join(&rel))?;
    Ok(if text.chars().count() > MAX_CHARS * 10 { format!("{}\n… (cut: the file is longer)", text.chars().take(MAX_CHARS * 10).collect::<String>()) } else { text })
}

pub fn new(s: Spec) -> Result<Box<dyn Component>, String> {
    let cfg: Cfg = if s.config.is_null() { Cfg::default() } else { read(&s.config)? };
    if cfg.root.split('/').any(|c| c == "..") {
        return Err("root must stay inside the workspace".into());
    }
    Ok(Box::new(Workspace { name: s.name, cfg, st: read(&s.state)?, engine: String::new(), run: 0 }))
}

/// The process workspace (`ASKK_WORKSPACE`, else the current folder).
fn base() -> PathBuf {
    crate::core::places::workspace()
}

/// What a tool may touch: the rules, checked on every call.
#[derive(Clone)]
struct Rules {
    root: PathBuf,
    exclude: Vec<String>,
    protect: Vec<String>,
}

impl Rules {
    fn clean(rel: &str) -> Result<String, String> {
        let rel = rel.trim().trim_start_matches("./").to_string();
        if rel.is_empty() || rel.starts_with('/') || rel.split('/').any(|c| c == ".." || c.is_empty()) {
            return Err(format!("path '{rel}' must be relative and inside the workspace"));
        }
        Ok(rel)
    }
    /// A visible file (in the snapshot).
    fn visible(&self, rel: &str) -> Result<String, String> {
        let rel = Self::clean(rel)?;
        if any(&self.exclude, &rel) {
            return Err(format!("'{rel}' is excluded from the workspace"));
        }
        if !crate::core::files::files().is_file(&self.root.join(&rel)) {
            return Err(format!("no file '{rel}'"));
        }
        Ok(rel)
    }
    /// A path that may be written (new or existing): not excluded, not protected.
    fn writable(&self, rel: &str) -> Result<String, String> {
        let rel = Self::clean(rel)?;
        if any(&self.exclude, &rel) {
            return Err(format!("'{rel}' is excluded from the workspace"));
        }
        if any(&self.protect, &rel) {
            return Err(format!("'{rel}' is protected: read only"));
        }
        Ok(rel)
    }
}

impl Workspace {
    fn rules(&self) -> Rules {
        Rules { root: base().join(&self.cfg.root), exclude: self.cfg.exclude.clone(), protect: self.cfg.protect.clone() }
    }
    fn open_now(&mut self, p: &str) {
        self.st.open.retain(|o| o != p);
        self.st.open.push(p.into());
        let n = self.st.open.len().saturating_sub(MAX_OPEN);
        self.st.open.drain(..n);
        let open = self.st.open.clone();
        self.st.at.retain(|k, _| open.contains(k));
    }

    /// The IDE view's data.
    pub fn snapshot_view(&self) -> WorkspaceView {
        let r = self.rules();
        let open = self
            .st
            .open
            .iter()
            .filter(|p| r.visible(p).is_ok())
            .map(|p| OpenFile { path: p.clone(), text: crate::core::files::files().read(&r.root.join(p)).unwrap_or_default() })
            .collect();
        WorkspaceView { root: r.root.to_string_lossy().into(), files: snapshot(&r.root, &r.exclude), exclude: r.exclude, protect: r.protect, open }
    }
}

/// The IDE view's data from a workspace element's spec (config + state).
pub fn view_of(spec: Spec) -> Result<WorkspaceView, String> {
    let cfg: Cfg = if spec.config.is_null() { Cfg::default() } else { read(&spec.config)? };
    Ok(Workspace { name: spec.name, cfg, st: read(&spec.state)?, engine: String::new(), run: 0 }.snapshot_view())
}

/// `WINDOW` numbered lines around `at` (1-based; 0 = from the top), with a note when cut.
fn window(text: &str, at: usize) -> String {
    let all: Vec<&str> = text.lines().collect();
    if all.len() <= WINDOW {
        return numbered(text);
    }
    let start = at.saturating_sub(WINDOW / 4).max(1).min(all.len() + 1 - WINDOW);
    let mut out: Vec<String> = all[start - 1..start - 1 + WINDOW].iter().enumerate().map(|(i, l)| format!("{:>5} {l}", start + i)).collect();
    out.push(format!("… lines {start}-{} of {}; open_file(path, line) shows another part", start + WINDOW - 1, all.len()));
    out.join("\n")
}

fn numbered(text: &str) -> String {
    let t: String = text.chars().take(MAX_CHARS).collect();
    let mut out: Vec<String> = t.lines().enumerate().map(|(i, l)| format!("{:>4} {l}", i + 1)).collect();
    if text.chars().count() > MAX_CHARS {
        out.push("… (cut; use run with sed -n for the rest)".into());
    }
    out.join("\n")
}

impl Component for Workspace {
    fn kind(&self) -> &'static str { "workspace" }
    fn category(&self) -> &'static str { "live" }
    fn icon(&self) -> &'static str { "file" }
    fn slot(&self) -> crate::core::Slot { crate::core::Slot::World }
    fn name(&self) -> &str { &self.name }
    fn doc(&self) -> &'static str { DOC }
    fn config(&self) -> Value { value(&self.cfg) }
    fn state(&self) -> Value { value(&self.st) }
    fn view(&self) -> crate::core::node::Node {
        let v = self.snapshot_view();
        let head = format!("{} files visible; {} open", v.files.len(), v.open.len());
        super::tile(&self.name, "workspace", std::iter::once(head).chain(v.open.into_iter().map(|o| format!("open: {}", o.path))))
    }
    fn on(&mut self, ev: &Event) {
        match ev {
            Event::Called { tool, args, result } if !result.starts_with("error") => {
                let p = args["path"].as_str().unwrap_or_default().trim().trim_start_matches("./").to_string();
                match tool.as_str() {
                    "open_file" | "write_file" | "edit_file" => {
                        match args["line"].as_u64() {
                            Some(l) if tool == "open_file" => {
                                self.st.at.insert(p.clone(), l as usize);
                            }
                            _ if tool == "open_file" => {
                                self.st.at.remove(&p);
                            }
                            _ => {}
                        }
                        self.open_now(&p)
                    }
                    "close_file" => {
                        self.st.open.retain(|o| *o != p);
                        self.st.at.remove(&p);
                    }
                    _ => {}
                }
            }
            Event::Cleared => self.st = St::default(),
            Event::Bound(p) => self.engine = p.clone(),
            Event::Started { run } => self.run = *run,
            _ => {}
        }
    }
    fn prompt(&self) -> Option<String> {
        let v = self.snapshot_view();
        let mut out = format!(
            "Files ({} visible; excluded: {}; read only: {}):\n{}",
            v.files.len(),
            if v.exclude.is_empty() { "none".into() } else { v.exclude.join(", ") },
            if v.protect.is_empty() { "none".into() } else { v.protect.join(", ") },
            tree(&v.files)
        );
        if v.open.is_empty() {
            out.push_str("\nNo file open: open_file(path) shows a file here.");
        }
        for o in &v.open {
            out.push_str(&format!("\n\n### {}\n{}", o.path, window(&o.text, self.st.at.get(&o.path).copied().unwrap_or(0))));
        }
        Some(out)
    }
    fn tools(&self) -> Vec<Arc<dyn Tool>> {
        let r = self.rules();
        let (r1, r2, r3, r4) = (r.clone(), r.clone(), r.clone(), r);
        let (e2, e3, run) = (self.engine.clone(), self.engine.clone(), self.run);
        let path = |a: &Value| a["path"].as_str().map(String::from).ok_or_else(|| "path missing".to_string());
        vec![
            tool("open_file", "open a file: its current text is shown in the workspace section from now on", json!({"path": "relative path", "line": "optional: show the part around this line (big files show 200 lines)"}), move |a| {
                r1.visible(&path(&a)?).map(|_| json!(true))
            }),
            tool("close_file", "close an open file", json!({"path": "relative path"}), move |a| Rules::clean(&path(&a)?).map(|_| json!(true))),
            tool("write_file", "create or overwrite a file (not excluded or protected paths); it opens", json!({"path": "relative path", "content": "full text"}), move |a| {
                let p = r2.writable(&path(&a)?)?;
                before_change(&e2, run, &r2.root, &p);
                let full = r2.root.join(&p);
                crate::core::files::files().write(&full, a["content"].as_str().unwrap_or_default())?;
                Ok(json!(true))
            }),
            tool("edit_file", "replace one exact, unique piece of text in a file; it opens", json!({"path": "relative path", "old": "exact text", "new": "replacement"}), move |a| {
                let p = r3.writable(&path(&a)?)?;
                r3.visible(&p)?;
                let full = r3.root.join(&p);
                let text = crate::core::files::files().read(&full)?;
                let old = a["old"].as_str().filter(|o| !o.is_empty()).ok_or("old missing")?;
                match text.matches(old).count() {
                    1 => {}
                    0 => return Err(format!("'old' not found in {p}")),
                    n => return Err(format!("'old' is found {n} times in {p}; include more context")),
                }
                before_change(&e3, run, &r3.root, &p);
                crate::core::files::files().write(&full, &text.replacen(old, a["new"].as_str().unwrap_or_default(), 1))?;
                Ok(json!(true))
            }),
            tool("find_files", "visible files whose path contains the text", json!({"text": "part of a path"}), move |a| {
                let t = a["text"].as_str().unwrap_or_default();
                Ok(json!(snapshot(&r4.root, &r4.exclude).into_iter().filter(|f| f.contains(t)).take(100).collect::<Vec<_>>()))
            }),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn big_files_show_a_window_that_moves_with_line() {
        let text: String = (1..=1000).map(|i| format!("l{i}\n")).collect();
        let top = window(&text, 0);
        assert!(top.contains("    1 l1") && top.contains("  200 l200") && !top.contains("l201\n"), "{top}");
        assert!(top.contains("lines 1-200 of 1000"));
        let mid = window(&text, 600);
        assert!(mid.contains("  600 l600") && mid.contains("lines 550-749"), "{mid}");
        assert!(window(&text, 5000).contains("lines 801-1000"));
        assert_eq!(window("a\nb", 9), numbered("a\nb"));
    }

    #[test]
    fn patterns_match_folders_suffixes_and_paths() {
        assert!(matches("target/", "target/debug/x") && matches("target/", "a/target/b") && !matches("target/", "targets/x"));
        assert!(matches("*.lock", "Cargo.lock") && !matches("*.lock", "lock.rs"));
        assert!(matches("src/core", "src/core/mod.rs") && matches("src/core", "src/core") && !matches("src/core", "src/corex.rs"));
        assert!(matches(".DS_Store", "a/.DS_Store"));
    }

    #[test]
    fn tree_indents_folders_once() {
        let t = tree(&["a.rs".into(), "src/core/mod.rs".into(), "src/core/tool.rs".into(), "src/main.rs".into()]);
        assert_eq!(t, "a.rs\nsrc/\n  core/\n    mod.rs\n    tool.rs\n  main.rs");
    }

    #[tokio::test]
    async fn the_snapshot_hides_exclusions_and_protected_files_are_read_only() {
        // Inside the workspace (under target/, which builds already ignore); the root is set through config.
        let rel = format!("target/askk-ws-{}", std::process::id());
        let root = base().join(&rel);
        let _ = std::fs::remove_dir_all(&root);
        for (p, t) in [("src/core/mod.rs", "core"), ("src/app.rs", "fn a() {}\n"), ("target/x", "bin"), ("secret.env", "k")] {
            std::fs::create_dir_all(root.join(p).parent().unwrap()).unwrap();
            std::fs::write(root.join(p), t).unwrap();
        }
        let spec = |state: Value| Spec { kind: "workspace".into(), name: "workspace".into(), config: json!({"root": rel, "exclude": ["target/", "*.env"], "protect": ["src/core/"]}), state };
        let mut w = new(spec(Value::Null)).unwrap();
        assert_eq!(snapshot(&root, &["target/".into(), "*.env".into()]), vec!["src/app.rs", "src/core/mod.rs"]);
        let tb = crate::core::Toolbox::new(w.tools());
        async fn call(tb: &crate::core::Toolbox, w: &mut Box<dyn Component>, t: &str, a: Value) -> Result<Value, String> {
            let r = tb.call(t, a.clone()).await;
            w.on(&Event::Called { tool: t.into(), args: a, result: match &r { Ok(v) => v.to_string(), Err(e) => format!("error: {e}") } });
            r
        }
        assert_eq!(call(&tb, &mut w, "open_file", json!({"path": "src/app.rs"})).await.unwrap(), json!(true), "open only answers true");
        assert!(w.prompt().unwrap().contains("### src/app.rs\n   1 fn a() {}"), "the open file is in the view");
        assert!(call(&tb, &mut w, "open_file", json!({"path": "secret.env"})).await.unwrap_err().contains("excluded"));
        assert!(call(&tb, &mut w, "open_file", json!({"path": "../etc/passwd"})).await.is_err());
        assert!(call(&tb, &mut w, "write_file", json!({"path": "src/core/mod.rs", "content": "x"})).await.unwrap_err().contains("protected"));
        call(&tb, &mut w, "edit_file", json!({"path": "src/app.rs", "old": "fn a()", "new": "fn b()"})).await.unwrap();
        assert!(w.prompt().unwrap().contains("fn b() {}"), "the view shows the file as it is now");
        call(&tb, &mut w, "write_file", json!({"path": "src/new.rs", "content": "n"})).await.unwrap();
        let p = w.prompt().unwrap();
        assert!(!p.contains("secret.env") && p.contains("new.rs"), "{p}");
        let w2 = new(spec(w.state())).unwrap();
        assert_eq!(w2.state()["open"], json!(["src/app.rs", "src/new.rs"]), "open files survive a restart");
        call(&tb, &mut w, "close_file", json!({"path": "src/app.rs"})).await.unwrap();
        assert_eq!(w.state()["open"], json!(["src/new.rs"]));
        // What a run changed: each file as it was before the run first touched it, and now.
        w.on(&Event::Bound("ws/test".into()));
        w.on(&Event::Started { run: 7 });
        let tb = crate::core::Toolbox::new(w.tools());
        call(&tb, &mut w, "edit_file", json!({"path": "src/app.rs", "old": "fn b()", "new": "fn c()"})).await.unwrap();
        call(&tb, &mut w, "edit_file", json!({"path": "src/app.rs", "old": "fn c()", "new": "fn d()"})).await.unwrap();
        call(&tb, &mut w, "write_file", json!({"path": "src/more.rs", "content": "m"})).await.unwrap();
        let (run, ch) = changes_of(spec(Value::Null), "ws/test").unwrap();
        assert_eq!(run, 7);
        assert_eq!(ch.iter().map(|c| (c.path.as_str(), c.before.as_deref(), c.after.as_str())).collect::<Vec<_>>(), [("src/app.rs", Some("fn b() {}\n"), "fn d() {}\n"), ("src/more.rs", None, "m")]);
        assert_eq!(read_of(spec(Value::Null), "src/app.rs").unwrap(), "fn d() {}\n");
        assert!(read_of(spec(Value::Null), "secret.env").is_err(), "an excluded file is not shown");
        w.on(&Event::Started { run: 8 });
        assert_eq!(changes_of(spec(Value::Null), "ws/test").unwrap().0, 7, "a run that changes nothing leaves the last changes in sight");
        let _ = std::fs::remove_dir_all(root);
    }
}
