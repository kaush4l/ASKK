//! # Boot: folder scan → initialised engines (server only)
//!
//! ```text
//! data/engines/<engine>/engine.json            {name, description, model, max_steps, status}
//! data/engines/<engine>/elements/<name>.json   {kind, name?, config, state}
//! data/engines/<engine>/<sub>/engine.json      a sub-engine (any depth), same layout
//! ```
//! [`scan`] reads the folder into [`Tree`]s (configuration + state, nothing initialised);
//! [`init`] turns a tree into an [`Engine`] whose save hook writes state back to the same files.
//! [`seed`] copies the defaults folder into the data folder for anything missing.
use super::*;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq)]
pub struct Tree {
    pub dir: PathBuf,
    pub path: String,
    pub file: EngineFile,
    pub specs: Vec<Spec>,
    pub subs: Vec<Tree>,
}

fn read_json<T: serde::de::DeserializeOwned>(p: &Path) -> Result<T, String> {
    let s = std::fs::read_to_string(p).map_err(|e| format!("{}: {e}", p.display()))?;
    serde_json::from_str(&s).map_err(|e| format!("{}: {e}", p.display()))
}

fn dirs(p: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(p).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    v.sort();
    v
}

/// One engine folder (and its sub-engine folders).
pub fn scan_one(dir: &Path, path: String) -> Result<Tree, String> {
    let file: EngineFile = read_json(&dir.join("engine.json"))?;
    let mut specs = vec![];
    let mut files: Vec<PathBuf> =
        std::fs::read_dir(dir.join("elements")).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "json")).collect();
    files.sort();
    for f in files {
        let mut s: Spec = read_json(&f)?;
        if s.name.is_empty() {
            s.name = f.file_stem().unwrap().to_string_lossy().into();
        }
        // An element with `config.file` keeps its state as that file's text (goal.md, …).
        if let Some(md) = s.config["file"].as_str() {
            s.state = serde_json::json!({"text": std::fs::read_to_string(dir.join(md)).unwrap_or_default()});
        }
        specs.push(s);
    }
    let mut subs = vec![];
    for d in dirs(dir) {
        if d.join("engine.json").exists() {
            let name = d.file_name().unwrap().to_string_lossy().to_string();
            subs.push(scan_one(&d, format!("{path}/{name}"))?);
        }
    }
    Ok(Tree { dir: dir.into(), path, file, specs, subs })
}

/// Every top-level engine under `root`.
pub fn scan(root: &Path) -> Result<Vec<Tree>, String> {
    dirs(root)
        .into_iter()
        .filter(|d| d.join("engine.json").exists())
        .map(|d| {
            let name = d.file_name().unwrap().to_string_lossy().to_string();
            scan_one(&d, name)
        })
        .collect()
}

/// Write an engine's file and every element's spec back to its folder.
pub fn save(dir: &Path, e: &Engine) -> Result<(), String> {
    let w = |p: PathBuf, v: String| std::fs::write(&p, v).map_err(|err| format!("{}: {err}", p.display()));
    w(dir.join("engine.json"), serde_json::to_string_pretty(&*e.file.lock().unwrap()).unwrap())?;
    std::fs::create_dir_all(dir.join("elements")).map_err(|err| err.to_string())?;
    for mut s in e.specs() {
        if let Some(md) = s.config["file"].as_str() {
            w(dir.join(md), s.state["text"].as_str().unwrap_or_default().into())?;
            s.state = Value::Null;
        }
        w(dir.join("elements").join(format!("{}.json", s.name)), serde_json::to_string_pretty(&s).unwrap())?;
    }
    Ok(())
}

pub fn init(t: Tree, shared: &[Arc<dyn Tool>], infer: Arc<dyn Infer>) -> Result<Arc<Engine>, String> {
    let subs = t.subs.into_iter().map(|s| init(s, shared, infer.clone())).collect::<Result<Vec<_>, _>>()?;
    let mut file = t.file;
    if file.status == "running" {
        file.status = "interrupted".into();
    }
    let mut e = Engine::new(file, t.path.clone(), t.specs, subs, shared.to_vec(), infer).map_err(|err| format!("{}: {err}", t.path))?;
    let dir = t.dir;
    e.save = Some(Arc::new(move |e: &Engine| {
        if let Err(err) = save(&dir, e) {
            eprintln!("save {}: {err}", dir.display());
        }
    }));
    Ok(Arc::new(e))
}

/// Copy each top-level entry of `defaults` into `data` if `data` lacks it.
pub fn seed(defaults: &Path, data: &Path) -> std::io::Result<()> {
    fn copy(from: &Path, to: &Path) -> std::io::Result<()> {
        if from.is_dir() {
            std::fs::create_dir_all(to)?;
            for e in std::fs::read_dir(from)?.flatten() {
                copy(&e.path(), &to.join(e.file_name()))?;
            }
            Ok(())
        } else {
            std::fs::copy(from, to).map(|_| ())
        }
    }
    std::fs::create_dir_all(data)?;
    for e in std::fs::read_dir(defaults)?.flatten() {
        let to = data.join(e.file_name());
        if !to.exists() {
            copy(&e.path(), &to)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::engine::tests::Scripted;
    use serde_json::json;

    fn write(p: &Path, v: Value) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, v.to_string()).unwrap();
    }

    #[tokio::test]
    async fn folder_scan_initialises_engines_and_state_survives_restart() {
        let root = std::env::temp_dir().join(format!("askk-boot-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        write(&root.join("top/engine.json"), json!({"name": "top"}));
        write(&root.join("top/elements/history.json"), json!({"kind": "history"}));
        write(&root.join("top/sub/engine.json"), json!({"name": "sub", "description": "helps"}));
        write(&root.join("bare/engine.json"), json!({"name": "bare"}));
        write(&root.join("top/elements/learning.json"), json!({"kind": "notes", "config": {"file": "learning.md", "mode": "sections"}}));
        std::fs::write(root.join("top/learning.md"), "## tools\n- add works\n").unwrap();
        std::fs::create_dir_all(root.join("not-an-engine")).unwrap();

        let trees = scan(&root).unwrap();
        assert_eq!(trees.iter().map(|t| t.path.as_str()).collect::<Vec<_>>(), ["bare", "top"]);
        assert_eq!(trees[1].subs[0].path, "top/sub");
        assert_eq!(trees[1].specs[0].name, "history", "name defaults to the file stem");
        assert_eq!(trees[1].specs[1].state["text"], "## tools\n- add works\n", "state read from learning.md");

        let top = init(trees[1].clone(), &[], Scripted::new(&["hello"])).unwrap();
        assert!(top.find("top/sub").is_some());
        assert!(top.toolbox().names().contains(&"sub".to_string()), "sub-engine is a tool");
        top.run("hi").await.unwrap();

        let again = scan(&root).unwrap();
        let turns = &again[1].specs[0].state["turns"];
        assert_eq!(turns.as_array().unwrap().len(), 2, "history persisted: {turns}");
        assert_eq!(again[1].file.status, "idle");
        assert_eq!(std::fs::read_to_string(root.join("top/learning.md")).unwrap(), "## tools\n- add works\n", "md written back");
        assert!(std::fs::read_to_string(root.join("top/elements/learning.json")).unwrap().contains("\"state\": null"), "state lives in the .md only");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_bad_element_names_its_engine() {
        let root = std::env::temp_dir().join(format!("askk-bad-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        write(&root.join("e/engine.json"), json!({"name": "e"}));
        write(&root.join("e/elements/x.json"), json!({"kind": "nope"}));
        let t = scan(&root).unwrap().remove(0);
        let err = init(t, &[], Scripted::new(&[])).err().unwrap();
        assert!(err.contains("e: unknown kind 'nope'"), "{err}");
        let _ = std::fs::remove_dir_all(&root);
    }
}
