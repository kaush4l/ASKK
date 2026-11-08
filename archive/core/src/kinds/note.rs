use anyhow::{Result, anyhow, bail};
use serde_json::{Value, json};

use crate::node::{Node, card, col, text};
use crate::object::{Action, Kind, Obj};

pub struct Note;

fn body(obj: &Obj) -> &str {
    obj.state["text"].as_str().unwrap_or("")
}

impl Kind for Note {
    /// The default avatar (an object may set `icon:` in its .md instead).
    fn avatar(&self) -> &'static str {
        "📝"
    }
    fn kind(&self) -> &'static str {
        "note"
    }
    fn about(&self) -> &'static str {
        "markdown text"
    }
    fn config(&self) -> &'static [(&'static str, &'static str)] {
        &[]
    }
    fn init(&self, obj: &Obj) -> Value {
        json!({ "text": obj.body })
    }
    fn actions(&self, _: &Obj) -> Vec<Action> {
        vec![Action::new("edit", "Edit").arg("text", "text")]
    }
    fn act(&self, obj: &mut Obj, action: &str, args: &Value) -> Result<()> {
        match action {
            "edit" => {
                let t = args["text"].as_str().ok_or_else(|| anyhow!("edit needs text"))?;
                obj.state["text"] = json!(t);
            }
            other => bail!("{} has no action {other}", obj.id),
        }
        Ok(())
    }
    fn now(&self, obj: &Obj) -> Option<String> {
        Some(format!("{} word(s)", body(obj).split_whitespace().count()))
    }
    fn small(&self, obj: &Obj) -> Node {
        // inline markdown, one line: the frontend renders it inline (contract §5 Text md)
        let first = body(obj).lines().next().unwrap_or("").chars().take(80).collect::<String>();
        let _ = first;
        let rest: String = body(obj).lines().take(8).collect::<Vec<_>>().join("\n");
        col(vec![text(rest).p("size", "sm").p("md", true)])
    }
    fn medium(&self, obj: &Obj) -> Node {
        card(&obj.title, obj.phase, vec![text(body(obj)).p("md", true)])
    }
    fn large(&self, obj: &Obj) -> Node {
        card(
            &obj.title,
            obj.phase,
            vec![col(vec![
                text(body(obj)).p("md", true),
                Node::new("Divider"),
                Node::new("Field")
                    .p("label", "Text")
                    .p("name", "text")
                    .p("value", body(obj))
                    .p("action", "edit")
                    .p("kind", "text"),
            ])],
        )
        .p("scene", "reader")
    }
    fn focus(&self, obj: &Obj) -> Option<String> {
        Some(body(obj).lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("empty").to_string())
    }
    fn prompt(&self, obj: &Obj) -> String {
        format!("note \"{}\" ({}):\n{}", obj.title, obj.id, body(obj))
    }
}
