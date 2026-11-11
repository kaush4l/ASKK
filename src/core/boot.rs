//! # Boot: store scan → initialised engines (server only)
//!
//! ```text
//! engines/<engine>/engine.json            {name, description, model, max_steps, status}
//! engines/<engine>/elements/<name>.json   {kind, name?, config}   the recipe: shareable
//! engines/<engine>/memory/<name>.json     what the element remembers: never shared
//! engines/<engine>/<sub>/engine.json      a sub-engine (any depth), same layout
//! engines/<engine>/runs/<id>.json         its last runs, step by step (`core/run.rs`)
//! ```
//! Keys are in a [`Store`] (a folder, one bundle file, a database later: any source, one
//! standard form). Boot, in order:
//!
//! 1. [`seed`]: copy the defaults store into the data store for anything missing.
//! 2. [`load`]: read the [`Manifest`] (`askk.json`), then [`scan`] what it names into a
//!    [`Snapshot`] — every engine as a [`Tree`] of configuration + state, nothing initialised.
//! 3. [`init`]: turn each tree into an [`Engine`] built only from that state, whose save hook
//!    writes it back to the same keys and whose changes mark the same key.
use crate::core::held::Held;
use super::manifest::Manifest;
use super::store::{join, Store};
use super::*;

#[derive(Clone, Debug, PartialEq)]
pub struct Tree {
    /// The engine's key in the store (`engines/askk/designer`).
    pub dir: String,
    pub path: String,
    pub file: EngineFile,
    pub specs: Vec<Spec>,
    pub subs: Vec<Tree>,
    /// Its last runs, oldest first (the record of what each step did).
    pub runs: Vec<run::Run>,
}

/// Where an engine's run records are kept, under its own key.
pub const RUNS: &str = "runs";
/// Where each element's state is kept, apart from its recipe (`elements/`).
pub const STATE: &str = "memory";

fn read_json<T: serde::de::DeserializeOwned>(store: &dyn Store, key: &str) -> Result<T, String> {
    let s = store.get(key).ok_or_else(|| format!("{key}: missing"))?;
    serde_json::from_str(&s).map_err(|e| format!("{key}: {e}"))
}

/// One engine (and its sub-engines) at `dir`.
pub fn scan_one(store: &dyn Store, dir: &str, path: String) -> Result<Tree, String> {
    let file: EngineFile = read_json(store, &join(dir, "engine.json"))?;
    let mut specs = vec![];
    for f in store.list(&join(dir, "elements")).into_iter().filter(|e| !e.dir && e.name.ends_with(".json")) {
        let mut s: Spec = read_json(store, &join(dir, &format!("elements/{}", f.name)))?;
        if s.name.is_empty() {
            s.name = f.name.trim_end_matches(".json").into();
        }
        // State lives apart from the recipe; an older file that still carries it is read as it is
        // and split on the next save.
        if let Some(st) = store.get(&join(dir, &format!("{STATE}/{}.json", s.name))) {
            s.state = serde_json::from_str(&st).map_err(|e| format!("{dir}/{STATE}/{}.json: {e}", s.name))?;
        }
        // An element with `config.file` keeps its state as that key's text (goal.md, …).
        if let Some(md) = s.config["file"].as_str() {
            s.state = serde_json::json!({"text": store.get(&join(dir, md)).unwrap_or_default()});
        }
        specs.push(s);
    }
    // Run records: the newest `KEEP`, oldest first (ids are times, so names sort by age).
    let mut names: Vec<String> = store.list(&join(dir, RUNS)).into_iter().filter(|e| !e.dir && e.name.ends_with(".json")).map(|e| e.name).collect();
    names.sort_by_key(|n| n.trim_end_matches(".json").parse::<u64>().unwrap_or(0));
    let skip = names.len().saturating_sub(run::KEEP);
    let runs: Vec<run::Run> = names[skip..].iter().filter_map(|n| read_json(store, &join(dir, &format!("{RUNS}/{n}"))).ok()).collect();
    let mut subs = vec![];
    for d in store.list(dir).into_iter().filter(|e| e.dir) {
        let sub = join(dir, &d.name);
        if store.has(&join(&sub, "engine.json")) {
            subs.push(scan_one(store, &sub, format!("{path}/{}", d.name))?);
        }
    }
    Ok(Tree { dir: dir.into(), path, file, specs, subs, runs })
}

/// Every domain object boot initialises, read from one source in the standard form.
#[derive(Clone, Debug, PartialEq)]
pub struct Snapshot {
    pub manifest: Manifest,
    pub engines: Vec<Tree>,
}

impl Snapshot {
    /// One line: what was found (`3 engines, 21 elements`).
    pub fn report(&self) -> String {
        fn count(t: &Tree) -> (usize, usize) {
            t.subs.iter().map(count).fold((1, t.specs.len()), |a, b| (a.0 + b.0, a.1 + b.1))
        }
        let (e, s) = self.engines.iter().map(count).fold((0, 0), |a, b| (a.0 + b.0, a.1 + b.1));
        format!("{e} engines, {s} elements")
    }
}

/// Read the manifest, then everything it names.
pub fn load(store: &dyn Store) -> Result<Snapshot, String> {
    let manifest = Manifest::read(store)?;
    let engines = scan(store, &manifest.engines)?;
    Ok(Snapshot { manifest, engines })
}

/// Every top-level engine under `root` (a key, e.g. `engines`).
pub fn scan(store: &dyn Store, root: &str) -> Result<Vec<Tree>, String> {
    store
        .list(root)
        .into_iter()
        .filter(|d| d.dir && store.has(&join(root, &format!("{}/engine.json", d.name))))
        .map(|d| scan_one(store, &join(root, &d.name), d.name))
        .collect()
}

/// Write an engine's file and every element's spec back to its keys.
pub fn save(store: &dyn Store, dir: &str, e: &Engine) -> Result<(), String> {
    store.put(&join(dir, "engine.json"), &serde_json::to_string_pretty(&*e.file.held()).unwrap())?;
    let specs = e.specs();
    for mut s in specs.clone() {
        if let Some(r) = e.recipes.get(&s.name) {
            s.config = r.clone();
        }
        let state_key = join(dir, &format!("{STATE}/{}.json", s.name));
        if let Some(md) = s.config["file"].as_str() {
            store.put(&join(dir, md), s.state["text"].as_str().unwrap_or_default())?;
        } else if !s.state.is_null() {
            store.put(&state_key, &serde_json::to_string(&s.state).unwrap())?;
        }
        if (s.config["file"].is_string() || s.state.is_null()) && store.has(&state_key) {
            store.remove(&state_key)?;
        }
        s.state = Value::Null;
        store.put(&join(dir, &format!("elements/{}.json", s.name)), &serde_json::to_string_pretty(&s).unwrap())?;
    }
    // Memory of an element that is gone would be inherited by the next one of that name.
    let names: Vec<String> = specs.iter().map(|s| format!("{}.json", s.name)).collect();
    for f in store.list(&join(dir, STATE)).into_iter().filter(|f| !f.dir && !names.contains(&f.name)) {
        store.remove(&join(dir, &format!("{STATE}/{}", f.name)))?;
    }
    // The current run's record, when it changed; older records beyond `KEEP` are dropped.
    if let Some(r) = e.take_logged() {
        let runs = join(dir, RUNS);
        store.put(&join(&runs, &format!("{}.json", r.id)), &serde_json::to_string(&r).unwrap())?;
        let mut old: Vec<u64> = store.list(&runs).into_iter().filter_map(|f| f.name.trim_end_matches(".json").parse().ok()).collect();
        old.sort();
        for id in &old[..old.len().saturating_sub(run::KEEP)] {
            store.remove(&join(&runs, &format!("{id}.json")))?;
        }
    }
    Ok(())
}

pub fn init(t: Tree, store: Arc<dyn Store>, shared: &[Arc<dyn Tool>], infer: Arc<dyn Infer>) -> Result<Arc<Engine>, String> {
    let subs = t.subs.into_iter().map(|s| init(s, store.clone(), shared, infer.clone())).collect::<Result<Vec<_>, _>>()?;
    let mut file = t.file;
    if file.status == "running" {
        file.status = "interrupted".into();
    }
    // Holes are filled from the user's bindings here and only here; the recipe is what is saved.
    let bound = param::bound(&t.path);
    let mut recipes = std::collections::HashMap::new();
    let mut specs = t.specs;
    for s in specs.iter_mut().filter(|s| param::has_holes(&s.config)) {
        let filled = param::resolve(&s.config, &bound).map_err(|err| format!("{}: {}: {err}", t.path, s.name))?;
        recipes.insert(s.name.clone(), std::mem::replace(&mut s.config, filled));
    }
    let mut e = Engine::new(file, t.path.clone(), specs, subs, shared.to_vec(), infer).map_err(|err| format!("{}: {err}", t.path))?;
    e.recipes = recipes;
    e.key = t.dir.clone();
    // A run that was still going when the process stopped did not finish.
    *e.runs.held() = t.runs.into_iter().map(|mut r| { if r.running() { r.status = "interrupted".into(); } r }).collect();
    let dir = t.dir;
    e.save = Some(Arc::new(move |e: &Engine| {
        if let Err(err) = save(&*store, &dir, e) {
            eprintln!("save {dir}: {err}");
        }
    }));
    Ok(Arc::new(e))
}

/// Copy each top-level entry of `defaults` into `data` if `data` lacks it.
pub fn seed(defaults: &dyn Store, data: &dyn Store) -> Result<(), String> {
    for e in defaults.list("") {
        if !data.has(&e.name) {
            super::store::copy(defaults, &e.name, data, &e.name)?;
        }
    }
    seed_pages(defaults, data)
}

/// A page that ships after a home was made still reaches it: each page folder of `defaults`
/// that `data` lacks is copied. A page the home already has is never touched.
fn seed_pages(defaults: &dyn Store, data: &dyn Store) -> Result<(), String> {
    let routes = Manifest::read(defaults)?.routes;
    for e in defaults.list(&routes).into_iter().filter(|e| e.dir) {
        let key = format!("{routes}/{}", e.name);
        if !data.has(&key) {
            super::store::copy(defaults, &key, data, &key)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::engine::tests::Scripted;
    use serde_json::json;

    #[test]
    fn a_page_shipped_later_reaches_an_older_home_and_its_own_pages_stay() {
        let mem = |keys: &[(&str, &str)]| crate::core::store::Bundle::memory(keys.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect());
        let defaults = mem(&[("routes/page.json", "new home"), ("routes/old/page.json", "shipped old"), ("routes/rooms/page.json", "shipped rooms")]);
        let data = mem(&[("routes/page.json", "mine"), ("routes/old/page.json", "mine too")]);
        seed(&defaults, &data).unwrap();
        assert_eq!(data.get("routes/rooms/page.json").as_deref(), Some("shipped rooms"));
        assert_eq!((data.get("routes/page.json").unwrap(), data.get("routes/old/page.json").unwrap()), ("mine".to_string(), "mine too".to_string()));
    }

    #[tokio::test]
    async fn store_scan_initialises_engines_and_state_survives_restart() {
        let (st, root) = crate::core::store::temp("boot");
        let w = |k: &str, v: Value| st.put(k, &v.to_string()).unwrap();
        w("top/engine.json", json!({"name": "top"}));
        w("top/elements/history.json", json!({"kind": "history"}));
        w("top/sub/engine.json", json!({"name": "sub", "description": "helps"}));
        w("bare/engine.json", json!({"name": "bare"}));
        w("top/elements/learning.json", json!({"kind": "notes", "config": {"file": "learning.md", "mode": "sections"}}));
        st.put("top/learning.md", "## tools\n- add works\n").unwrap();
        st.put("not-an-engine/readme.md", "x").unwrap();

        let trees = scan(&*st, "").unwrap();
        assert_eq!(trees.iter().map(|t| t.path.as_str()).collect::<Vec<_>>(), ["bare", "top"]);
        assert_eq!(trees[1].subs[0].path, "top/sub");
        assert_eq!(trees[1].specs[0].name, "history", "name defaults to the key's stem");
        assert_eq!(trees[1].specs[1].state["text"], "## tools\n- add works\n", "state read from learning.md");

        let top = init(trees[1].clone(), st.clone(), &[], Scripted::new(&["hello"])).unwrap();
        assert!(top.find("top/sub").is_some());
        assert!(top.toolbox().names().contains(&"sub".to_string()), "sub-engine is a tool");
        top.run("hi").await.unwrap();

        let again = scan(&*st, "").unwrap();
        let turns = &again[1].specs[0].state["turns"];
        assert_eq!(turns.as_array().unwrap().len(), 2, "history persisted: {turns}");
        assert_eq!(again[1].file.status, "idle");
        assert_eq!(st.get("top/learning.md").unwrap(), "## tools\n- add works\n", "md written back");
        assert!(st.get("top/elements/learning.json").unwrap().contains("\"state\": null"), "state lives in the .md only");
        assert!(st.get("top/elements/history.json").unwrap().contains("\"state\": null"), "a recipe file holds no state");
        assert!(st.get("top/memory/history.json").unwrap().contains("turns"), "the state is kept apart");
        // The run's record is kept with the engine and comes back after a restart.
        assert_eq!(again[1].runs.len(), 1, "one run, one record");
        let r = &again[1].runs[0];
        assert_eq!((r.input.as_str(), r.status.as_str(), r.answer.as_str()), ("hi", "done", "hello"));
        let stages: Vec<_> = r.steps[0].marks.iter().map(|m| m.stage).collect();
        assert_eq!(stages, crate::core::flow::Stage::STEP.iter().copied().filter(|s| *s != crate::core::flow::Stage::Refocus).collect::<Vec<_>>(), "every stage entered is recorded");
        assert!(r.steps[0].marks.iter().any(|m| m.detail.iter().any(|(k, v)| k == "prompt" && v.contains("## input"))), "the prompt as sent is kept");
        let back = init(again[1].clone(), st.clone(), &[], Scripted::new(&[])).unwrap();
        assert_eq!(back.runs().len(), 1, "the record is loaded with the engine");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_old_element_file_is_read_and_split() {
        let (st, root) = crate::core::store::temp("boot-split");
        st.put("e/engine.json", r#"{"name": "e"}"#).unwrap();
        st.put("e/elements/h.json", r#"{"kind": "history", "config": {"max": 4}, "state": {"turns": [["user", "hi"]]}}"#).unwrap();
        let t = scan_one(&*st, "e", "e".into()).unwrap();
        assert_eq!(t.specs[0].state["turns"][0][1], "hi", "the old form is read as it is");
        let e = init(t, st.clone(), &[], crate::core::engine::tests::Scripted::new(&[])).unwrap();
        save(&*st, "e", &e).unwrap();
        let recipe: Value = serde_json::from_str(&st.get("e/elements/h.json").unwrap()).unwrap();
        assert!(recipe["state"].is_null() && recipe["config"]["max"] == 4, "the recipe keeps only its config: {recipe}");
        assert!(st.get("e/memory/h.json").unwrap().contains("hi"), "the state moved apart");
        assert!(scan_one(&*st, "e", "e".into()).unwrap().specs[0].state.to_string().contains("hi"), "and comes back");
        st.put("e/memory/gone.json", r#"{"turns": []}"#).unwrap();
        save(&*st, "e", &e).unwrap();
        assert!(!st.has("e/memory/gone.json"), "memory of an element that is gone is removed");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_hole_is_filled_at_init_and_never_saved() {
        let (st, root) = crate::core::store::temp("boot-holes");
        st.put("holes-a/engine.json", r#"{"name": "a"}"#).unwrap();
        st.put("holes-a/elements/h.json", r#"{"kind": "history", "config": {"max": {"$": "turns"}}}"#).unwrap();
        st.put("holes-b/engine.json", r#"{"name": "b"}"#).unwrap();
        st.put("holes-b/elements/h.json", r#"{"kind": "history", "config": {"max": {"$": "turns"}}}"#).unwrap();
        param::bind_for_test(json!({"holes-a": {"turns": 7}}));
        let a = init(scan_one(&*st, "holes-a", "holes-a".into()).unwrap(), st.clone(), &[], Scripted::new(&[])).unwrap();
        assert_eq!(a.specs()[0].config["max"], 7, "the element sees the bound value");
        save(&*st, "holes-a", &a).unwrap();
        assert!(st.get("holes-a/elements/h.json").unwrap().contains(r#""$": "turns""#), "the recipe keeps its hole");
        let err = init(scan_one(&*st, "holes-b", "holes-b".into()).unwrap(), st.clone(), &[], Scripted::new(&[])).err().unwrap();
        assert!(err.contains("holes-b") && err.contains("'turns' is not bound"), "an unbound hole stops only its engine: {err}");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_bad_element_names_its_engine() {
        let (st, root) = crate::core::store::temp("bad");
        st.put("e/engine.json", &json!({"name": "e"}).to_string()).unwrap();
        st.put("e/elements/x.json", &json!({"kind": "nope"}).to_string()).unwrap();
        let t = scan(&*st, "").unwrap().remove(0);
        let err = init(t, st.clone(), &[], Scripted::new(&[])).err().unwrap();
        assert!(err.contains("e: unknown kind 'nope'"), "{err}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn seed_copies_only_missing_top_level_entries() {
        let (d, r1) = crate::core::store::temp("seed-defaults");
        let (data, r2) = crate::core::store::temp("seed-data");
        d.put("theme.json", "{}").unwrap();
        d.put("engines/a/engine.json", "{}").unwrap();
        data.put("theme.json", "{\"mine\":1}").unwrap();
        seed(&*d, &*data).unwrap();
        assert_eq!(data.get("theme.json").unwrap(), "{\"mine\":1}", "existing entries are kept");
        assert!(data.has("engines/a/engine.json"));
        let _ = (std::fs::remove_dir_all(r1), std::fs::remove_dir_all(r2));
    }

    /// The source is a detail: a folder and one bundle file with the same keys give the same
    /// snapshot, and the manifest — not code — names where engines are.
    #[test]
    fn any_source_in_the_standard_form_loads_the_same_world() {
        let (f, root) = crate::core::store::temp("load");
        f.put("askk.json", r#"{"engines": "agents"}"#).unwrap();
        f.put("agents/a/engine.json", r#"{"name": "a"}"#).unwrap();
        f.put("agents/a/elements/h.json", r#"{"kind": "history"}"#).unwrap();
        f.put("agents/a/b/engine.json", r#"{"name": "b"}"#).unwrap();
        f.put("engines/ignored/engine.json", r#"{"name": "x"}"#).unwrap();
        let bundle = crate::core::store::Bundle::memory(crate::core::store::export(&*f, ""));
        let (a, b) = (load(&*f).unwrap(), load(&bundle).unwrap());
        assert_eq!(a, b, "same snapshot from either source");
        assert_eq!(a.engines.iter().map(|t| t.dir.as_str()).collect::<Vec<_>>(), ["agents/a"]);
        assert_eq!(a.report(), "2 engines, 1 elements");
        let e = init(a.engines[0].clone(), f.clone(), &[], Scripted::new(&[])).unwrap();
        assert_eq!(e.key, "agents/a", "an engine marks the key it was loaded from");
        let _ = std::fs::remove_dir_all(root);
    }
}
