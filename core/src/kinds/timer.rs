//! A long-running action, end to end: `start` runs a task that ticks once a second.

use anyhow::{Result, bail};
use serde_json::{Value, json};
use std::time::Duration;

use crate::hub::TaskCtx;
use crate::node::{Node, badge, button, card, col, row, text, tone};
use crate::object::{Action, Kind, Obj, Phase, TaskFn, TaskFuture};

pub struct Timer;

/// One tick: progress moves once a second.
pub const TICK: Duration = Duration::from_secs(1);

fn seconds(obj: &Obj) -> u64 {
    obj.num("seconds", 10.0).max(0.0) as u64
}
fn elapsed(obj: &Obj) -> u64 {
    obj.state["elapsed"].as_u64().unwrap_or(0)
}
fn meter(obj: &Obj) -> Node {
    let t = if obj.phase == Phase::Running { "busy" } else if elapsed(obj) >= seconds(obj) { "ok" } else { tone(obj.phase) };
    Node::new("Meter").p("label", obj.title.as_str()).p("value", elapsed(obj)).p("max", seconds(obj)).p("tone", t)
}
fn toggle(obj: &Obj) -> Node {
    if obj.phase == Phase::Running { button("Cancel", "cancel") } else { button("Start", "start").p("tone", "accent") }
}

fn run(ctx: TaskCtx) -> TaskFuture {
    Box::pin(async move {
        loop {
            let o = ctx.obj()?;
            if elapsed(&o) >= seconds(&o) {
                return Ok(());
            }
            tokio::time::sleep(TICK).await;
            ctx.update(|o| {
                o.state["elapsed"] = json!(elapsed(o) + 1);
                o.state["seconds"] = json!(seconds(o));
                Ok(())
            })
            .await?;
        }
    })
}

impl Kind for Timer {
    /// The default avatar (an object may set `icon:` in its .md instead).
    fn avatar(&self) -> &'static str {
        "⏱️"
    }
    fn kind(&self) -> &'static str {
        "timer"
    }
    fn about(&self) -> &'static str {
        "counts to its seconds in a background task; config seconds"
    }
    fn config(&self) -> &'static [(&'static str, &'static str)] {
        &[("seconds", "number")]
    }
    fn init(&self, obj: &Obj) -> Value {
        json!({ "elapsed": 0, "seconds": seconds(obj) })
    }
    fn actions(&self, obj: &Obj) -> Vec<Action> {
        if obj.phase == Phase::Running { vec![Action::new("cancel", "Cancel")] } else { vec![Action::new("start", "Start")] }
    }
    fn act(&self, obj: &mut Obj, action: &str, _: &Value) -> Result<()> {
        match action {
            "start" if obj.phase == Phase::Running => bail!("{} is already running", obj.id),
            "start" => {
                obj.phase = Phase::Running;
                obj.state = json!({ "elapsed": 0, "seconds": seconds(obj) });
            }
            "cancel" => bail!("{} is not running", obj.id),
            other => bail!("{} has no action {other}", obj.id),
        }
        Ok(())
    }
    fn task(&self, _: &Obj, action: &str) -> Option<TaskFn> {
        (action == "start").then_some(run as TaskFn)
    }
    fn now(&self, obj: &Obj) -> Option<String> {
        Some(if obj.phase == Phase::Running { format!("{}/{} s", elapsed(obj), seconds(obj)) } else if elapsed(obj) >= seconds(obj) && elapsed(obj) > 0 { format!("done · {} s", seconds(obj)) } else { format!("{}/{} s", elapsed(obj), seconds(obj)) })
    }
    fn small(&self, obj: &Obj) -> Node {
        row(vec![meter(obj), badge(json!(obj.phase), tone(obj.phase))])
    }
    fn medium(&self, obj: &Obj) -> Node {
        card(&obj.title, obj.phase, vec![col(vec![meter(obj), row(vec![badge(json!(obj.phase), tone(obj.phase)), toggle(obj)])])])
    }
    fn large(&self, obj: &Obj) -> Node {
        let mut c = self.medium(obj);
        c.children.push(text(format!("{} of {} s", elapsed(obj), seconds(obj))).p("mono", true));
        c
    }
    fn prompt(&self, obj: &Obj) -> String {
        format!(
            "timer \"{}\" ({}): {} of {} s, {}",
            obj.title,
            obj.id,
            elapsed(obj),
            seconds(obj),
            json!(obj.phase).as_str().unwrap_or("?")
        )
    }
}
