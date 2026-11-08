//! # Composed components
//!
//! Engines create components at runtime as **data**, not Rust: a [`Spec`] is a named tree of
//! [`Node`]s built only from registered primitives ([`PRIMITIVES`]). The [`Render`] component draws
//! any spec, so a new component needs no rebuild. Specs live in `data/components/<name>.json`.
//!
//! The [`CreateComponent`] tool is the engine-facing door: args `{"name", "root"}` → validated →
//! saved → `"created <name>"`.
use dioxus::prelude::*;
use serde::{Deserialize, Serialize};

/// Primitives a spec may use. Each maps to a fixed, styled element in [`Render`].
/// `view` draws a built-in view (`text` = one of [`VIEWS`]); `use` draws a created component
/// (`text` = its name).
pub const PRIMITIVES: &[&str] =
    &["pane", "glass", "row", "stack", "grid", "tile", "heading", "text", "muted", "badge", "link", "stat", "button", "view", "use"];

/// Built-in views a page can place with a `view` node.
pub const VIEWS: &[&str] = &["chat", "dashboard", "engine", "models", "components", "theme", "layout"];

/// Every node is a known primitive, every `view` a known view; glass never nests inside glass.
pub fn validate_node(n: &Node) -> Result<(), String> {
    fn walk(n: &Node, in_glass: bool) -> Result<(), String> {
        if !PRIMITIVES.contains(&n.kind.as_str()) {
            return Err(format!("unknown primitive '{}'", n.kind));
        }
        if n.kind == "view" && !VIEWS.contains(&n.text.as_str()) {
            return Err(format!("unknown view '{}' (one of {})", n.text, VIEWS.join(", ")));
        }
        if n.kind == "glass" && in_glass {
            return Err("glass inside glass is not allowed".into());
        }
        n.children.iter().try_for_each(|c| walk(c, in_glass || n.kind == "glass"))
    }
    walk(n, false)
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub kind: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub text: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub label: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<Node>,
}

#[cfg_attr(not(feature = "server"), allow(dead_code))]
impl Node {
    pub fn new(kind: &str) -> Self {
        Self { kind: kind.into(), text: String::new(), label: String::new(), children: vec![] }
    }
    pub fn text(mut self, t: &str) -> Self {
        self.text = t.into();
        self
    }
    pub fn label(mut self, l: &str) -> Self {
        self.label = l.into();
        self
    }
    pub fn child(mut self, c: Node) -> Self {
        self.children.push(c);
        self
    }
    pub fn children(mut self, c: Vec<Node>) -> Self {
        self.children.extend(c);
        self
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Spec {
    pub name: String,
    pub root: Node,
}

#[cfg_attr(not(feature = "server"), allow(dead_code))]
impl Spec {
    /// Name is a slug and the tree is valid ([`validate_node`]).
    pub fn validate(&self) -> Result<(), String> {
        if self.name.is_empty() || !self.name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return Err("name must be letters, digits or '-'".into());
        }
        validate_node(&self.root)
    }
}

#[cfg(feature = "server")]
pub fn dir() -> std::path::PathBuf {
    crate::api::data_dir().join("components")
}

#[cfg(feature = "server")]
pub fn save_in(dir: &std::path::Path, spec: &Spec) -> Result<(), String> {
    spec.validate()?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(spec).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{}.json", spec.name)), text).map_err(|e| e.to_string())
}

#[cfg(feature = "server")]
pub fn list_in(dir: &std::path::Path) -> Vec<Spec> {
    let mut out: Vec<Spec> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| std::fs::read_to_string(e.path()).ok().and_then(|t| serde_json::from_str(&t).ok()))
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[server]
pub async fn list_components() -> Result<Vec<Spec>, ServerFnError> {
    Ok(list_in(&dir()))
}

/// Runs the create_component tool with JSON args, exactly as an engine would.
#[server]
pub async fn create_component(args: String) -> Result<String, ServerFnError> {
    let v: serde_json::Value = serde_json::from_str(&args).map_err(|e| ServerFnError::new(format!("bad args: {e}")))?;
    let tb = crate::core::Toolbox::new([CreateComponent(dir()).into_tool()]);
    tb.call("create_component", v).await.map(|v| crate::core::text(&v)).map_err(ServerFnError::new)
}

#[cfg(feature = "server")]
use crate::core::IntoTool;
use crate::core::{Fut, Tool, Toolbox};

/// Tool: create a component (validated, saved in its folder).
#[cfg_attr(not(feature = "server"), allow(dead_code))]
pub struct CreateComponent(pub std::path::PathBuf);

impl Tool for CreateComponent {
    fn name(&self) -> String {
        "create_component".into()
    }
    fn description(&self) -> String {
        format!("create a UI component from primitives: {}", PRIMITIVES.join(", "))
    }
    fn args(&self) -> serde_json::Value {
        serde_json::json!({"name": "slug", "root": {"kind": "primitive", "text": "?", "label": "?", "children": "[node]?"}})
    }
    fn invoke(&self, args: serde_json::Value, _: Toolbox) -> Fut<Result<serde_json::Value, String>> {
        let dir = self.0.clone();
        Box::pin(async move {
            let spec: Spec = serde_json::from_value(args).map_err(|e| e.to_string())?;
            #[cfg(feature = "server")]
            save_in(&dir, &spec)?;
            #[cfg(not(feature = "server"))]
            {
                let _ = dir;
                spec.validate()?;
            }
            Ok(serde_json::Value::String(format!("created {}", spec.name)))
        })
    }
}

/// Tool: the names of the created components (used by live artifacts).
#[cfg_attr(not(feature = "server"), allow(dead_code))]
pub struct ListComponents(pub std::path::PathBuf);

impl Tool for ListComponents {
    fn name(&self) -> String {
        "list_components".into()
    }
    fn description(&self) -> String {
        "names of the created UI components".into()
    }
    fn invoke(&self, _: serde_json::Value, _: Toolbox) -> Fut<Result<serde_json::Value, String>> {
        #[cfg(feature = "server")]
        let names: Vec<String> = list_in(&self.0).into_iter().map(|s| s.name).collect();
        #[cfg(not(feature = "server"))]
        let names: Vec<String> = vec![];
        Box::pin(async move { Ok(serde_json::json!(names)) })
    }
}

/// Draws any node tree with the fixed primitives.
#[component]
pub fn Render(node: Node) -> Element {
    let kids = rsx! { for c in node.children.clone() { Render { node: c } } };
    match node.kind.as_str() {
        "pane" => rsx! { crate::components::Pane { class: "stack", {kids} } },
        "glass" => rsx! { crate::components::Glass { class: "stack pad", {kids} } },
        "row" => rsx! { div { class: "row", {kids} } },
        "stack" => rsx! { div { class: "stack", {kids} } },
        "grid" => rsx! { div { class: "grid", {kids} } },
        "tile" => rsx! { div { class: "tile", div { class: "tile-head", span { "{node.label}" } span { class: "dim", "{node.text}" } } {kids} } },
        "heading" => rsx! { h3 { "{node.text}" } },
        "muted" => rsx! { p { class: "dim", "{node.text}" } },
        "badge" => rsx! { span { class: "badge", "{node.text}" } },
        "link" => rsx! { Link { to: node.text.clone(), class: "link", "{node.label}" } },
        "text" => rsx! { p { "{node.text}" } },
        "stat" => rsx! { crate::components::Stat { label: node.label.clone(), value: node.text.clone() } },
        "button" => rsx! { button { class: "btn", "{node.label}" } },
        "view" => rsx! { crate::views::Builtin { name: node.text.clone() } },
        "use" => rsx! { Use { name: node.text.clone() } },
        other => rsx! { p { class: "dim", "unknown primitive {other}" } },
    }
}

/// A created component, by name.
#[component]
pub fn Use(name: String) -> Element {
    let all = use_resource(list_components);
    let found = all.read().as_ref().and_then(|r| r.as_ref().ok()).and_then(|v| v.iter().find(|s| s.name == name).cloned());
    match found {
        Some(s) => rsx! { Render { node: s.root } },
        None => rsx! {},
    }
}

#[cfg(all(test, feature = "server"))]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("askk-{tag}-{}", std::process::id()))
    }

    #[tokio::test]
    async fn create_validates_saves_and_lists() {
        let d = tmp("compose");
        let tb = Toolbox::new([CreateComponent(d.clone()).into_tool(), ListComponents(d.clone()).into_tool()]);
        let err = |v| async { tb.call("create_component", v).await.unwrap_err() };
        assert!(err(json!({"name": "x", "root": {"kind": "marquee"}})).await.contains("unknown primitive"));
        assert!(err(json!({"name": "x", "root": {"kind": "glass", "children": [{"kind": "pane", "children": [{"kind": "glass"}]}]}}))
            .await
            .contains("glass inside glass"));
        assert!(err(json!({"name": "a b", "root": {"kind": "text"}})).await.contains("name must"));
        let ok = tb.call("create_component", json!({"name": "kpi", "root": {"kind": "stat", "label": "Runs", "text": "3"}})).await;
        assert_eq!(ok.unwrap(), json!("created kpi"));
        assert_eq!(tb.call("list_components", json!({})).await.unwrap(), json!(["kpi"]));
        let _ = std::fs::remove_dir_all(d);
    }
}
