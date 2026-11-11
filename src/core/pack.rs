//! # pack
//! An engine's recipe as files anyone can be handed, with nothing of the user in it.
//!
//! [`export`] walks one engine (and its sub-engines) in a store and returns the files of a pack:
//! `engine.json` (without its status), every `elements/*.json` (config only), and the text of
//! each notes element that marks itself `share: true` (a goal, a skill). It never takes
//! `memory/`, `runs/`, or any other notes text: those are what happened, and whose.
//!
//! It refuses, naming the file and the reason, when:
//! - a `personal` or `secret` key holds a value instead of a hole (`{"$": "name"}`);
//! - a shared text looks personal: a home path, an email address, a long run of digits.
//!   Text cannot be checked by its structure, so it is refused, never quietly cleaned.
//!
//! [`Pack::needs`] lists every hole, so whoever imports the pack sees at once what to bind.
use super::param::{has_holes, Param, Share};
use super::store::{join, Store};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Default, PartialEq)]
pub struct Pack {
    /// `(key relative to the engine, text)`, in walk order.
    pub files: Vec<(String, String)>,
    /// Every hole, by name, with whose value it is.
    pub needs: BTreeMap<String, &'static str>,
}

/// The pack of the engine at `dir` in `store`.
pub fn export(store: &dyn Store, dir: &str) -> Result<Pack, String> {
    let mut p = Pack::default();
    walk(store, dir, "", &mut p)?;
    Ok(p)
}

fn walk(store: &dyn Store, dir: &str, rel: &str, p: &mut Pack) -> Result<(), String> {
    let at = |k: &str| if rel.is_empty() { k.to_string() } else { format!("{rel}/{k}") };
    let text = store.get(&join(dir, "engine.json")).ok_or_else(|| format!("{dir}: no engine.json"))?;
    let mut file: Value = serde_json::from_str(&text).map_err(|e| format!("{dir}/engine.json: {e}"))?;
    if let Some(m) = file.as_object_mut() {
        m.remove("status");
    }
    p.files.push((at("engine.json"), serde_json::to_string_pretty(&file).unwrap()));
    for f in store.list(&join(dir, "elements")).into_iter().filter(|f| !f.dir && f.name.ends_with(".json")) {
        let key = at(&format!("elements/{}", f.name));
        let text = store.get(&join(dir, &format!("elements/{}", f.name))).unwrap_or_default();
        let mut spec: super::Spec = serde_json::from_str(&text).map_err(|e| format!("{key}: {e}"))?;
        let kind = spec.kind.clone();
        let k = super::kind(&kind).ok_or_else(|| format!("{key}: unknown kind '{kind}'"))?;
        let config = spec.config.clone();
        for param in k.params.iter().filter(|q| q.share != Share::Craft) {
            if let Some(v) = config.get(param.key) {
                if !has_holes(v) {
                    return Err(format!("{key}: '{}' is {}: write a hole {{\"$\": \"{}\"}} and bind the value", param.key, param.share.as_str(), param.key));
                }
            }
        }
        holes(&config, k.params, None, &mut p.needs);
        spec.state = Value::Null;
        p.files.push((key, serde_json::to_string_pretty(&spec).unwrap()));
        if let (Some(md), true) = (config["file"].as_str(), config["share"].as_bool().unwrap_or(false)) {
            let text = store.get(&join(dir, md)).unwrap_or_default();
            looks_personal(&text).map_err(|why| format!("{}: {why}", at(md)))?;
            p.files.push((at(md), text));
        }
    }
    for d in store.list(dir).into_iter().filter(|d| d.dir) {
        let sub = join(dir, &d.name);
        if store.has(&join(&sub, "engine.json")) {
            walk(store, &sub, &at(&d.name), p)?;
        }
    }
    Ok(())
}

/// Place a pack's files as a new engine at `dir`. Refused when something is already there, when a
/// key climbs out of the engine, when an element is of a kind this build does not have or takes a
/// key its kind does not declare, and when a file carries state. Nothing is written unless all
/// of it is accepted. Returns the holes to bind.
pub fn import(store: &dyn Store, dir: &str, files: &[(String, String)]) -> Result<BTreeMap<String, &'static str>, String> {
    if store.has(dir) {
        return Err(format!("{dir} already exists"));
    }
    if !files.iter().any(|(k, _)| k == "engine.json") {
        return Err("a pack has an engine.json at its top".into());
    }
    let mut needs = BTreeMap::new();
    for (key, text) in files {
        if key.split('/').any(|s| s.is_empty() || s == ".." || s == ".") || key.starts_with('/') {
            return Err(format!("{key}: not a key inside the engine"));
        }
        let parts: Vec<&str> = key.split('/').collect();
        if parts.iter().any(|p| *p == super::boot::STATE || *p == super::boot::RUNS) {
            return Err(format!("{key}: a pack carries no memory or runs"));
        }
        if parts.len() >= 2 && parts[parts.len() - 2] == "elements" {
            let spec: super::Spec = serde_json::from_str(text).map_err(|e| format!("{key}: {e}"))?;
            if !spec.state.is_null() {
                return Err(format!("{key}: a pack carries no state"));
            }
            let k = super::kind(&spec.kind).ok_or_else(|| format!("{key}: this build has no kind '{}'", spec.kind))?;
            super::param::check(&spec.config, k.params).map_err(|e| format!("{key}: {e}"))?;
            holes(&spec.config, k.params, None, &mut needs);
        }
    }
    for (key, text) in files {
        store.put(&join(dir, key), text)?;
    }
    Ok(needs)
}

/// Record every hole in `v`. A hole under a secret key is secret; any other hole is personal.
fn holes(v: &Value, params: &[Param], share: Option<Share>, out: &mut BTreeMap<String, &'static str>) {
    match v {
        Value::Object(m) if m.len() == 1 && m.get("$").is_some_and(Value::is_string) => {
            let s = if share == Some(Share::Secret) { Share::Secret } else { Share::Personal };
            out.insert(m["$"].as_str().unwrap().to_string(), s.as_str());
        }
        Value::Object(m) => {
            for (k, x) in m {
                let s = share.or_else(|| params.iter().find(|p| p.key == k).map(|p| p.share));
                holes(x, params, s, out);
            }
        }
        Value::Array(a) => a.iter().for_each(|x| holes(x, params, share, out)),
        _ => {}
    }
}

/// Text that names a person or their machine: a home path, an email address, eight or more
/// digits in a row (an account, a phone number).
pub fn looks_personal(text: &str) -> Result<(), String> {
    for (n, line) in text.lines().enumerate() {
        let email = line.split(|c: char| c.is_whitespace() || "<>()[],;\"'`".contains(c)).any(|w| {
            let w = w.trim_end_matches('.');
            w.split_once('@').is_some_and(|(a, b)| !a.is_empty() && b.contains('.') && !b.starts_with('.'))
        });
        let why = if line.contains("/Users/") || line.contains("/home/") || line.contains("/Volumes/") {
            Some("a home path")
        } else if email {
            Some("an email address")
        } else if line.split(|c: char| !c.is_ascii_digit()).any(|d| d.len() >= 8) {
            Some("a long number")
        } else {
            None
        };
        if let Some(why) = why {
            return Err(format!("line {} holds {why}; move it to the user's notes or bindings", n + 1));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn world(tag: &str) -> (std::sync::Arc<dyn Store>, std::path::PathBuf) {
        let (st, root) = crate::core::store::temp(tag);
        st.put("d/engine.json", r#"{"name": "d", "status": "running"}"#).unwrap();
        st.put("d/goal.md", "Trade one name a day; stop at the cap.").unwrap();
        st.put("d/notes.md", "user prefers AAA").unwrap();
        st.put("d/elements/goal.json", r#"{"kind": "notes", "config": {"file": "goal.md", "share": true}}"#).unwrap();
        st.put("d/elements/notes.json", r#"{"kind": "notes", "config": {"file": "notes.md"}}"#).unwrap();
        st.put("d/elements/w.json", r#"{"kind": "workspace", "config": {"root": {"$": "home"}}}"#).unwrap();
        st.put("d/elements/h.json", r#"{"kind": "history", "config": {"max": 3}, "state": {"turns": [1]}}"#).unwrap();
        st.put("d/memory/h.json", r#"{"turns": [1]}"#).unwrap();
        st.put("d/runs/1.json", "{}").unwrap();
        st.put("d/sub/engine.json", r#"{"name": "sub"}"#).unwrap();
        (st, root)
    }

    #[test]
    fn an_export_holds_the_recipe_and_nothing_that_happened() {
        let (st, root) = world("pack-a");
        let p = export(&*st, "d").unwrap();
        let keys: Vec<&str> = p.files.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(keys, ["engine.json", "elements/goal.json", "goal.md", "elements/h.json", "elements/notes.json", "elements/w.json", "sub/engine.json"]);
        let all: String = p.files.iter().map(|(_, t)| t.as_str()).collect();
        assert!(!all.contains("running") && !all.contains("turns") && !all.contains("prefers AAA"), "no status, state or personal notes: {all}");
        assert_eq!(p.needs.get("home"), Some(&"personal"), "the hole is listed with whose it is");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_personal_literal_or_personal_text_is_refused_with_its_place() {
        let (st, root) = world("pack-b");
        st.put("d/elements/w.json", r#"{"kind": "workspace", "config": {"root": "/Users/someone/desk"}}"#).unwrap();
        let e = export(&*st, "d").unwrap_err();
        assert!(e.contains("elements/w.json") && e.contains("'root' is personal"), "{e}");
        st.put("d/elements/w.json", r#"{"kind": "workspace", "config": {"root": {"$": "home"}}}"#).unwrap();
        st.put("d/goal.md", "Report to someone@example.com each day.").unwrap();
        let e = export(&*st, "d").unwrap_err();
        assert!(e.contains("goal.md") && e.contains("email"), "{e}");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_pack_round_trips_and_a_bad_one_writes_nothing() {
        let (st, root) = world("pack-c");
        let p = export(&*st, "d").unwrap();
        let needs = import(&*st, "e", &p.files).unwrap();
        assert_eq!(needs.get("home"), Some(&"personal"));
        assert_eq!(export(&*st, "e").unwrap().files, p.files, "what comes in goes out the same");
        assert!(import(&*st, "e", &p.files).unwrap_err().contains("already exists"));
        let bad = vec![("engine.json".to_string(), "{}".to_string()), ("elements/x.json".to_string(), r#"{"kind": "nope"}"#.to_string())];
        assert!(import(&*st, "f", &bad).unwrap_err().contains("no kind 'nope'"));
        assert!(!st.has("f"), "nothing written");
        let climb = vec![("engine.json".to_string(), "{}".to_string()), ("../x".to_string(), "".to_string())];
        assert!(import(&*st, "g", &climb).is_err() && !st.has("g"));
        let _ = std::fs::remove_dir_all(root);
    }

    /// Every engine shipped in `defaults/` can be handed on as it is.
    #[test]
    fn every_shipped_engine_exports() {
        let st = crate::host::store::Folder::new(concat!(env!("CARGO_MANIFEST_DIR"), "/defaults"));
        let mut n = 0;
        for d in st.list("engines").into_iter().filter(|d| d.dir) {
            export(&*st, &join("engines", &d.name)).unwrap_or_else(|e| panic!("{}: {e}", d.name));
            n += 1;
        }
        assert!(n > 0);
    }

    #[test]
    fn personal_text_is_found_and_craft_text_passes() {
        assert!(looks_personal("Account 41139081 only").is_err());
        assert!(looks_personal("see /Volumes/Backup/x").is_err());
        assert!(looks_personal("Use `quote {symbol}`; cap risk at 2% of 10000.").is_ok());
        assert!(looks_personal("an @mention is not an email").is_ok());
    }
}
