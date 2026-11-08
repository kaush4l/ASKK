//! A tools element: the tools this engine's loop may call, by name, from the core registry.
//! An empty list (or no tools element) means the loop offers no tools, and every view says so.

use anyhow::{Result, bail};
use serde_json::{Value, json};

use crate::engine::EngineNode;
use crate::node::{Node, badge, card, row, text};
use crate::object::{Action, Kind, Obj, Twin};
use crate::run::{list_of, offered};
use crate::tools as registry;

pub struct Tools;

fn names(obj: &Obj) -> Vec<String> {
    list_of(obj.config.get("list")).iter().filter_map(|v| v.as_str().map(String::from)).collect()
}

impl Kind for Tools {
    /// The default avatar (an object may set `icon:` in its .md instead).
    fn avatar(&self) -> &'static str {
        "🧰"
    }
    fn kind(&self) -> &'static str {
        "tools"
    }
    fn about(&self) -> &'static str {
        "the tools the loop may call; config list: [note.write, clock.now, clock.wait, help.ask, files.read]"
    }
    fn config(&self) -> &'static [(&'static str, &'static str)] {
        &[("list", "list")]
    }
    fn init(&self, _: &Obj) -> Value {
        json!({})
    }
    fn actions(&self, _: &Obj) -> Vec<Action> {
        vec![]
    }
    fn act(&self, obj: &mut Obj, action: &str, _: &Value) -> Result<()> {
        bail!("{} has no action {action}", obj.id)
    }
    fn now(&self, obj: &Obj) -> Option<String> {
        let n = names(obj);
        Some(if n.is_empty() { "No tools".into() } else { format!("{} tool(s)", n.len()) })
    }
    fn small(&self, obj: &Obj) -> Node {
        let n = names(obj);
        row(vec![text(obj.title.as_str()), if n.is_empty() { text("No tools").p("size", "sm") } else { text(n.join(", ")).p("size", "sm").p("mono", true) }])
    }
    fn medium(&self, obj: &Obj) -> Node {
        let n = names(obj);
        if n.is_empty() {
            return card(&obj.title, obj.phase, vec![text("No tools")]);
        }
        let rows: Vec<Value> = n
            .iter()
            .map(|t| match registry::find(t) {
                Some(d) => json!([d.name, d.args, d.about]),
                None => json!([t, "", "unknown tool: not offered"]),
            })
            .collect();
        card(&obj.title, obj.phase, vec![Node::new("Table").p("columns", json!(["tool", "args", "what"])).p("rows", rows)])
    }
    fn focus(&self, obj: &Obj) -> Option<String> {
        let n = names(obj);
        Some(if n.is_empty() { "No tools".into() } else { n.join(", ") })
    }
    fn prompt(&self, obj: &Obj) -> String {
        let n = names(obj);
        if n.is_empty() { format!("tools \"{}\" ({}): No tools", obj.title, obj.id) } else { format!("tools \"{}\" ({}): {}", obj.title, obj.id, n.join(", ")) }
    }
    /// Inside its engine the views also say which tools the current phase offers.
    fn twin_in(&self, obj: &Obj, eng: Option<&EngineNode>) -> Twin {
        let mut t = self.twin(obj);
        if let Some(e) = eng
            && !names(obj).is_empty()
        {
            let now = offered(e);
            let line = if now.is_empty() { badge("No tools offered in this phase", "warn") } else { badge(format!("offered now: {}", now.join(", ")), "neutral") };
            t.views.medium.children.push(line.clone());
            t.views.large = t.views.medium.clone();
        }
        t
    }
}
