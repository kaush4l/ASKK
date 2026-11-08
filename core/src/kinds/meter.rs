use anyhow::{Result, anyhow, bail};
use serde_json::{Value, json};

use crate::node::{Node, card, col, row, text};
use crate::object::{Action, Kind, Obj};

pub struct Meter;

fn value(obj: &Obj) -> f64 {
    obj.state["value"].as_f64().unwrap_or(0.0)
}
fn max(obj: &Obj) -> f64 {
    obj.num("max", 100.0)
}
fn meter(obj: &Obj) -> Node {
    let share = if max(obj) > 0.0 { value(obj) / max(obj) } else { 0.0 };
    let tone = if share >= 1.0 { "warn" } else { "accent" };
    Node::new("Meter").p("label", obj.title.as_str()).p("value", value(obj)).p("max", max(obj)).p("tone", tone)
}

impl Kind for Meter {
    /// The default avatar (an object may set `icon:` in its .md instead).
    fn avatar(&self) -> &'static str {
        "📊"
    }
    fn kind(&self) -> &'static str {
        "meter"
    }
    fn about(&self) -> &'static str {
        "a bounded value; config max"
    }
    fn config(&self) -> &'static [(&'static str, &'static str)] {
        &[("max", "number")]
    }
    fn init(&self, _: &Obj) -> Value {
        json!({ "value": 0 })
    }
    fn actions(&self, _: &Obj) -> Vec<Action> {
        vec![Action::new("set", "Set").arg("value", "number")]
    }
    fn act(&self, obj: &mut Obj, action: &str, args: &Value) -> Result<()> {
        match action {
            "set" => {
                let v = args["value"]
                    .as_f64()
                    .or_else(|| args["value"].as_str().and_then(|s| s.trim().parse().ok()))
                    .ok_or_else(|| anyhow!("set needs a number value"))?;
                if !(0.0..=max(obj)).contains(&v) {
                    bail!("value {v} is outside 0..{}", max(obj));
                }
                obj.state["value"] = json!(v);
            }
            other => bail!("{} has no action {other}", obj.id),
        }
        Ok(())
    }
    fn now(&self, obj: &Obj) -> Option<String> {
        Some(format!("{} of {}", obj.state["value"].as_f64().map(|v| if v.fract() == 0.0 { format!("{}", v as i64) } else { v.to_string() }).unwrap_or_else(|| "0".into()), obj.num("max", 100.0)))
    }
    fn small(&self, obj: &Obj) -> Node {
        row(vec![meter(obj)])
    }
    fn medium(&self, obj: &Obj) -> Node {
        card(
            &obj.title,
            obj.phase,
            vec![col(vec![
                meter(obj),
                Node::new("Field")
                    .p("label", "Value")
                    .p("name", "value")
                    .p("value", value(obj))
                    .p("action", "set")
                    .p("kind", "number"),
            ])],
        )
    }
    fn large(&self, obj: &Obj) -> Node {
        let mut c = self.medium(obj);
        c.children.push(text(format!("{} of {}", value(obj), max(obj))).p("mono", true));
        c
    }
    fn prompt(&self, obj: &Obj) -> String {
        format!("meter \"{}\" ({}): {} of {}", obj.title, obj.id, value(obj), max(obj))
    }
}
