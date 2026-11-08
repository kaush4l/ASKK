use anyhow::{Result, bail};
use serde_json::{Value, json};

use crate::node::{Node, button, card, col, row, text};
use crate::object::{Action, Kind, Obj};

pub struct Counter;

fn value(obj: &Obj) -> f64 {
    obj.state["value"].as_f64().unwrap_or(0.0)
}
fn step(obj: &Obj) -> f64 {
    obj.num("step", 1.0)
}
fn show(n: f64) -> String {
    if n.fract() == 0.0 { format!("{}", n as i64) } else { n.to_string() }
}

impl Kind for Counter {
    /// The default avatar (an object may set `icon:` in its .md instead).
    fn avatar(&self) -> &'static str {
        "🔢"
    }
    fn kind(&self) -> &'static str {
        "counter"
    }
    fn about(&self) -> &'static str {
        "a number; config step"
    }
    fn config(&self) -> &'static [(&'static str, &'static str)] {
        &[("step", "number")]
    }
    fn init(&self, _: &Obj) -> Value {
        json!({ "value": 0 })
    }
    fn actions(&self, _: &Obj) -> Vec<Action> {
        vec![Action::new("inc", "+"), Action::new("dec", "−"), Action::new("reset", "Reset")]
    }
    fn act(&self, obj: &mut Obj, action: &str, _: &Value) -> Result<()> {
        let v = match action {
            "inc" => value(obj) + step(obj),
            "dec" => value(obj) - step(obj),
            "reset" => 0.0,
            other => bail!("{} has no action {other}", obj.id),
        };
        obj.state["value"] = if v.fract() == 0.0 { json!(v as i64) } else { json!(v) };
        Ok(())
    }
    fn now(&self, obj: &Obj) -> Option<String> {
        Some(format!("value {}", show(value(obj))))
    }
    fn small(&self, obj: &Obj) -> Node {
        row(vec![text(obj.title.as_str()), text(show(value(obj))).p("mono", true)])
    }
    fn medium(&self, obj: &Obj) -> Node {
        let s = show(step(obj));
        card(
            &obj.title,
            obj.phase,
            vec![col(vec![
                text(show(value(obj))).p("size", "xl").p("mono", true),
                Node::new("Stack").p("dir", "row").p("gap", 2).kids(vec![
                    button(format!("−{s}"), "dec"),
                    button(format!("+{s}"), "inc").p("tone", "accent"),
                    button("Reset", "reset"),
                ]),
            ])],
        )
    }
    fn large(&self, obj: &Obj) -> Node {
        let mut c = self.medium(obj);
        c.children.push(Node::new("Table").p("columns", json!(["config", "value"])).p("rows", json!([["step", show(step(obj))]])));
        c
    }
    fn prompt(&self, obj: &Obj) -> String {
        format!("counter \"{}\" ({}): value {}, step {}", obj.title, obj.id, show(value(obj)), show(step(obj)))
    }
}
