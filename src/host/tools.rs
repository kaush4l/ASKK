//! # Shared tools: the registry any engine selects from (server only)
//!
//! [`shared`] is the whole set; an engine uses one only if an element `selects` it (a `tools`
//! element). Engine lifecycle tools live here too: [`CreateEngine`] copies a template from the
//! store (what an engine is made of is data a person edits, never Rust), [`DismissEngine`]
//! moves an engine aside (kept, not deleted).
use crate::core::store::{self, join, Store};
use crate::core::{boot, tool, Fut, IntoTool, Tool, Toolbox};
use crate::core::world::find;
use crate::host::world::watch_all;
use serde_json::{json, Value};
use std::sync::Arc;

/// Tools any engine may select with a `tools` element.
pub fn shared() -> Vec<Arc<dyn Tool>> {
    let data = store::data();
    let m = crate::core::manifest::manifest();
    let mut all: Vec<Arc<dyn Tool>> = vec![
        tool("now", "current unix time in seconds", Value::Null, |_| {
            Ok(json!(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()))
        }),
        crate::core::node::CreateComponent(data.clone(), m.components.clone()).into_tool(),
        crate::core::node::ListComponents(data.clone(), m.components.clone()).into_tool(),
        crate::core::routes::CreateView(data.clone(), m.routes.clone()).into_tool(),
        crate::core::routes::ListViews(data.clone(), m.routes.clone()).into_tool(),
        crate::host::market::Quote.into_tool(),
        crate::core::code::RunCode.into_tool(),
    ]
    .into_iter()
    .chain(crate::host::workspace::all(crate::host::workspace::workspace(), data, m.engines.clone(), Arc::new(|engine, input| {
        tokio::spawn(async move {
            match find(&engine) {
                Some(e) => {
                    let _ = e.run(&input).await;
                }
                None => eprintln!("askk: alarm for unknown engine '{engine}'"),
            }
        });
    })))
    .collect();
    all.extend(crate::host::data::tools(crate::host::data::root()));
    all.push(CreateEngine.into_tool());
    all.push(DismissEngine.into_tool());
    // `list_tools`: the whole shared set, so an engine can choose tools for a new engine.
    let catalog = Toolbox::new(all.clone()).describe().unwrap_or_default();
    all.push(tool("list_tools", "every shared tool with its arguments and what it does (any engine can select these)", Value::Null, move |_| Ok(json!(catalog))));
    all
}

pub fn valid_name(n: &str) -> bool {
    !n.is_empty() && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// A new engine at `dir`: a copy of `templates/<template>` (seeded from `defaults/`), then its
/// own name, description and goal, and the shared tools it may use (`elements/tools.json`
/// `use`, if the template has one). No element kind is named here: the template decides.
pub fn new_engine(st: &dyn Store, dir: &str, template: &str, name: &str, description: &str, goal: &str, tools: &[String]) -> Result<(), String> {
    let from = join(&crate::core::manifest::manifest().templates, template);
    if !valid_name(template) || !st.has(&join(&from, "engine.json")) {
        return Err(format!("no engine template '{template}' (templates/<name>/engine.json)"));
    }
    store::copy(st, &from, st, dir)?;
    let rw = |key: &str, f: &dyn Fn(&mut Value)| -> Result<(), String> {
        let mut v: Value = serde_json::from_str(&st.get(key).ok_or_else(|| format!("{key}: missing"))?).map_err(|e| format!("{key}: {e}"))?;
        f(&mut v);
        st.put(key, &serde_json::to_string_pretty(&v).unwrap())
    };
    rw(&join(dir, "engine.json"), &|v| {
        v["name"] = name.into();
        v["description"] = description.into();
    })?;
    st.put(&join(dir, "goal.md"), goal)?;
    let t = join(dir, "elements/tools.json");
    if st.has(&t) {
        rw(&t, &|v| v["config"]["use"] = json!(tools))?;
    }
    Ok(())
}

/// Tool: create a sub-engine with a goal; it starts at once and is reachable by `post`.
pub struct CreateEngine;

impl Tool for CreateEngine {
    fn name(&self) -> String {
        "create_engine".into()
    }
    fn description(&self) -> String {
        "create a sub-engine under parent with a goal and the shared tools it may use (see list_tools); message it with post".into()
    }
    fn args(&self) -> Value {
        json!({"parent": "engine path", "name": "short-name", "description": "one line", "goal": "what it is for and when it is done", "tools": ["read_file"], "template": "engine (default; a folder in templates/)"})
    }
    fn invoke(&self, a: Value, _: Toolbox) -> Fut<Result<Value, String>> {
        Box::pin(async move {
            let s = |k: &str| a[k].as_str().unwrap_or_default().trim().to_string();
            let (parent, name) = (s("parent"), s("name"));
            if !valid_name(&name) {
                return Err("name: letters, digits, - and _ only".into());
            }
            let p = find(&parent).ok_or_else(|| format!("no engine '{parent}'"))?;
            let path = format!("{}/{name}", p.path);
            let dir = crate::core::manifest::manifest().engine(&path);
            let st = store::data();
            if st.has(&dir) {
                return Err(format!("engine '{path}' exists"));
            }
            let tools: Vec<String> = a["tools"].as_array().map(|v| v.iter().filter_map(|t| t.as_str().map(String::from)).collect()).unwrap_or_default();
            let shared = shared();
            let known: Vec<String> = shared.iter().map(|t| t.name()).collect();
            if let Some(bad) = tools.iter().find(|t| !known.contains(t)) {
                return Err(format!("no shared tool '{bad}' (see list_tools)"));
            }
            let template = Some(s("template")).filter(|t| !t.is_empty()).unwrap_or_else(|| "engine".into());
            if let Err(e) = new_engine(&*st, &dir, &template, &name, &s("description"), &s("goal"), &tools) {
                let _ = st.remove(&dir);
                return Err(e);
            }
            let e = boot::scan_one(&*st, &dir, path.clone()).and_then(|t| boot::init(t, st.clone(), &shared, Arc::new(crate::host::infer::ModelsInfer)))?;
            p.add_sub(e.clone())?;
            watch_all(e);
            Ok(json!(format!("created {path}; post to it to give it work")))
        })
    }
}

/// Tool: stop and remove a sub-engine; its keys move to `dismissed/` (kept, not deleted).
pub struct DismissEngine;

impl Tool for DismissEngine {
    fn name(&self) -> String {
        "dismiss_engine".into()
    }
    fn description(&self) -> String {
        "stop and remove a sub-engine (its folder is kept under dismissed/)".into()
    }
    fn args(&self) -> Value {
        json!({"path": "engine path, e.g. askk/helper"})
    }
    fn invoke(&self, a: Value, _: Toolbox) -> Fut<Result<Value, String>> {
        Box::pin(async move {
            let path = a["path"].as_str().unwrap_or_default().trim().trim_matches('/').to_string();
            let (parent, _) = path.rsplit_once('/').ok_or("only a sub-engine can be dismissed")?;
            let p = find(parent).ok_or_else(|| format!("no engine '{parent}'"))?;
            p.remove_sub(&path).ok_or_else(|| format!("no sub-engine '{path}'"))?;
            let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
            let m = crate::core::manifest::manifest();
            let to = join(&m.dismissed, &format!("{}-{secs}", path.replace('/', "-")));
            store::data().rename(&m.engine(&path), &to)?;
            Ok(json!(format!("dismissed {path}; kept at {to}")))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_engine_is_a_filled_in_template() {
        let (st, root) = store::temp("template");
        st.put("templates/engine/engine.json", r#"{"name":"engine","max_steps":12}"#).unwrap();
        st.put("templates/engine/elements/tools.json", r#"{"kind":"tools","config":{"use":[]}}"#).unwrap();
        new_engine(&*st, "engines/p/c", "engine", "c", "helps", "be done", &["now".into()]).unwrap();
        let file: Value = serde_json::from_str(&st.get("engines/p/c/engine.json").unwrap()).unwrap();
        assert_eq!((file["name"].as_str(), file["max_steps"].as_u64()), (Some("c"), Some(12)));
        assert_eq!(st.get("engines/p/c/goal.md").unwrap(), "be done");
        assert!(st.get("engines/p/c/elements/tools.json").unwrap().contains("now"));
        assert!(new_engine(&*st, "engines/p/d", "nope", "d", "", "", &[]).is_err(), "unknown template");
        let _ = std::fs::remove_dir_all(root);
    }
}
