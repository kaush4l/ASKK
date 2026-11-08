//! # goal
//! What the engine is working towards. Config `goal` (the standing goal) and `done` (how to
//! tell it is reached). State `goal` overrides config once the model calls `set_goal`, and
//! `reached` is set by `goal_reached`. First in the prompt (see `core::ORDER`).
use crate::core::{read, tool, value, Component, Event, Spec, Tool};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

const DOC: &str = "The goal (config `goal`, `done`); set_goal / goal_reached tools; first section of the prompt.";

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Cfg {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    goal: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    done: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct St {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    goal: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    reached: bool,
}

pub struct Goal {
    name: String,
    cfg: Cfg,
    st: St,
}

pub fn new(s: Spec) -> Result<Box<dyn Component>, String> {
    Ok(Box::new(Goal { name: s.name, cfg: read(&s.config)?, st: read(&s.state)? }))
}

impl Goal {
    fn goal(&self) -> &str {
        if self.st.goal.is_empty() { &self.cfg.goal } else { &self.st.goal }
    }
}

impl Component for Goal {
    fn kind(&self) -> &'static str { "goal" }
    fn name(&self) -> &str { &self.name }
    fn doc(&self) -> &'static str { DOC }
    fn config(&self) -> Value { value(&self.cfg) }
    fn state(&self) -> Value { value(&self.st) }
    fn view(&self) -> crate::compose::Node {
        let mark = if self.st.reached { "reached" } else { "open" };
        super::tile(&self.name, "goal", [format!("{} ({mark})", self.goal()), self.cfg.done.clone()].into_iter().filter(|l| !l.is_empty()))
    }
    fn on(&mut self, ev: &Event) {
        if let Event::Called { tool, args, result } = ev {
            if result.starts_with("error") {
                return;
            }
            match tool.as_str() {
                "set_goal" => {
                    self.st.goal = args["goal"].as_str().unwrap_or_default().into();
                    self.st.reached = false;
                }
                "goal_reached" => self.st.reached = true,
                _ => {}
            }
        }
    }
    fn prompt(&self) -> Option<String> {
        if self.goal().is_empty() {
            return None;
        }
        let mut s = format!("Goal: {}", self.goal());
        if !self.cfg.done.is_empty() {
            s.push_str(&format!("\nDone when: {}", self.cfg.done));
        }
        s.push_str(if self.st.reached { "\nStatus: reached" } else { "\nStatus: open (call goal_reached when done)" });
        Some(s)
    }
    fn tools(&self) -> Vec<Arc<dyn Tool>> {
        vec![
            tool("set_goal", "replace the current goal", json!({"goal": "text"}), |a| {
                a["goal"].as_str().filter(|g| !g.is_empty()).map(|g| json!(format!("goal is now: {g}"))).ok_or_else(|| "goal missing".into())
            }),
            tool("goal_reached", "mark the goal as reached", Value::Null, |_| Ok(json!("goal reached"))),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_goal_until_set_then_reached() {
        let mut g = new(Spec { kind: "goal".into(), name: "goal".into(), config: json!({"goal": "ship", "done": "tests green"}), state: Value::Null }).unwrap();
        assert_eq!(g.prompt().unwrap(), "Goal: ship\nDone when: tests green\nStatus: open (call goal_reached when done)");
        g.on(&Event::Called { tool: "set_goal".into(), args: json!({"goal": "ship v2"}), result: "goal is now: ship v2".into() });
        g.on(&Event::Called { tool: "goal_reached".into(), args: Value::Null, result: "goal reached".into() });
        let again = crate::core::build(g.spec()).unwrap();
        assert!(again.prompt().unwrap().starts_with("Goal: ship v2") && again.prompt().unwrap().ends_with("Status: reached"));
        assert!(new(Spec { kind: "goal".into(), ..Default::default() }).unwrap().prompt().is_none());
    }
}
