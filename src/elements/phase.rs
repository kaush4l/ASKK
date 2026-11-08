//! # phase
//! Steers concentration. Config `phases: [{name, focus, tools?}]`; state `current`. The prompt
//! names the current phase and its focus; when a phase lists `tools`, only those (and
//! `set_phase`) are allowed. The model moves on with the `set_phase` tool.
use crate::core::{read, tool, value, Component, Event, Spec, Tool};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

const DOC: &str = "Phases with a focus and optional tool list; current phase in state; set_phase tool.";

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Def {
    name: String,
    #[serde(default)]
    focus: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<String>>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Cfg {
    #[serde(default)]
    phases: Vec<Def>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct St {
    #[serde(default)]
    current: String,
}

pub struct Phase {
    name: String,
    cfg: Cfg,
    st: St,
}

pub fn new(s: Spec) -> Result<Box<dyn Component>, String> {
    Ok(Box::new(Phase { name: s.name, cfg: read(&s.config)?, st: read(&s.state)? }))
}

impl Phase {
    fn current(&self) -> Option<&Def> {
        self.cfg.phases.iter().find(|p| p.name == self.st.current).or(self.cfg.phases.first())
    }
}

impl Component for Phase {
    fn kind(&self) -> &'static str { "phase" }
    fn name(&self) -> &str { &self.name }
    fn doc(&self) -> &'static str { DOC }
    fn config(&self) -> Value { value(&self.cfg) }
    fn state(&self) -> Value { value(&self.st) }
    fn view(&self) -> crate::compose::Node {
        let lines = self.cfg.phases.iter().map(|p| {
            let mark = if Some(p) == self.current() { "▶ " } else { "" };
            format!("{mark}{}: {}", p.name, p.focus)
        });
        super::tile(&self.name, "phase", lines)
    }
    fn on(&mut self, ev: &Event) {
        if let Event::Called { tool, args, result } = ev {
            if tool == "set_phase" && !result.starts_with("error") {
                self.st.current = args["phase"].as_str().unwrap_or_default().into();
            }
        }
    }
    fn prompt(&self) -> Option<String> {
        let cur = self.current()?;
        let all: Vec<&str> = self.cfg.phases.iter().map(|p| p.name.as_str()).collect();
        Some(format!("Current phase: {}\nFocus: {}\nPhases: {} (move with set_phase)", cur.name, cur.focus, all.join(" → ")))
    }
    fn tools(&self) -> Vec<Arc<dyn Tool>> {
        if self.cfg.phases.is_empty() {
            return vec![];
        }
        let names: Vec<String> = self.cfg.phases.iter().map(|p| p.name.clone()).collect();
        vec![tool("set_phase", "switch the current phase", json!({"phase": names.join("|")}), move |a| {
            let p = a["phase"].as_str().unwrap_or_default();
            if names.iter().any(|n| n == p) { Ok(json!(format!("phase is now {p}"))) } else { Err(format!("no phase '{p}'")) }
        })]
    }
    fn allows(&self, t: &str) -> bool {
        t == "set_phase" || self.current().and_then(|p| p.tools.as_ref()).map_or(true, |l| l.iter().any(|x| x == t))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn phases() -> Box<dyn Component> {
        new(Spec {
            kind: "phase".into(),
            name: "phase".into(),
            config: json!({"phases": [{"name": "plan", "focus": "think", "tools": ["read"]}, {"name": "build", "focus": "do"}]}),
            state: Value::Null,
        })
        .unwrap()
    }

    #[test]
    fn first_phase_by_default_and_tools_gated() {
        let p = phases();
        assert!(p.prompt().unwrap().starts_with("Current phase: plan"));
        assert!(p.allows("read") && p.allows("set_phase") && !p.allows("write"));
    }

    #[test]
    fn set_phase_moves_and_is_persisted() {
        let mut p = phases();
        p.on(&Event::Called { tool: "set_phase".into(), args: json!({"phase": "build"}), result: "phase is now build".into() });
        assert!(p.allows("write"));
        assert_eq!(build_again(&*p).prompt().unwrap().lines().next().unwrap(), "Current phase: build");
        p.on(&Event::Called { tool: "set_phase".into(), args: json!({"phase": "zzz"}), result: "error: no phase".into() });
        assert!(p.prompt().unwrap().contains("build"));
    }

    fn build_again(c: &dyn Component) -> Box<dyn Component> {
        crate::core::build(c.spec()).unwrap()
    }
}
