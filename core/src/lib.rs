//! The application core: storage, folder-driven boot, live objects and their twins.
//! No web, desktop or hardware code lives here. Contract: docs/contract.md.

pub mod engine;
pub mod frontmatter;
pub mod hub;
pub mod kinds;
pub mod node;
pub mod object;
pub mod connector;
pub mod design;
pub mod run;
pub mod seed;
pub mod tools;
pub mod toon;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_live;
#[cfg(test)]
mod tests_engine;
#[cfg(test)]
mod tests_design;
#[cfg(test)]
mod tests_phases;
#[cfg(test)]
mod tests_activity;

use anyhow::{Context, Result, anyhow, bail};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs,
    sync::Arc,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub use engine::EngineNode;
pub use hub::{Event, Hub, TaskCtx};
pub use node::Node;
pub use object::{Action, EngineTwin, KindInfo, Obj, Phase, SIZES, Status, TaskFn, TaskFuture, Twin, Views};

pub fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

// ── storage ────────────────────────────────────────────────────────────────

/// Where everything lives between runs. A folder today, a database later.
/// Paths are relative, `/`-separated; a segment never starts with a dot.
pub trait Store: Send + Sync {
    /// Ids of every record of one kind (flat), sorted.
    fn list(&self, kind: &str) -> Result<Vec<String>>;
    /// One JSON record; `kind` "" is top level (runtime.json). An id may hold `/` (state/home/runs).
    fn read(&self, kind: &str, id: &str) -> Result<Option<Value>>;
    /// Written whole and atomically: a reader never sees half a record.
    fn write(&self, kind: &str, id: &str, value: &Value) -> Result<()>;
    /// A text file (an engine's `.md`), None when missing.
    fn read_text(&self, path: &str) -> Result<Option<String>>;
    /// Written atomically like a record.
    fn write_text(&self, path: &str, text: &str) -> Result<()>;
    /// A file or a whole folder; missing is fine.
    fn remove(&self, path: &str) -> Result<()>;
    /// Sub-folder names of a folder, sorted.
    fn dirs(&self, path: &str) -> Result<Vec<String>>;
    /// File stems with one extension in a folder, sorted.
    fn files(&self, path: &str, ext: &str) -> Result<Vec<String>>;
    /// Take the run lock. True when one was already there: the last run did not stop cleanly.
    fn lock(&self) -> Result<bool>;
    fn unlock(&self) -> Result<()>;
}

/// `data/<kind>/<id>.json`, `data/<id>.json` for top-level records, `data/.lock` while running.
pub struct FolderStore {
    root: PathBuf,
    /// Where `engines/…` paths live, when not under `root` (the engine configuration folder).
    engines: Option<PathBuf>,
}

fn segment_ok(s: &str) -> bool {
    !s.is_empty() && !s.starts_with('.') && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

impl FolderStore {
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        fs::create_dir_all(&root).with_context(|| format!("create {}", root.display()))?;
        Ok(Self { root, engines: None })
    }

    /// Like `open`, but `engines/…` reads and writes go to `engines` instead of `<root>/engines`.
    pub fn with_engines(root: impl AsRef<Path>, engines: impl AsRef<Path>) -> Result<Self> {
        let mut s = Self::open(root)?;
        let e = engines.as_ref().to_path_buf();
        fs::create_dir_all(&e).with_context(|| format!("create {}", e.display()))?;
        s.engines = Some(e);
        Ok(s)
    }

    /// The folder engines are read from.
    pub fn engines_dir(&self) -> PathBuf {
        self.engines.clone().unwrap_or_else(|| self.root.join("engines"))
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn rel(&self, path: &str) -> Result<PathBuf> {
        if path.is_empty() {
            return Ok(self.root.clone());
        }
        if !path.split('/').all(segment_ok) {
            bail!("bad path {path}");
        }
        if let Some(e) = &self.engines {
            if path == "engines" {
                return Ok(e.clone());
            }
            if let Some(rest) = path.strip_prefix("engines/") {
                return Ok(e.join(rest));
            }
        }
        Ok(self.root.join(path))
    }

    fn path(&self, kind: &str, id: &str) -> Result<PathBuf> {
        let ok = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        if !id.split('/').all(ok) || !(kind.is_empty() || ok(kind)) {
            bail!("bad record name {kind}/{id}");
        }
        let dir = if kind.is_empty() { self.root.clone() } else { self.root.join(kind) };
        Ok(dir.join(format!("{id}.json")))
    }

    fn atomic(path: &Path, text: &str) -> Result<()> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        // a temp name of its own per write: two writers of one file never share a temp file
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let mut tmp = path.as_os_str().to_owned();
        tmp.push(format!(".{}-{}.tmp", std::process::id(), SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
        fs::write(&tmp, text).with_context(|| format!("write {}", path.display()))?;
        fs::rename(&tmp, path)?;
        Ok(())
    }

    fn entries(&self, path: &str) -> Result<Vec<fs::DirEntry>> {
        let dir = self.rel(path)?;
        if !dir.is_dir() {
            return Ok(vec![]);
        }
        Ok(fs::read_dir(&dir)?.filter_map(|e| e.ok()).collect())
    }
}

impl Store for FolderStore {
    fn list(&self, kind: &str) -> Result<Vec<String>> {
        self.files(kind, "json")
    }

    fn read(&self, kind: &str, id: &str) -> Result<Option<Value>> {
        let path = self.path(kind, id)?;
        match fs::read_to_string(&path) {
            Ok(text) => Ok(Some(serde_json::from_str(&text).with_context(|| format!("parse {}", path.display()))?)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e).with_context(|| format!("read {}", path.display())),
        }
    }

    fn write(&self, kind: &str, id: &str, value: &Value) -> Result<()> {
        Self::atomic(&self.path(kind, id)?, &serde_json::to_string_pretty(value)?)
    }

    fn read_text(&self, path: &str) -> Result<Option<String>> {
        let p = self.rel(path)?;
        match fs::read_to_string(&p) {
            Ok(t) => Ok(Some(t)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e).with_context(|| format!("read {}", p.display())),
        }
    }

    fn write_text(&self, path: &str, text: &str) -> Result<()> {
        Self::atomic(&self.rel(path)?, text)
    }

    fn remove(&self, path: &str) -> Result<()> {
        let p = self.rel(path)?;
        if p == self.root || self.engines.as_ref() == Some(&p) {
            bail!("refusing to remove the data or engines folder");
        }
        if p.is_dir() {
            fs::remove_dir_all(&p)?;
        } else if p.exists() {
            fs::remove_file(&p)?;
        }
        Ok(())
    }

    fn dirs(&self, path: &str) -> Result<Vec<String>> {
        let mut out: Vec<String> = self
            .entries(path)?
            .into_iter()
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .filter_map(|e| e.file_name().to_str().map(String::from))
            .filter(|n| segment_ok(n))
            .collect();
        out.sort();
        Ok(out)
    }

    fn files(&self, path: &str, ext: &str) -> Result<Vec<String>> {
        let suffix = format!(".{ext}");
        let mut out: Vec<String> = self
            .entries(path)?
            .into_iter()
            .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
            .filter_map(|e| e.file_name().to_str()?.strip_suffix(&suffix).map(String::from))
            .filter(|n| segment_ok(n))
            .collect();
        out.sort();
        Ok(out)
    }

    fn lock(&self) -> Result<bool> {
        let path = self.root.join(".lock");
        let held = path.exists();
        fs::write(&path, std::process::id().to_string())?;
        Ok(held)
    }

    fn unlock(&self) -> Result<()> {
        let path = self.root.join(".lock");
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }
}

// ── the runtime: boot, act, shutdown ───────────────────────────────────────

pub const VIEWS: [&str; 2] = ["dashboard", "canvas"];

pub fn default_theme() -> Value {
    design::default_theme()
}

/// The background the desk drew (the older rebuild desk UI, its own gradient fields): hard-edged
/// colour fields in the wall tokens, a soft wash and a fine ripple, under the glass.
pub fn default_background() -> Value {
    json!({
        "image": null,
        "fields": [
            { "at": [1, 1], "size": "md", "color": "wall-a", "hard": true },
            { "at": [7, 7], "size": "lg", "color": "wall-b", "hard": true },
            { "at": [6, 0], "size": "sm", "color": "wall-c", "hard": true },
            { "at": [3, 8], "size": "sm", "color": "wall-d", "hard": true }
        ],
        "wash": true,
        "ripples": true,
        "tint": null,
        "blur": 0,
        "dim": 0
    })
}

/// The page trees (contract §6): each route is a Node tree the UI renders, seeded into `data/ui/`.
/// `default` names the engine the page centres on and the Composer talks to (the first top engine when absent);
/// the Composer is the footer text area (contract §6).
pub fn default_ui(view: &str) -> Value {
    let composer = json!({ "c": "Composer", "props": { "phases": true, "placeholder": "Ask Askk…" } });
    let page = |main: Value| json!({ "c": "Page", "props": { "default": "askk", "background": default_background() }, "children": [{ "c": "Panel" }, main, composer] });
    match view {
        "canvas" => page(json!({ "c": "Canvas", "props": { "source": "engines", "zoom": { "icon": 0.35, "small": 0.6, "medium": 1.25 }, "grid": true, "minimap": true, "edges": "curve" } })),
        _ => page(json!({ "c": "CardGrid", "props": { "source": "engines", "size": "auto", "min": "md", "gap": 4, "max": "page" } })),
    }
}

/// A page tree: a Node `{c, props?, children?}` at every level, scale steps only (`design::check_tree`).
pub fn check_tree(n: &Value) -> Result<()> {
    design::check_tree(n)
}

/// A view's layout before the user saved one.
pub fn default_layout(view: &str) -> Value {
    match view {
        "canvas" => json!({ "positions": {} }),
        _ => json!({ "order": [] }),
    }
}

/// What an action changed: the target's new twin, every twin to resend, or the whole world.
#[derive(Debug, Clone)]
pub struct Outcome {
    pub twin: Value,
    /// (id, twin) for the target and the engines above it.
    pub changed: Vec<(String, Value)>,
    /// A structure action: the folder changed, resend the world.
    pub world: bool,
}

/// What a reload found: whether anything a client sees changed, and the ids whose live object
/// ended (removed, kind changed, or now failed) — their tasks must be cancelled.
#[derive(Debug, Clone, Default)]
pub struct Reloaded {
    pub changed: bool,
    pub gone: Vec<String>,
    /// Ids whose `.md` left the folder: their state files are deleted after a grace period.
    pub removed: Vec<String>,
}

pub struct Runtime {
    store: Arc<dyn Store>,
    /// runtime.json as of this boot: {boots, last_exit, started_at, ...}
    pub info: Value,
    engines: Vec<EngineNode>,
    /// Ids that ended in a structure action's reload, taken by the Hub (`take_gone`).
    gone: Vec<String>,
    /// The page trees as last read from `data/ui/` (view → tree).
    ui: Value,
}

enum Loc {
    Engine(Vec<usize>),
    Element(Vec<usize>, usize),
}

/// The one entry point: everything the app knows comes from the store.
pub fn boot(store: Box<dyn Store>) -> Result<Runtime> {
    let store: Arc<dyn Store> = Arc::from(store);
    let crashed = store.lock()?;
    let prev = store.read("", "runtime")?.unwrap_or_else(|| json!({}));
    let boots = prev["boots"].as_u64().unwrap_or(0) + 1;
    let last_exit = if crashed { "crash".to_string() } else { prev["last_exit"].as_str().unwrap_or("none").to_string() };
    let info = json!({ "boots": boots, "last_exit": last_exit, "started_at": now(), "stopped_at": null });
    store.write("", "runtime", &info)?;
    for v in VIEWS {
        if store.read("ui", v)?.is_none() {
            store.write("ui", v, &default_ui(v))?;
        }
    }
    if store.read("", "theme")?.is_none() {
        store.write("", "theme", &default_theme())?;
    }
    // tolerant: a broken `.md` becomes a `failed` object, as a hot reload does (contract §1)
    let engines = engine::load_with(&engine::Load { store: store.as_ref(), crashed, strict: false, live: None })?;
    if engines.is_empty() {
        bail!("boot found no engines");
    }
    let mut rt = Runtime { store, info, engines, gone: vec![], ui: Value::Null };
    rt.ui = rt.read_ui();
    Ok(rt)
}

/// `icon` in an edit: "" removes it (the kind's default again), else it must pass `design::check_icon`.
fn set_icon(doc: &mut frontmatter::Doc, icon: Option<&str>) -> Result<()> {
    match icon {
        None => {}
        Some("") => {
            doc.meta.remove("icon");
        }
        Some(i) => {
            design::check_icon(i)?;
            doc.meta.insert("icon".into(), json!(i));
        }
    }
    Ok(())
}

fn str_arg<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args[key].as_str().map(str::trim).filter(|s| !s.is_empty())
}

impl Runtime {
    pub fn store(&self) -> Arc<dyn Store> {
        self.store.clone()
    }

    fn snapshot(&self) -> HashMap<String, Obj> {
        let mut m = HashMap::new();
        for e in &self.engines {
            e.collect(&mut m);
        }
        m
    }

    /// Re-read every `.md`. Unchanged ids keep their live phase and state (so do edited ones of the
    /// same kind); new ids are restored from the store; a broken file becomes a `failed` object.
    /// Idempotent: reloading an unchanged folder changes nothing and reports `changed: false`.
    pub fn reload(&mut self) -> Result<Reloaded> {
        let before = serde_json::to_value(self.engines())?;
        let live = self.snapshot();
        let engines = engine::load_with(&engine::Load { store: self.store.as_ref(), crashed: false, strict: false, live: Some(&live) })?;
        self.engines = engines;
        let now = self.snapshot();
        let gone = live
            .iter()
            .filter(|(id, old)| match now.get(*id) {
                None => true,
                Some(new) => new.kind != old.kind || (new.error.is_some() && old.error.is_none()),
            })
            .map(|(id, _)| id.clone())
            .collect();
        let removed = live.keys().filter(|id| !now.contains_key(*id)).cloned().collect();
        let ui = self.read_ui();
        let changed = serde_json::to_value(self.engines())? != before || ui != self.ui;
        self.ui = ui;
        Ok(Reloaded { changed, gone, removed })
    }

    /// Ids a structure action's reload ended since the last call.
    pub fn take_gone(&mut self) -> Vec<String> {
        std::mem::take(&mut self.gone)
    }

    /// One object (engine or element), to read.
    pub fn obj(&self, id: &str) -> Option<&Obj> {
        Some(match self.locate(id)? {
            Loc::Engine(p) => &self.engine_at(&p).obj,
            Loc::Element(p, j) => &self.engine_at(&p).elements[j],
        })
    }

    /// One engine (its whole node), to read.
    pub fn engine_node(&self, id: &str) -> Option<&EngineNode> {
        match self.locate(id)? {
            Loc::Engine(p) => Some(self.engine_at(&p)),
            Loc::Element(..) => None,
        }
    }

    /// One object, to change in memory (the caller persists it).
    pub fn obj_mut(&mut self, id: &str) -> Option<&mut Obj> {
        Some(match self.locate(id)? {
            Loc::Engine(p) => &mut self.engine_at_mut(&p).obj,
            Loc::Element(p, j) => &mut self.engine_at_mut(&p).elements[j],
        })
    }

    /// The long-running part of an action, when the target's kind has one.
    pub fn task_for(&self, target: &str, action: &str) -> Option<TaskFn> {
        let obj = self.obj(target)?;
        if obj.error.is_some() || obj.kind == "engine" {
            return None;
        }
        kinds::find(&obj.kind)?.task(obj, action)
    }

    /// (id, twin) for `target` and every engine above it, nearest first.
    pub fn changed_for(&self, target: &str) -> Vec<(String, Value)> {
        let Some(loc) = self.locate(target) else { return vec![] };
        let path = match &loc {
            Loc::Engine(p) | Loc::Element(p, _) => p.clone(),
        };
        let mut changed = vec![];
        if let Some(t) = self.twin(target) {
            changed.push((target.to_string(), t));
        }
        for n in (1..=path.len()).rev() {
            let e = self.engine_at(&path[..n]);
            if e.obj.id != target {
                changed.push((e.obj.id.clone(), json!(e.twin())));
            }
        }
        changed
    }

    pub fn engines(&self) -> Vec<EngineTwin> {
        self.engines.iter().map(|e| e.twin()).collect()
    }

    pub fn kinds(&self) -> Vec<KindInfo> {
        kinds::KINDS.iter().map(|k| k.info()).collect()
    }

    pub fn theme(&self) -> Value {
        self.store.read("", "theme").ok().flatten().map(|t| if design::check_theme(&t).is_ok() && t.get("space").is_some() { t } else { design::migrate_theme(&t) }).unwrap_or_else(default_theme)
    }

    pub fn layout(&self, view: &str) -> Value {
        self.store.read("layout", view).ok().flatten().unwrap_or_else(|| default_layout(view))
    }

    /// Every view's page tree from `data/ui/<view>.json`; a missing or broken file → the default.
    fn read_ui(&self) -> Value {
        let m: serde_json::Map<String, Value> = VIEWS
            .iter()
            .map(|v| {
                // a tree written before the design rules is migrated to scale steps (nearest step), else the default
                let t = self.store.read("ui", v).ok().flatten().map(|t| if check_tree(&t).is_ok() { t } else { design::migrate_tree(&t) }).filter(|t| check_tree(t).is_ok()).unwrap_or_else(|| default_ui(v));
                (v.to_string(), t)
            })
            .collect();
        Value::Object(m)
    }

    /// POST /ui: one view's page tree, checked, written, kept.
    pub fn set_ui(&mut self, view: &str, tree: &Value) -> Result<()> {
        if !VIEWS.contains(&view) {
            bail!("unknown view {view} (one of {})", VIEWS.join(", "));
        }
        check_tree(tree)?;
        self.store.write("ui", view, tree)?;
        self.ui[view] = tree.clone();
        Ok(())
    }

    /// GET /world.
    pub fn world(&self) -> Value {
        let layouts: serde_json::Map<String, Value> = VIEWS.iter().map(|v| (v.to_string(), self.layout(v))).collect();
        json!({ "engines": self.engines(), "theme": self.theme(), "layouts": layouts, "kinds": self.kinds(), "ui": self.ui })
    }

    pub fn set_layout(&self, view: &str, layout: &Value) -> Result<()> {
        if !VIEWS.contains(&view) {
            bail!("unknown view {view} (one of {})", VIEWS.join(", "));
        }
        self.store.write("layout", view, layout)
    }

    pub fn set_theme(&self, tokens: &Value) -> Result<()> {
        if !tokens.is_object() {
            bail!("theme tokens must be an object");
        }
        design::check_theme(tokens)?;
        self.store.write("", "theme", tokens)
    }

    fn locate(&self, id: &str) -> Option<Loc> {
        fn walk(nodes: &[EngineNode], id: &str, path: &mut Vec<usize>) -> Option<Loc> {
            for (i, n) in nodes.iter().enumerate() {
                path.push(i);
                if n.obj.id == id {
                    return Some(Loc::Engine(path.clone()));
                }
                if let Some(j) = n.elements.iter().position(|e| e.id == id) {
                    return Some(Loc::Element(path.clone(), j));
                }
                if id.starts_with(&format!("{}/", n.obj.id))
                    && let Some(l) = walk(&n.children, id, path)
                {
                    return Some(l);
                }
                path.pop();
            }
            None
        }
        walk(&self.engines, id, &mut vec![])
    }

    fn engine_at(&self, path: &[usize]) -> &EngineNode {
        let mut n = &self.engines[path[0]];
        for &i in &path[1..] {
            n = &n.children[i];
        }
        n
    }

    fn engine_at_mut(&mut self, path: &[usize]) -> &mut EngineNode {
        let mut n = &mut self.engines[path[0]];
        for &i in &path[1..] {
            n = &mut n.children[i];
        }
        n
    }

    /// The current twin of any object (an engine's is its EngineTwin).
    pub fn twin(&self, id: &str) -> Option<Value> {
        Some(match self.locate(id)? {
            Loc::Engine(p) => json!(self.engine_at(&p).twin()),
            Loc::Element(p, j) => { let e = self.engine_at(&p); json!(engine::element_twin(&e.elements[j], Some(e))) },
        })
    }

    /// Record an owner action on an object that is already saved (structure, reply), and save it again.
    fn record_owner(&mut self, target: &str, action: &str, label: &str, args: &Value) {
        if let Some(o) = self.obj_mut(target) {
            o.record(action, args["by"].as_str().unwrap_or("owner"), &act_text(label, args), true);
            let saved = o.saved();
            let _ = self.store.write("state", target, &saved);
        }
    }

    /// Run an action on one object; its new state is written before the twin is returned.
    pub fn act(&mut self, target: &str, action: &str, args: &Value) -> Result<Outcome> {
        let loc = self.locate(target).ok_or_else(|| anyhow!("no object {target}"))?;
        match loc {
            Loc::Engine(p) if action.contains('.') => {
                self.structure(&p, action, args)?;
                self.record_owner(target, action, action, args);
                // an engine that removed itself answers null; the `world` event carries the rest
                let twin = self.twin(target).unwrap_or(Value::Null);
                return Ok(Outcome { changed: vec![], twin, world: true });
            }
            Loc::Engine(p) if action == "reply" => {
                self.reply(&p, args)?;
                self.record_owner(target, action, "Reply", args);
            }
            Loc::Engine(p) => {
                let (saved, below) = {
                    let e = self.engine_at_mut(&p);
                    let before = e.obj.phase;
                    let label = e.actions().into_iter().find(|a| a.name == action).map(|a| a.label).unwrap_or_else(|| action.to_string());
                    e.act(action)?;
                    e.obj.mark(before);
                    e.obj.record(action, args["by"].as_str().unwrap_or("owner"), &act_text(&label, args), true);
                    let below = if action == "stop" { e.stop_below() } else { vec![] };
                    (e.obj.saved(), below)
                };
                self.store.write("state", target, &saved)?;
                for o in below {
                    self.store.write("state", &o.id, &o.saved())?;
                }
            }
            Loc::Element(p, j) => {
                let mut next = self.engine_at(&p).elements[j].clone();
                if let Some(err) = &next.error {
                    bail!("{target} failed to load: {err}");
                }
                let kind = kinds::find(&next.kind).ok_or_else(|| anyhow!("no kind {}", next.kind))?;
                let before = next.phase;
                let was = next.state["current"].clone();
                let label = kind.actions(&next).into_iter().find(|a| a.name == action).map(|a| a.label).unwrap_or_else(|| action.to_string());
                kind.act(&mut next, action, args)?;
                next.mark(before);
                next.record(action, args["by"].as_str().unwrap_or("owner"), &act_text(&label, args), true);
                self.store.write("state", target, &next.saved())?;
                let switched = (next.kind == "phases" && next.state["current"] != was).then(|| run::current_phase(&next)).flatten();
                self.engine_at_mut(&p).elements[j] = next;
                if let Some(ph) = switched {
                    self.phase_message(&p, &ph, args["by"].as_str().unwrap_or("owner"))?;
                }
            }
        }
        let changed = self.changed_for(target);
        let twin = changed.first().map(|c| c.1.clone()).ok_or_else(|| anyhow!("{target} vanished"))?;
        Ok(Outcome { twin, changed, world: false })
    }

    /// element.add / remove / edit, engine.add: the `.md` files change, then everything is reloaded.
    fn structure(&mut self, path: &[usize], action: &str, args: &Value) -> Result<()> {
        let e = self.engine_at(path);
        let (dir, eid_of) = (e.dir.clone(), e.obj.id.clone());
        let store = self.store.as_ref();
        let element = |args: &Value| -> Result<(String, String)> {
            let id = str_arg(args, "id").ok_or_else(|| anyhow!("{action} needs id"))?;
            let short = id.strip_prefix(&format!("{eid_of}/")).unwrap_or(id);
            if !e.elements.iter().any(|x| x.id == format!("{eid_of}/{short}")) {
                bail!("{eid_of} has no element {id}");
            }
            Ok((format!("{dir}/elements/{short}.md"), format!("{eid_of}/{short}")))
        };
        match action {
            "element.add" => {
                let kind = str_arg(args, "kind").ok_or_else(|| anyhow!("element.add needs kind"))?;
                let k = kinds::find(kind).ok_or_else(|| anyhow!("unknown kind {kind}"))?;
                let title = str_arg(args, "title").ok_or_else(|| anyhow!("element.add needs title"))?;
                let config = engine::config_arg(&args["config"], k.config())?;
                let taken = store.files(&format!("{dir}/elements"), "md")?;
                let name = unique(&engine::slug(title), &taken);
                let mut doc = frontmatter::Doc::default();
                doc.meta.insert("title".into(), json!(title));
                doc.meta.insert("kind".into(), json!(kind));
                if let Some(c) = config.filter(|c| !c.is_empty()) {
                    doc.meta.insert("config".into(), Value::Object(c));
                }
                store.write_text(&format!("{dir}/elements/{name}.md"), &frontmatter::render(&doc))?;
            }
            "element.remove" => {
                let (file, id) = element(args)?;
                store.remove(&file)?;
                store.remove(&format!("state/{id}.json"))?;
            }
            "element.edit" => {
                let (file, id) = element(args)?;
                let kind = &e.elements.iter().find(|x| x.id == id).expect("checked").kind;
                let k = kinds::find(kind).ok_or_else(|| anyhow!("unknown kind {kind}"))?;
                let text = store.read_text(&file)?.ok_or_else(|| anyhow!("{file} missing"))?;
                let mut doc = frontmatter::parse(&text)?;
                let config = engine::config_arg(&args["config"], k.config())?;
                let title = str_arg(args, "title");
                let icon = args["icon"].as_str().map(str::trim);
                if title.is_none() && config.is_none() && icon.is_none() {
                    bail!("element.edit needs title, config or icon");
                }
                set_icon(&mut doc, icon)?;
                if let Some(t) = title {
                    doc.meta.insert("title".into(), json!(t));
                }
                if let Some(c) = config {
                    let mut merged = doc.meta.get("config").and_then(Value::as_object).cloned().unwrap_or_default();
                    merged.extend(c);
                    doc.meta.insert("config".into(), Value::Object(merged));
                }
                store.write_text(&file, &frontmatter::render(&doc))?;
            }
            "engine.add" => {
                let title = str_arg(args, "title").ok_or_else(|| anyhow!("engine.add needs title"))?;
                let taken = store.dirs(&format!("{dir}/engines"))?;
                let name = unique(&engine::slug(title), &taken);
                let mut doc = frontmatter::Doc::default();
                doc.meta.insert("title".into(), json!(title));
                doc.meta.insert("kind".into(), json!("engine"));
                store.write_text(&format!("{dir}/engines/{name}/engine.md"), &frontmatter::render(&doc))?;
            }
            "engine.edit" => {
                let file = format!("{dir}/engine.md");
                let text = store.read_text(&file)?.ok_or_else(|| anyhow!("{file} missing"))?;
                let mut doc = frontmatter::parse(&text).with_context(|| format!("data/{file}"))?;
                let title = str_arg(args, "title");
                let body = args["body"].as_str();
                let description = args["description"].as_str().map(str::trim);
                let icon = args["icon"].as_str().map(str::trim);
                if title.is_none() && body.is_none() && description.is_none() && icon.is_none() {
                    bail!("engine.edit needs title, description, body or icon");
                }
                match description {
                    Some("") => {
                        doc.meta.remove("description");
                    }
                    Some(d) => {
                        doc.meta.insert("description".into(), json!(d));
                    }
                    None => {}
                }
                set_icon(&mut doc, icon)?;
                if let Some(t) = title {
                    doc.meta.insert("title".into(), json!(t));
                }
                if let Some(b) = body {
                    doc.body = b.trim().to_string();
                }
                store.write_text(&file, &frontmatter::render(&doc))?;
            }
            "engine.children" => {
                // `{size}` (auto clears it) and/or `{kinds: {loop: {size}}}`: written to engine.md `children:`
                let file = format!("{dir}/engine.md");
                let text = store.read_text(&file)?.ok_or_else(|| anyhow!("{file} missing"))?;
                let mut doc = frontmatter::parse(&text).with_context(|| format!("data/{file}"))?;
                let mut c = doc.meta.get("children").cloned().filter(Value::is_object).unwrap_or_else(|| json!({}));
                match str_arg(args, "size") {
                    Some("auto") => {
                        c.as_object_mut().unwrap().remove("size");
                    }
                    Some(sz) => c["size"] = json!(sz),
                    None => {}
                }
                if let Some(k) = args["kinds"].as_object() {
                    if k.is_empty() { c.as_object_mut().unwrap().remove("kinds"); } else { c["kinds"] = args["kinds"].clone(); }
                }
                design::check_children(&c)?;
                if c.as_object().is_some_and(|m| m.is_empty()) {
                    doc.meta.remove("children");
                } else {
                    doc.meta.insert("children".into(), c);
                }
                store.write_text(&file, &frontmatter::render(&doc))?;
            }
            "engine.remove" => {
                let id = str_arg(args, "id").ok_or_else(|| anyhow!("engine.remove needs id"))?;
                let short = id.strip_prefix(&format!("{eid_of}/")).unwrap_or(id);
                let (rm_dir, rm_id) = if id == eid_of {
                    // an engine removing itself: allowed unless it is the last top engine
                    if path.len() == 1 && self.engines.len() <= 1 {
                        bail!("{eid_of} is the last engine; the app always has one");
                    }
                    (dir.clone(), eid_of.clone())
                } else {
                    let c = e
                        .children
                        .iter()
                        .find(|c| c.obj.id == format!("{eid_of}/{short}"))
                        .ok_or_else(|| anyhow!("{eid_of} has no child engine {id}"))?;
                    (c.dir.clone(), c.obj.id.clone())
                };
                store.remove(&rm_dir)?;
                store.remove(&format!("state/{rm_id}"))?;
                store.remove(&format!("state/{rm_id}.json"))?;
            }
            other => bail!("{eid_of} has no action {other}"),
        }
        let r = self.reload()?;
        self.gone.extend(r.gone);
        Ok(())
    }

    /// `reply {ask?, text}` on an engine: answers one of its open asks (the oldest when `ask` is
    /// absent) and hands the reply to the asking engine's loop as a message.
    fn reply(&mut self, path: &[usize], args: &Value) -> Result<()> {
        let text = str_arg(args, "text").ok_or_else(|| anyhow!("reply needs text"))?.to_string();
        let want = str_arg(args, "ask").map(String::from);
        let e = self.engine_at_mut(path);
        let eid = e.obj.id.clone();
        let asks = e.obj.state.get_mut("asks").and_then(Value::as_array_mut).ok_or_else(|| anyhow!("{eid} has no asks"))?;
        let a = asks
            .iter_mut()
            .find(|a| a["status"] == "open" && want.as_ref().is_none_or(|w| a["id"] == json!(w)))
            .ok_or_else(|| anyhow!("{eid} has no open ask {}", want.clone().unwrap_or_default()))?;
        a["status"] = json!("answered");
        a["reply"] = json!(text);
        a["replied_at"] = json!(now());
        let (ask_id, from) = (a["id"].clone(), a["from"].as_str().unwrap_or("").to_string());
        let saved = e.obj.saved();
        self.store.write("state", &eid, &saved)?;
        let lp = self.engine_node(&from).and_then(|n| n.elements.iter().find(|x| x.kind == "loop" && x.error.is_none())).map(|x| x.id.clone());
        if let Some(lid) = lp
            && let Some(o) = self.obj_mut(&lid)
        {
            if !o.state["messages"].is_array() {
                o.state["messages"] = json!([]);
            }
            o.state["messages"].as_array_mut().expect("array").push(json!({ "role": "reply", "ask": ask_id, "by": "owner", "at": eid, "text": text }));
            let saved = o.saved();
            self.store.write("state", &lid, &saved)?;
        }
        Ok(())
    }

    /// A phase switch is a message of the engine's loop history (`{role: phase, phase, by, text}`): its next step
    /// reads that it now works in another phase. Model, loop state and memory are untouched.
    fn phase_message(&mut self, path: &[usize], ph: &run::PhaseDef, by: &str) -> Result<()> {
        let store = self.store.clone();
        let tools = match &ph.tools {
            Some(t) if t.is_empty() => "No tools".to_string(),
            Some(t) => format!("tools: {}", t.join(", ")),
            None => "every listed tool".to_string(),
        };
        let text = format!("phase → {} ({tools})", ph.label());
        if let Some(o) = self.engine_at_mut(path).elements.iter_mut().find(|x| x.kind == "loop" && x.error.is_none()) {
            if !o.state["messages"].is_array() {
                o.state["messages"] = json!([]);
            }
            o.state["messages"].as_array_mut().expect("array").push(json!({ "role": "phase", "phase": ph.id, "by": by, "text": text, "at": now() }));
            store.write("state", &o.id, &o.saved())?;
        }
        Ok(())
    }

    /// A clean stop: everything running stopped and saved, runtime.json marked clean, lock released.
    pub fn shutdown(mut self) -> Result<()> {
        for engine in &mut self.engines {
            for obj in engine.objs() {
                if obj.error.is_some() {
                    continue; // a broken file's last good state stays on disk
                }
                if matches!(obj.phase, Phase::Running | Phase::Waiting) {
                    obj.phase = Phase::Stopped;
                    obj.since = now();
                }
                self.store.write("state", &obj.id, &obj.saved())?;
            }
        }
        self.info["last_exit"] = json!("clean");
        self.info["stopped_at"] = json!(now());
        self.store.write("", "runtime", &self.info)?;
        self.store.unlock()
    }
}

fn unique(base: &str, taken: &[String]) -> String {
    if !taken.iter().any(|t| t == base) {
        return base.to_string();
    }
    (2..).map(|n| format!("{base}-{n}")).find(|c| !taken.contains(c)).expect("unbounded")
}

/// "Label · key: value, …" (≤ 80 chars, `by` left out).
pub fn act_text(label: &str, args: &Value) -> String {
    let parts: Vec<String> = args
        .as_object()
        .map(|m| m.iter().filter(|(k, _)| k.as_str() != "by").map(|(k, v)| format!("{k}: {}", v.as_str().map(String::from).unwrap_or_else(|| v.to_string()))).collect())
        .unwrap_or_default();
    let t = if parts.is_empty() { label.to_string() } else { format!("{label} · {}", parts.join(", ")) };
    object::clip(&t, 80)
}
