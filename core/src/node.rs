//! View trees: the §5 primitives only, built by objects, drawn by the frontend.

use serde::Serialize;
use serde_json::{Map, Value, json};

use crate::object::Phase;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Node {
    pub c: &'static str,
    #[serde(skip_serializing_if = "Map::is_empty")]
    pub props: Map<String, Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<Node>,
}

/// Every primitive the frontend knows (contract §5).
pub const PRIMITIVES: [&str; 14] =
    ["Stack", "Grid", "Card", "Text", "Badge", "Meter", "Button", "Field", "Table", "Code", "Divider", "Slot", "Avatar", "Widgets"];

impl Node {
    pub fn new(c: &'static str) -> Self {
        Self { c, props: Map::new(), children: vec![] }
    }
    pub fn p(mut self, key: &str, value: impl Into<Value>) -> Self {
        self.props.insert(key.into(), value.into());
        self
    }
    pub fn kids(mut self, children: Vec<Node>) -> Self {
        self.children = children;
        self
    }
    /// Every node in this tree, depth first.
    pub fn walk(&self) -> Vec<&Node> {
        let mut out = vec![self];
        for c in &self.children {
            out.extend(c.walk());
        }
        out
    }
}

pub fn tone(phase: Phase) -> &'static str {
    match phase {
        Phase::Idle | Phase::Stopped => "neutral",
        Phase::Running => "busy",
        Phase::Waiting => "accent",
        Phase::Interrupted => "warn",
        Phase::Failed => "error",
    }
}

pub fn text(value: impl Into<Value>) -> Node {
    Node::new("Text").p("value", value)
}
pub fn badge(label: impl Into<Value>, tone: &str) -> Node {
    Node::new("Badge").p("label", label).p("tone", tone)
}
pub fn button(label: impl Into<Value>, action: &str) -> Node {
    Node::new("Button").p("label", label).p("action", action)
}
pub fn row(children: Vec<Node>) -> Node {
    Node::new("Stack").p("dir", "row").p("gap", 2).p("align", "between").kids(children)
}
pub fn col(children: Vec<Node>) -> Node {
    Node::new("Stack").p("dir", "col").p("gap", 2).kids(children)
}
pub fn card(title: &str, phase: Phase, children: Vec<Node>) -> Node {
    Node::new("Card").p("title", title).p("tone", tone(phase)).p("phase", json!(phase)).kids(children)
}
pub fn slot(of: &str, at: &str) -> Node {
    Node::new("Slot").p("of", of).p("at", at)
}

/// An avatar: the object's emoji (or /ui/assets image), its label (initials fallback), a status ring in its light's
/// tone, and for an engine its live state — `running` below, open `asks`, `failed` below (the UI maps these to a
/// pulsing ring, a 💬 badge, a ⚠️ badge).
pub fn avatar(icon: &str, label: &str, phase: Phase, light: &str, (running, asks, failed): (u64, u64, u64)) -> Node {
    let mut n = Node::new("Avatar").p("icon", icon).p("label", label).p("phase", json!(phase)).p("tone", light);
    if running > 0 {
        n = n.p("running", running);
    }
    if asks > 0 {
        n = n.p("asks", asks);
    }
    if failed > 0 {
        n = n.p("failed", failed);
    }
    n
}
