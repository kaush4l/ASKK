//! # Reread: a file edited by hand takes effect while the service runs
//!
//! A person opens a file in the home and saves it: the settings, the models, an engine's
//! `goal.md` or `engine.json`. The service must not be stopped for that. So:
//!
//! 1. The host looks at the home now and then and tells the core which keys were changed by
//!    someone other than the service itself ([`looks_with`]; on a machine: `host/watch.rs`).
//! 2. [`apply`] reads each changed key again and puts it in force where it lives: in the
//!    settings, in the running engine, or simply by marking it changed
//!    ([`super::changes`]), because most files are read fresh each time they are asked for.
//! 3. Every key that took effect is marked on the one change feed, so every window redraws.
//!
//! [`reload`] does the same when asked, and its answer ([`Reloaded`]) says in plain words what
//! was read again, what waits for a restart, and what was refused and why. Not everything
//! can change in place; [`about`] says what cannot.
use super::held::Held;
use super::store::Store;
use super::{boot, changes, manifest, Engine, EngineFile, Event, Spec};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, OnceLock};

/// What reading the home again did.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Reloaded {
    /// What was read again and is in force, one sentence per file.
    pub reread: Vec<String>,
    /// What changed on disk but holds only after `askk restart`, and why.
    pub needs_restart: Vec<String>,
    /// What could not be read, and why; what was in force before is kept.
    pub refused: Vec<String>,
    /// Always the same: which files are looked at, and what never changes in place.
    pub about: String,
}

/// Which files are looked at, and what is read at start only.
pub fn about() -> String {
    let m = manifest::manifest();
    format!(
        "Looked at: {}, {}, {}, {}, {}, {}, {}, {}, {}, every page ({}/…/page.json), every component ({}/*.json), and each engine's engine.json, elements/*.json and *.md files. Read at start only: {} (where every part lives), an engine or element that is new or was removed, values filled in from personal/bindings.json, the address the service listens at, the environment, and the program itself (a new build runs after `askk restart`).",
        super::settings::KEY, m.models, m.theme, m.ui, m.layout, m.surfaces, m.senses, m.harnesses, m.modes, m.routes, m.components, manifest::KEY
    )
}

/// `key` below `root` (`engines/askk/goal.md` below `engines` is `askk/goal.md`).
fn below<'a>(root: &str, key: &'a str) -> Option<&'a str> {
    key.strip_prefix(root).and_then(|r| r.strip_prefix('/'))
}

/// The top-level folders of the data place that hold files a person edits.
pub fn folders() -> Vec<String> {
    let m = manifest::manifest();
    vec![m.engines.clone(), m.routes.clone(), m.components.clone()]
}

/// A folder inside those that holds only what the service writes for itself.
pub fn own_folder(name: &str) -> bool {
    name == boot::RUNS || name == boot::STATE
}

/// Whether `key` is a file a person edits by hand, so it is worth looking at.
pub fn watched(key: &str) -> bool {
    let m = manifest::manifest();
    if key == manifest::KEY || key == super::settings::KEY || [&m.models, &m.theme, &m.ui, &m.layout, &m.surfaces, &m.senses, &m.harnesses, &m.modes].iter().any(|k| *k == key) {
        return true;
    }
    if let Some(rest) = below(&m.routes, key) {
        return rest == "page.json" || rest.ends_with("/page.json");
    }
    if let Some(rest) = below(&m.components, key) {
        return rest.ends_with(".json");
    }
    let Some(rest) = below(&m.engines, key) else { return false };
    let parts: Vec<&str> = rest.split('/').collect();
    let (name, folder) = (parts[parts.len() - 1], if parts.len() > 1 { parts[parts.len() - 2] } else { "" });
    !parts.iter().any(|p| own_folder(p)) && (name == "engine.json" || name.ends_with(".md") || (folder == "elements" && name.ends_with(".json")))
}

type Look = Box<dyn Fn() -> Result<Vec<String>, String> + Send + Sync>;

static LOOK: OnceLock<Look> = OnceLock::new();

/// Name how this build finds the keys someone else changed since it last looked. The first
/// call wins.
pub fn looks_with(look: impl Fn() -> Result<Vec<String>, String> + Send + Sync + 'static) {
    let _ = LOOK.set(Box::new(look));
}

/// The running engine at `path`, without ever starting the boot.
fn running(path: &str) -> Option<Arc<Engine>> {
    let root = path.split('/').next().unwrap_or_default();
    super::world::started()?.engines.iter().find(|e| e.path == root).and_then(|e| e.find(path))
}

/// Look now, and put in force whatever was changed by hand. A build with nowhere to look
/// says so.
pub fn reload() -> Reloaded {
    match LOOK.get() {
        None => Reloaded { about: "This build keeps what it knows where no person edits it by hand (a browser's storage, or memory), so there is nothing to read again.".into(), ..Default::default() },
        Some(look) => match look() {
            Ok(keys) => apply(&*super::store::data(), &keys, &running),
            Err(e) => Reloaded { refused: vec![e], about: about(), ..Default::default() },
        },
    }
}

/// Read each of `keys` again from `store` and put it in force. `find` gives the running
/// engine at a path.
pub fn apply(store: &dyn Store, keys: &[String], find: &dyn Fn(&str) -> Option<Arc<Engine>>) -> Reloaded {
    let mut out = Reloaded { about: about(), ..Default::default() };
    for key in keys {
        one(store, key, find, &mut out);
    }
    out
}

fn one(store: &dyn Store, key: &str, find: &dyn Fn(&str) -> Option<Arc<Engine>>, out: &mut Reloaded) {
    let m = manifest::manifest();
    if key == manifest::KEY {
        out.needs_restart.push(format!("{key}: where every part lives is read at start only (`askk restart`)"));
    } else if key == super::settings::KEY {
        match super::settings::take(store) {
            Ok(taken) => {
                out.reread.extend(taken.in_force);
                out.needs_restart.extend(taken.needs_restart);
                changes::mark(key);
            }
            Err(e) => out.refused.push(format!("{e}; the settings in force are kept")),
        }
    } else if let Some(rest) = below(&m.engines, key) {
        engine(store, key, rest, find, out);
    } else {
        plain(store, key, *key == m.models, out);
    }
}

/// A file that is read from the store each time it is asked for: checking it and marking it
/// changed is all there is to do. The models are bound until their key is marked, so a file
/// that cannot be read leaves the models in use as they were.
fn plain(store: &dyn Store, key: &str, models: bool, out: &mut Reloaded) {
    let Some(text) = store.get(key) else {
        changes::mark(key);
        return out.reread.push(format!("{key}: it is gone, and every window that showed it is told"));
    };
    let bad = if models {
        serde_json::from_str::<super::models::Models>(&text).err()
    } else if key.ends_with(".json") {
        serde_json::from_str::<serde_json::Value>(&text).err()
    } else {
        None
    };
    match (bad, models) {
        (Some(e), true) => out.refused.push(format!("{key}: {e}; the models in use are kept")),
        (Some(e), false) => out.refused.push(format!("{key}: {e}; until it is mended, nothing is shown from it")),
        (None, _) => {
            changes::mark(key);
            out.reread.push(if models { format!("{key}: the next question to a model uses it") } else { format!("{key}: every window that shows it draws it again") });
        }
    }
}

/// A file of an engine: `<path>/engine.json`, `<path>/elements/<name>.json`, `<path>/<text>.md`.
fn engine(store: &dyn Store, key: &str, rest: &str, find: &dyn Fn(&str) -> Option<Arc<Engine>>, out: &mut Reloaded) {
    let Some((folder, name)) = rest.rsplit_once('/') else { return };
    let (path, recipe) = match folder.strip_suffix("/elements") {
        Some(path) => (path, true),
        None => (folder, false),
    };
    let Some(e) = find(path) else {
        if name == "engine.json" && store.has(key) {
            out.needs_restart.push(format!("{key}: an engine that was not there at start is booted at the next start (`askk restart`)"));
        }
        return;
    };
    let Some(text) = store.get(key) else {
        if recipe || name == "engine.json" {
            out.needs_restart.push(format!("{key}: it is gone, and the engine goes on as it was until the next start"));
        }
        return;
    };
    if recipe {
        take_recipe(&e, key, name.trim_end_matches(".json"), &text, out);
    } else if name == "engine.json" {
        take_file(&e, key, &text, out);
    } else {
        take_text(&e, key, name, text, out);
    }
}

/// `engine.json`: who the engine is and how it runs. Its status is the engine's own.
fn take_file(e: &Engine, key: &str, text: &str, out: &mut Reloaded) {
    let mut new: EngineFile = match serde_json::from_str(text) {
        Ok(f) => f,
        Err(err) => return out.refused.push(format!("{key}: {err}; the engine keeps what it had")),
    };
    if let Err(err) = new.flow.validate() {
        return out.refused.push(format!("{key}: flow: {err}; the engine keeps what it had"));
    }
    {
        let mut file = e.file.held();
        new.status = file.status.clone();
        if *file == new {
            return;
        }
        *file = new;
    }
    e.bump();
    changes::mark(key);
    out.reread.push(format!("{key}: its name, words and icon show at once; its model, steps and flow hold from its next run"));
}

/// `elements/<name>.json`: how one element behaves. What the element remembers stays.
fn take_recipe(e: &Engine, key: &str, name: &str, text: &str, out: &mut Reloaded) {
    let mut new: Spec = match serde_json::from_str(text) {
        Ok(s) => s,
        Err(err) => return out.refused.push(format!("{key}: {err}; the element keeps what it had")),
    };
    if new.name.is_empty() {
        new.name = name.into();
    }
    let mut els = e.elements.held();
    let Some(i) = els.iter().position(|c| c.name() == new.name) else {
        return out.needs_restart.push(format!("{key}: an element that was not there at start is added at the next start (`askk restart`)"));
    };
    let old = els[i].spec();
    // Built from holes: what is in force was filled in at start, so only a restart can fill it again.
    if let Some(recipe) = e.recipes.get(&new.name) {
        if *recipe != new.config {
            out.needs_restart.push(format!("{key}: this element takes values from personal/bindings.json, and they are filled in at start only (`askk restart`)"));
        }
        return;
    }
    if old.kind == new.kind && old.config == new.config {
        return;
    }
    if old.kind != new.kind || super::param::has_holes(&new.config) {
        return out.needs_restart.push(format!("{key}: an element changes its kind, or takes values from personal/bindings.json, at start only (`askk restart`)"));
    }
    match super::build(Spec { state: old.state, ..new }) {
        Ok(mut c) => {
            c.on(&Event::Bound(e.path.clone()));
            els[i] = c;
            drop(els);
            e.bump();
            changes::mark(key);
            out.reread.push(format!("{key}: in force from the engine's next step"));
        }
        Err(err) => out.refused.push(format!("{key}: {err}; the element keeps what it had")),
    }
}

/// A text an element keeps as a file (`goal.md`): the file is the element's memory. A text
/// no element keeps (`asks.md`) is read fresh by whoever shows it.
fn take_text(e: &Engine, key: &str, name: &str, text: String, out: &mut Reloaded) {
    let mut els = e.elements.held();
    let Some(i) = els.iter().position(|c| c.config()["file"].as_str() == Some(name)) else {
        drop(els);
        changes::mark(key);
        return out.reread.push(format!("{key}: every window that shows it draws it again"));
    };
    let old = els[i].spec();
    if old.state["text"].as_str() == Some(text.as_str()) {
        return;
    }
    match super::build(Spec { state: serde_json::json!({ "text": text }), ..old }) {
        Ok(mut c) => {
            c.on(&Event::Bound(e.path.clone()));
            els[i] = c;
            drop(els);
            e.bump();
            changes::mark(key);
            out.reread.push(format!("{key}: in the engine's next prompt"));
        }
        Err(err) => out.refused.push(format!("{key}: {err}; the engine keeps the text it had")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::engine::tests::{file, spec, Scripted};
    use crate::core::store::Bundle;
    use serde_json::json;

    fn world() -> (Bundle, Arc<Engine>) {
        let goal = Spec { state: json!({"text": "old goal"}), ..spec("notes", "goal", json!({"file": "goal.md"})) };
        let e = Arc::new(Engine::new(file("coder"), "t/coder".into(), vec![goal], vec![], vec![], Scripted::new(&[])).unwrap());
        let keys = [("engines/t/coder/goal.md", "old goal"), ("engines/t/coder/engine.json", r#"{"name": "coder", "max_steps": 8}"#), ("engines/t/coder/elements/goal.json", r#"{"kind": "notes", "config": {"file": "goal.md"}}"#)];
        (Bundle::memory(keys.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()), e)
    }

    fn keys(k: &[&str]) -> Vec<String> {
        k.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_goal_edited_by_hand_is_in_the_running_engines_next_prompt_and_on_the_feed() {
        let (store, e) = world();
        let find = |p: &str| (p == "t/coder").then(|| e.clone());
        let seen = changes::now();
        store.put("engines/t/coder/goal.md", "find the smallest prime above 100").unwrap();
        let did = apply(&store, &keys(&["engines/t/coder/goal.md"]), &find);
        assert_eq!(did.reread, ["engines/t/coder/goal.md: in the engine's next prompt"], "{did:?}");
        assert!(e.prompt(&e.toolbox(), "hi").contains("find the smallest prime above 100"), "the engine was not restarted, and reads the new goal");
        let marked: Vec<String> = changes::since(seen).1.into_iter().map(|(k, _)| k).collect();
        assert!(marked.contains(&"t/coder".to_string()) && marked.contains(&"engines/t/coder/goal.md".to_string()), "every window hears it: {marked:?}");
        assert!(apply(&store, &keys(&["engines/t/coder/goal.md"]), &find).reread.is_empty(), "read twice, nothing new to say");
    }

    #[test]
    fn an_engine_file_edited_by_hand_holds_from_the_next_run_and_a_broken_one_is_refused() {
        let (store, e) = world();
        let find = |p: &str| (p == "t/coder").then(|| e.clone());
        e.file.held().status = "idle".into();
        store.put("engines/t/coder/engine.json", r#"{"name": "coder", "max_steps": 3, "icon": "x", "status": "typed by hand"}"#).unwrap();
        let did = apply(&store, &keys(&["engines/t/coder/engine.json"]), &find);
        assert_eq!(did.reread.len(), 1, "{did:?}");
        let f = e.file.held().clone();
        assert_eq!((f.max_steps, f.icon.as_str(), f.status.as_str()), (3, "x", "idle"), "the status stays the engine's own");
        store.put("engines/t/coder/engine.json", "{").unwrap();
        let did = apply(&store, &keys(&["engines/t/coder/engine.json"]), &find);
        assert!(did.refused[0].starts_with("engines/t/coder/engine.json: ") && did.refused[0].ends_with("the engine keeps what it had"), "{did:?}");
        assert_eq!(e.file.held().max_steps, 3);
    }

    #[test]
    fn what_cannot_change_in_place_says_so() {
        let (store, e) = world();
        let find = |p: &str| (p == "t/coder").then(|| e.clone());
        store.put("engines/t/new/engine.json", r#"{"name": "new"}"#).unwrap();
        store.put("engines/t/coder/elements/extra.json", r#"{"kind": "notes"}"#).unwrap();
        store.put("engines/t/coder/elements/goal.json", r#"{"kind": "notes", "config": {"file": "goal.md", "hint": "what it is for"}}"#).unwrap();
        store.put("models.json", "not json").unwrap();
        let did = apply(&store, &keys(&["askk.json", "engines/t/new/engine.json", "engines/t/coder/elements/extra.json", "engines/t/coder/elements/goal.json", "models.json", "theme.json"]), &find);
        assert_eq!(did.needs_restart.len(), 3, "{did:?}");
        assert!(did.needs_restart.iter().all(|s| s.contains("at start only") || s.contains("at the next start")), "{did:?}");
        assert_eq!(did.refused.len(), 1, "{did:?}");
        assert!(did.refused[0].ends_with("the models in use are kept"));
        assert_eq!(did.reread, ["engines/t/coder/elements/goal.json: in force from the engine's next step", "theme.json: it is gone, and every window that showed it is told"]);
        assert_eq!(e.elements.held()[0].spec().state["text"], "old goal", "a new recipe keeps what the element remembers");
        assert!(did.about.contains("settings.json") && did.about.contains("askk restart"));
    }

    #[test]
    fn only_files_a_person_edits_are_looked_at() {
        for yes in ["settings.json", "models.json", "askk.json", "routes/page.json", "routes/talk/page.json", "components/card.json", "engines/askk/engine.json", "engines/askk/coder/goal.md", "engines/askk/coder/elements/goal.json"] {
            assert!(watched(yes), "{yes} is edited by hand");
        }
        for no in ["askk.pid", "board.json", "jobs.json", "engines/askk/runs/17.json", "engines/askk/memory/history.json", "engines/askk/coder/memory/notes.md", "sessions/a.json", "engines/askk/elements/readme.txt"] {
            assert!(!watched(no), "{no} is the service's own");
        }
    }
}
