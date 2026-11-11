//! # Nodes: the shape every view is made of
//!
//! A view is data, not Rust: a tree of [`Node`]s built only from registered primitives
//! ([`PRIMITIVES`]). Every core object describes its own view as a `Node`; the UI only draws
//! (`ui/render.rs`). A created component ([`Spec`]) is a named tree, kept in the store under the
//! manifest's `components` key.
//!
//! The [`CreateComponent`] tool is the engine-facing door: args `{"name", "root"}` → validated →
//! saved → `"created <name>"`.
use serde::{Deserialize, Serialize};

/// Primitives a spec may use. Each maps to a fixed, styled element in [`Render`].
/// `view` draws a built-in view (`text` = one of [`VIEWS`]); `use` draws a created component
/// (`text` = its name).
pub const PRIMITIVES: &[&str] =
    &["object", "marks", "mark", "pane", "glass", "row", "stack", "grid", "tile", "heading", "text", "muted", "badge", "link", "stat", "button", "view", "use", "summary", "expand", "calls", "call", "figure"];

/// Built-in views a page can place with a `view` node.
pub const VIEWS: &[&str] = &["chat", "canvas", "settings", "dashboard", "engine", "ide", "models", "theme", "layout", "asks", "glance", "sessions", "rooms"];

/// Every node is a known primitive, every `view` a known view; glass never nests inside glass.
pub fn validate_node(n: &Node) -> Result<(), String> {
    fn walk(n: &Node, in_glass: bool) -> Result<(), String> {
        if !PRIMITIVES.contains(&n.kind.as_str()) {
            return Err(format!("unknown primitive '{}'", n.kind));
        }
        if n.kind == "view" && !VIEWS.contains(&n.text.as_str()) {
            return Err(format!("unknown view '{}' (one of {})", n.text, VIEWS.join(", ")));
        }
        if n.kind == "figure" {
            let f: crate::core::figure::Figure = serde_json::from_value(n.data.clone()).map_err(|e| format!("figure: {e}"))?;
            f.validate()?;
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
    /// `object` only: view size (icon | small | medium | large).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub size: String,
    /// `object` only: the object's live activity (idle, thinking, calling, …); drives effects.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub state: String,
    /// `object` / `mark`: an icon name (see `components::ICONS`) or an emoji.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub icon: String,
    /// `object` only: one line beside the icon (phase, activity detail, summary).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub note: String,
    /// `figure` only: the figure itself ([`crate::core::figure::Figure`]). `view`: its argument.
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub data: serde_json::Value,
}

#[cfg_attr(not(feature = "server"), allow(dead_code))]
impl Node {
    pub fn new(kind: &str) -> Self {
        Self { kind: kind.into(), text: String::new(), label: String::new(), children: vec![], size: String::new(), state: String::new(), icon: String::new(), note: String::new(), data: serde_json::Value::Null }
    }
    /// A backend object's view: `label` = name, `text` = its kind.
    pub fn object(kind: &str, name: &str, size: Size, state: &str) -> Self {
        let mut n = Self::new("object").label(name).text(kind);
        n.size = size.as_str().into();
        n.state = state.into();
        // The object sets its own icon (`Component::icon`); engines use `engine`.
        n.icon = if kind == "engine" { "engine".into() } else { "dot".into() };
        n
    }
    pub fn icon(mut self, i: &str) -> Self {
        if !i.is_empty() {
            self.icon = i.into();
        }
        self
    }
    pub fn note(mut self, n: &str) -> Self {
        self.note = n.into();
        self
    }
    /// A row of small icons (tools, artifacts): each `(icon, label)`.
    #[allow(dead_code)]
    pub fn marks(items: impl IntoIterator<Item = (String, String)>) -> Self {
        Self::new("marks").children(items.into_iter().map(|(i, l)| Self::new("mark").label(&l).icon(&i)).collect())
    }
    /// A figure, drawn by the UI from its value.
    pub fn figure(f: &crate::core::figure::Figure) -> Self {
        let mut n = Self::new("figure").label(f.title()).text(f.kind());
        n.data = serde_json::to_value(f).unwrap_or_default();
        n
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

/// The three view templates every object has: **small** = its live icon (a square), **medium**
/// = a card (icon 2×2 with status and phase, a row of tool/artifact icons, a scrolling body),
/// **large** = its full state view.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Size {
    Small,
    #[default]
    Medium,
    Large,
}

impl Size {
    #[cfg_attr(not(feature = "server"), allow(dead_code))]
    pub const ALL: [Size; 3] = [Size::Small, Size::Medium, Size::Large];
    pub fn as_str(self) -> &'static str {
        match self {
            Size::Small => "small",
            Size::Medium => "medium",
            Size::Large => "large",
        }
    }
}

/// The icon for a tool, by what it does (name patterns), so a card can show what an engine holds.
pub fn tool_icon(_name: &str) -> &'static str {
    "wrench"
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

pub fn save_in(store: &dyn Store, key: &str, spec: &Spec) -> Result<(), String> {
    spec.validate()?;
    let text = serde_json::to_string_pretty(spec).map_err(|e| e.to_string())?;
    store.put(&crate::core::store::join(key, &format!("{}.json", spec.name)), &text)
}

pub fn list_in(store: &dyn Store, key: &str) -> Vec<Spec> {
    let mut out: Vec<Spec> = store
        .list(key)
        .into_iter()
        .filter(|e| !e.dir)
        .filter_map(|e| store.get(&crate::core::store::join(key, &e.name)).and_then(|t| serde_json::from_str(&t).ok()))
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

use crate::core::store::Store;
use crate::core::{Fut, Tool, Toolbox};

/// Tool: create a component (validated, saved under its key in the store).
#[cfg_attr(not(feature = "server"), allow(dead_code))]
pub struct CreateComponent(pub std::sync::Arc<dyn Store>, pub String);

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
        let (store, key) = (self.0.clone(), self.1.clone());
        Box::pin(async move {
            let spec: Spec = serde_json::from_value(args).map_err(|e| e.to_string())?;
            save_in(&*store, &key, &spec)?;
            Ok(serde_json::Value::String(format!("created {}", spec.name)))
        })
    }
}

/// Tool: the names of the created components (used by live artifacts).
#[cfg_attr(not(feature = "server"), allow(dead_code))]
pub struct ListComponents(pub std::sync::Arc<dyn Store>, pub String);

impl Tool for ListComponents {
    fn name(&self) -> String {
        "list_components".into()
    }
    fn description(&self) -> String {
        "names of the created UI components".into()
    }
    fn invoke(&self, _: serde_json::Value, _: Toolbox) -> Fut<Result<serde_json::Value, String>> {
        let names: Vec<String> = list_in(&*self.0, &self.1).into_iter().map(|s| s.name).collect();
        Box::pin(async move { Ok(serde_json::json!(names)) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::IntoTool;
    use serde_json::json;

    #[tokio::test]
    async fn create_validates_saves_and_lists() {
        let (st, d) = crate::core::store::temp("compose");
        let tb = Toolbox::new([CreateComponent(st.clone(), "components".into()).into_tool(), ListComponents(st, "components".into()).into_tool()]);
        let err = |v| async { tb.call("create_component", v).await.unwrap_err() };
        assert!(err(json!({"name": "x", "root": {"kind": "marquee"}})).await.contains("unknown primitive"));
        assert!(err(json!({"name": "x", "root": {"kind": "glass", "children": [{"kind": "pane", "children": [{"kind": "glass"}]}]}}))
            .await
            .contains("glass inside glass"));
        assert!(err(json!({"name": "a b", "root": {"kind": "text"}})).await.contains("name must"));
        assert!(err(json!({"name": "f", "root": {"kind": "figure", "data": {"kind": "plot", "title": "t"}}})).await.contains("series"), "a figure keeps its structure inside a component too");
        let ok = tb.call("create_component", json!({"name": "kpi", "root": {"kind": "stat", "label": "Runs", "text": "3"}})).await;
        assert_eq!(ok.unwrap(), json!("created kpi"));
        assert_eq!(tb.call("list_components", json!({})).await.unwrap(), json!(["kpi"]));
        let _ = std::fs::remove_dir_all(d);
    }
}

