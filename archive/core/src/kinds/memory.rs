//! Memory: lessons kept beyond one run (the refocus workflow writes them).

use anyhow::{Result, bail};
use serde_json::{Value, json};

use crate::node::{Node, badge, button, card, col, row, text};
use crate::object::{Action, Kind, Obj};

pub struct Memory;

fn lessons(obj: &Obj) -> Vec<String> {
    obj.state["lessons"].as_array().map(|a| a.iter().filter_map(|l| l.as_str().map(String::from)).collect()).unwrap_or_default()
}

impl Kind for Memory {
    /// The default avatar (an object may set `icon:` in its .md instead).
    fn avatar(&self) -> &'static str {
        "📚"
    }
    fn kind(&self) -> &'static str {
        "memory"
    }
    fn about(&self) -> &'static str {
        "lessons kept beyond a run; refocus writes them"
    }
    fn config(&self) -> &'static [(&'static str, &'static str)] {
        &[]
    }
    fn init(&self, _: &Obj) -> Value {
        json!({ "lessons": [] })
    }
    fn actions(&self, _: &Obj) -> Vec<Action> {
        vec![Action::new("clear", "Clear")]
    }
    fn act(&self, obj: &mut Obj, action: &str, _: &Value) -> Result<()> {
        match action {
            "clear" => obj.state["lessons"] = json!([]),
            other => bail!("{} has no action {other}", obj.id),
        }
        Ok(())
    }
    fn now(&self, obj: &Obj) -> Option<String> {
        Some(format!("{} lesson(s)", lessons(obj).len()))
    }
    fn small(&self, obj: &Obj) -> Node {
        row(vec![text(obj.title.as_str()), badge(format!("{} lesson(s)", lessons(obj).len()), "neutral")])
    }
    fn medium(&self, obj: &Obj) -> Node {
        let l = lessons(obj);
        let mut kids: Vec<Node> = if l.is_empty() { vec![text("No lessons yet").p("size", "sm")] } else { l.iter().map(|x| text(format!("- {x}")).p("size", "sm")).collect() };
        if !l.is_empty() {
            kids.push(button("Clear", "clear"));
        }
        card(&obj.title, obj.phase, vec![col(kids)])
    }
    fn focus(&self, obj: &Obj) -> Option<String> {
        Some(lessons(obj).last().cloned().unwrap_or_else(|| "no lessons yet".into()))
    }
    fn activity(&self, before: &Obj, after: &Obj) -> Vec<(String, String, bool)> {
        let b = lessons(before);
        let mut out: Vec<(String, String, bool)> = lessons(after).into_iter().filter(|l| !b.contains(l)).map(|l| ("lesson".to_string(), l, true)).collect();
        out.extend(crate::object::phase_activity(before, after));
        out
    }
    fn prompt(&self, obj: &Obj) -> String {
        let l = lessons(obj);
        format!("memory \"{}\" ({}): {} lesson(s){}", obj.title, obj.id, l.len(), l.iter().map(|x| format!("\n- {x}")).collect::<String>())
    }
}
