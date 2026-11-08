use anyhow::{Result, bail};
use serde_json::{Value, json};

use crate::node::{badge, button, card, col, row, text, tone, Node};
use crate::object::{Action, Kind, Obj, Phase};

pub struct Status;

impl Kind for Status {
    /// The default avatar (an object may set `icon:` in its .md instead).
    fn avatar(&self) -> &'static str {
        "🚦"
    }
    fn kind(&self) -> &'static str {
        "status"
    }
    fn about(&self) -> &'static str {
        "a lifecycle you drive by hand"
    }
    fn config(&self) -> &'static [(&'static str, &'static str)] {
        &[]
    }
    fn init(&self, _: &Obj) -> Value {
        json!({})
    }
    fn actions(&self, _: &Obj) -> Vec<Action> {
        vec![Action::new("start", "Start"), Action::new("stop", "Stop")]
    }
    fn act(&self, obj: &mut Obj, action: &str, _: &Value) -> Result<()> {
        obj.phase = match action {
            "start" => Phase::Running,
            "stop" => Phase::Stopped,
            other => bail!("{} has no action {other}", obj.id),
        };
        Ok(())
    }
    fn small(&self, obj: &Obj) -> Node {
        row(vec![text(obj.title.as_str()), badge(json!(obj.phase), tone(obj.phase))])
    }
    fn medium(&self, obj: &Obj) -> Node {
        let toggle =
            if obj.phase == Phase::Running { button("Stop", "stop") } else { button("Start", "start").p("tone", "accent") };
        card(&obj.title, obj.phase, vec![col(vec![badge(json!(obj.phase), tone(obj.phase)), toggle])])
    }
    fn prompt(&self, obj: &Obj) -> String {
        format!("status \"{}\" ({}): {}", obj.title, obj.id, json!(obj.phase).as_str().unwrap_or("?"))
    }
}
