//! # Routes: folder-based, like the Next.js app router
//!
//! Every page is a folder in `data/routes/` holding a `page.json`; its URL is its folder path.
//! `routes/page.json` is `/`, `routes/models/page.json` is `/models`. A `[name]` folder captures
//! one segment, `[...name]` the rest (`routes/e/[...path]` = `/e/askk/market`, `path = askk/market`).
//! Static folders win over `[name]`, which wins over `[...name]`.
//!
//! A [`Page`] is a title, an optional sidebar position (`nav`) and a node tree (`root`) drawn by
//! the composed primitives, plus two that reach further: `view` (a built-in view by name, see
//! [`crate::core::node::VIEWS`]) and `use` (a created component by name). Nothing is hardcoded: the
//! sidebar is the pages that set `nav`, ordered by it.
//!
//! Engines write pages with the [`CreateView`] tool and list them with [`ListViews`].
use crate::core::node::Node;
use crate::core::{Fut, Tool, Toolbox};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Page {
    #[serde(default)]
    pub title: String,
    /// Position in the sidebar; absent = not listed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nav: Option<i32>,
    /// Nav icon name (see `components::ICONS`).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub icon: String,
    pub root: Node,
}

/// A URL matched to its page, with the captured `[params]`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Resolved {
    pub pattern: String,
    pub page: Page,
    pub params: BTreeMap<String, String>,
}

/// Captured `[params]` of the page being drawn, for views that need them (`engine` reads `path`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Params(pub BTreeMap<String, String>);

fn dynamic(seg: &str) -> Option<&str> {
    seg.strip_prefix('[').and_then(|s| s.strip_suffix(']')).filter(|s| !s.starts_with("..."))
}

fn catch_all(seg: &str) -> Option<&str> {
    seg.strip_prefix("[...").and_then(|s| s.strip_suffix(']'))
}

/// Params when `path` fits `pattern` (folder segments), else none. A catch-all needs one segment.
pub fn matches(pattern: &[String], path: &[String]) -> Option<BTreeMap<String, String>> {
    let mut params = BTreeMap::new();
    for (i, seg) in pattern.iter().enumerate() {
        if let Some(name) = catch_all(seg) {
            if i >= path.len() {
                return None;
            }
            params.insert(name.to_string(), path[i..].join("/"));
            return Some(params);
        }
        let p = path.get(i)?;
        match dynamic(seg) {
            Some(name) => {
                params.insert(name.to_string(), p.clone());
            }
            None if seg != p => return None,
            None => {}
        }
    }
    (pattern.len() == path.len()).then_some(params)
}

/// Specificity, compared segment by segment: static < `[name]` < `[...name]`.
fn rank(pattern: &[String]) -> Vec<u8> {
    pattern.iter().map(|s| if catch_all(s).is_some() { 2 } else if dynamic(s).is_some() { 1 } else { 0 }).collect()
}

/// First page (by specificity) whose pattern fits `path`.
pub fn resolve(pages: &[(Vec<String>, Page)], path: &[String]) -> Option<Resolved> {
    let mut order: Vec<&(Vec<String>, Page)> = pages.iter().collect();
    order.sort_by(|a, b| rank(&a.0).cmp(&rank(&b.0)));
    order.into_iter().find_map(|(pat, page)| {
        matches(pat, path).map(|params| Resolved { pattern: format!("/{}", pat.join("/")), page: page.clone(), params })
    })
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct NavLink {
    pub label: String,
    pub to: String,
    #[serde(default)]
    pub icon: String,
}

/// Sidebar links: pages with `nav` and no params, ordered by it.
pub fn nav(pages: &[(Vec<String>, Page)]) -> Vec<NavLink> {
    let mut v: Vec<(i32, NavLink)> = pages
        .iter()
        .filter(|(pat, _)| pat.iter().all(|s| !s.starts_with('[')))
        .filter_map(|(pat, p)| p.nav.map(|n| (n, NavLink { label: p.title.clone(), to: format!("/{}", pat.join("/")), icon: p.icon.clone() })))
        .collect();
    v.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.to.cmp(&b.1.to)));
    v.into_iter().map(|(_, l)| l).collect()
}

/// Folder segments of a page path: `"reports/[day]"` → `["reports","[day]"]`; `""` or `"/"` = root.
pub fn segments(path: &str) -> Result<Vec<String>, String> {
    let segs: Vec<String> = path.split('/').filter(|s| !s.is_empty()).map(String::from).collect();
    for s in &segs {
        let name = catch_all(s).or(dynamic(s)).unwrap_or(s);
        if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return Err(format!("bad segment '{s}': letters, digits, - or _, optionally as [name] or [...name]"));
        }
    }
    Ok(segs)
}

/// Every `page.json` under `key`, with its folder segments.
pub fn scan(store: &dyn Store, key: &str) -> Vec<(Vec<String>, Page)> {
    use crate::core::store::join;
    fn walk(st: &dyn Store, k: &str, segs: &mut Vec<String>, out: &mut Vec<(Vec<String>, Page)>) {
        if let Some(p) = st.get(&join(k, "page.json")).and_then(|t| serde_json::from_str(&t).ok()) {
            out.push((segs.clone(), p));
        }
        for e in st.list(k).into_iter().filter(|e| e.dir) {
            segs.push(e.name.clone());
            walk(st, &join(k, &e.name), segs, out);
            segs.pop();
        }
    }
    let mut out = vec![];
    walk(store, key, &mut vec![], &mut out);
    out
}

/// Validate and write `<key>/<path>/page.json`.
pub fn save(store: &dyn Store, key: &str, path: &str, page: &Page) -> Result<String, String> {
    let segs = segments(path)?;
    crate::core::node::validate_node(&page.root)?;
    let at = segs.iter().fold(key.to_string(), |k, s| crate::core::store::join(&k, s));
    store.put(&crate::core::store::join(&at, "page.json"), &serde_json::to_string_pretty(page).unwrap())?;
    Ok(format!("/{}", segs.join("/")))
}

use crate::core::store::Store;

/// Tool: create or replace a page (a view) at a route path.
#[cfg_attr(not(feature = "server"), allow(dead_code))]
pub struct CreateView(pub std::sync::Arc<dyn Store>, pub String);

impl Tool for CreateView {
    fn name(&self) -> String {
        "create_view".into()
    }
    fn description(&self) -> String {
        format!(
            "create or replace a page at a route path (folders; [name] captures a segment). root is a node tree of primitives; also 'view' (text = one of {}) and 'use' (text = a created component's name). nav = sidebar position, omit to hide",
            crate::core::node::VIEWS.join(", ")
        )
    }
    fn args(&self) -> serde_json::Value {
        serde_json::json!({"path": "e.g. reports/daily", "title": "text", "nav": "number?", "root": {"kind": "primitive", "text": "?", "label": "?", "children": "[node]?"}})
    }
    fn invoke(&self, args: serde_json::Value, _: Toolbox) -> Fut<Result<serde_json::Value, String>> {
        let (store, key) = (self.0.clone(), self.1.clone());
        Box::pin(async move {
            let path = args["path"].as_str().unwrap_or_default().to_string();
            let page: Page = serde_json::from_value(args).map_err(|e| e.to_string())?;
            let at = save(&*store, &key, &path, &page)?;
            Ok(serde_json::Value::String(format!("created view {at}")))
        })
    }
}

/// Tool: every route with its title.
#[cfg_attr(not(feature = "server"), allow(dead_code))]
pub struct ListViews(pub std::sync::Arc<dyn Store>, pub String);

impl Tool for ListViews {
    fn name(&self) -> String {
        "list_views".into()
    }
    fn description(&self) -> String {
        "the pages (route path and title)".into()
    }
    fn invoke(&self, _: serde_json::Value, _: Toolbox) -> Fut<Result<serde_json::Value, String>> {
        let v: Vec<serde_json::Value> = scan(&*self.0, &self.1).into_iter().map(|(p, page)| serde_json::json!({"path": format!("/{}", p.join("/")), "title": page.title})).collect();
        Box::pin(async move { Ok(serde_json::json!(v)) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segs(s: &str) -> Vec<String> {
        segments(s).unwrap()
    }

    fn page(title: &str, nav: Option<i32>) -> Page {
        Page { title: title.into(), nav, icon: String::new(), root: Node::new("text").text(title) }
    }

    #[test]
    fn folders_resolve_static_before_dynamic_before_catch_all() {
        let pages = vec![
            (segs("[...rest]"), page("any", None)),
            (segs(""), page("home", Some(0))),
            (segs("e/[...path]"), page("engine", None)),
            (segs("e/[id]"), page("one", None)),
            (segs("e/new"), page("new", Some(2))),
            (segs("models"), page("models", Some(1))),
        ];
        let at = |p: &str| resolve(&pages, &segs(p)).map(|r| (r.page.title, r.params.into_iter().collect::<Vec<_>>()));
        assert_eq!(at("/").unwrap().0, "home");
        assert_eq!(at("models").unwrap().0, "models");
        assert_eq!(at("e/new").unwrap().0, "new");
        assert_eq!(at("e/askk").unwrap(), ("one".into(), vec![("id".into(), "askk".into())]));
        assert_eq!(at("e/askk/market").unwrap(), ("engine".into(), vec![("path".into(), "askk/market".into())]));
        assert_eq!(at("nope/deep").unwrap().0, "any");
        assert!(resolve(&pages[1..2], &segs("x")).is_none());
        let links: Vec<String> = nav(&pages).into_iter().map(|l| l.to).collect();
        assert_eq!(links, ["/", "/models", "/e/new"]);
    }

    #[test]
    fn bad_segments_are_refused() {
        assert!(segments("a b").is_err());
        assert!(segments("../etc").is_err());
        assert!(segments("[]").is_err());
        assert_eq!(segs("/reports/[day]/"), ["reports", "[day]"]);
    }

    #[tokio::test]
    async fn create_view_writes_a_folder_that_routes_to_it() {
        use crate::core::IntoTool;
        use serde_json::json;
        let (st, d) = crate::core::store::temp("routes");
        let tb = Toolbox::new([CreateView(st.clone(), "routes".into()).into_tool(), ListViews(st.clone(), "routes".into()).into_tool()]);
        let made = tb.call("create_view", json!({"path": "reports/[day]", "title": "Daily", "nav": 3, "root": {"kind": "pane", "children": [{"kind": "view", "text": "dashboard"}]}})).await;
        assert_eq!(made.unwrap(), json!("created view /reports/[day]"));
        assert!(tb.call("create_view", json!({"path": "x", "title": "x", "root": {"kind": "view", "text": "nope"}})).await.unwrap_err().contains("unknown view"));
        assert!(tb.call("create_view", json!({"path": "../x", "title": "x", "root": {"kind": "text"}})).await.is_err());
        let r = resolve(&scan(&*st, "routes"), &segs("reports/monday")).unwrap();
        assert_eq!((r.page.title.as_str(), r.params["day"].as_str()), ("Daily", "monday"));
        assert_eq!(tb.call("list_views", json!({})).await.unwrap(), json!([{"path": "/reports/[day]", "title": "Daily"}]));
        let _ = std::fs::remove_dir_all(d);
    }
}
