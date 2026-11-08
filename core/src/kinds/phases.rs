//! Phases: the steps a loop goes through; the current one narrows the tools offered.

use anyhow::{Result, anyhow, bail};
use serde_json::{Value, json};

use crate::node::{Node, badge, button, card, col, row, text};
use crate::object::{Action, Kind, Obj};
use crate::run::{current_phase, phase_defs};

pub struct Phases;

impl Kind for Phases {
    /// The default avatar (an object may set `icon:` in its .md instead).
    fn avatar(&self) -> &'static str {
        "🪜"
    }
    fn kind(&self) -> &'static str {
        "phases"
    }
    fn about(&self) -> &'static str {
        "the loop's phases (the one selected is the engine's mode; a workflow runs them in order); config list: [{id, title?, icon?, tools?: [names], instructions?: text}]; state current"
    }
    fn config(&self) -> &'static [(&'static str, &'static str)] {
        &[("list", "list")]
    }
    fn init(&self, obj: &Obj) -> Value {
        json!({ "current": phase_defs(obj).first().map(|p| p.id.clone()) })
    }
    fn actions(&self, _: &Obj) -> Vec<Action> {
        vec![Action::new("next", "Next phase"), Action::new("set", "Set phase").arg("phase", "text")]
    }
    fn act(&self, obj: &mut Obj, action: &str, args: &Value) -> Result<()> {
        let defs = phase_defs(obj);
        if defs.is_empty() {
            bail!("{} lists no phases", obj.id);
        }
        let cur = current_phase(obj).map(|p| p.id).unwrap_or_default();
        let next = match action {
            "next" => {
                let i = defs.iter().position(|d| d.id == cur).unwrap_or(0);
                defs.get(i + 1).ok_or_else(|| anyhow!("{cur} is the last phase"))?.id.clone()
            }
            "set" => {
                let want = args["phase"].as_str().map(str::trim).ok_or_else(|| anyhow!("set needs phase"))?;
                defs.iter().find(|d| d.id == want).ok_or_else(|| anyhow!("no phase {want} (one of {})", defs.iter().map(|d| d.id.as_str()).collect::<Vec<_>>().join(", ")))?.id.clone()
            }
            other => bail!("{} has no action {other}", obj.id),
        };
        obj.state["current"] = json!(next);
        Ok(())
    }
    fn now(&self, obj: &Obj) -> Option<String> {
        Some(format!("phase: {}", current_phase(obj).map(|p| p.label()).unwrap_or_else(|| "none".into())))
    }
    fn small(&self, obj: &Obj) -> Node {
        let cur = current_phase(obj).map(|p| p.label()).unwrap_or_else(|| "none".into());
        let chips: Vec<Node> = phase_defs(obj).iter().map(|d| if d.label() == cur { badge(d.label(), "accent") } else { button(d.label(), "set").p("args", json!({ "phase": d.id })) }).collect();
        Node::new("Stack").p("dir", "row").p("gap", 1).p("wrap", true).kids(chips)
    }
    fn medium(&self, obj: &Obj) -> Node {
        let cur = current_phase(obj).map(|p| p.id);
        let rows: Vec<Value> = phase_defs(obj)
            .iter()
            .map(|d| {
                json!([
                    if Some(&d.id) == cur.as_ref() { format!("▸ {}", d.label()) } else { d.label() },
                    d.tools.as_ref().map(|t| if t.is_empty() { "No tools".to_string() } else { t.join(", ") }).unwrap_or_else(|| "all listed".into()),
                    d.exit.clone().unwrap_or_default()
                ])
            })
            .collect();
        let mut kids: Vec<Node> = vec![];
        if rows.is_empty() {
            kids.push(text("No phases"));
        } else {
            // a chip per phase: the current one an accent badge, the others `set {phase}` buttons
            let chips: Vec<Node> = phase_defs(obj)
                .iter()
                .map(|d| if Some(&d.id) == cur.as_ref() { badge(d.label(), "accent") } else { button(d.label(), "set").p("args", json!({ "phase": d.id })) })
                .collect();
            kids.push(Node::new("Stack").p("dir", "row").p("gap", 2).p("wrap", true).kids(chips));
            if let Some(i) = current_phase(obj).and_then(|p| p.instructions) {
                kids.push(text(i).p("size", "sm"));
            }
            kids.push(Node::new("Table").p("columns", json!(["phase", "tools", "exit when"])).p("rows", rows));
            if current_phase(obj).is_some_and(|p| p.exit.is_some()) {
                kids.push(button("Next phase", "next"));
            }
        }
        card(&obj.title, obj.phase, vec![col(kids)])
    }
    fn focus(&self, obj: &Obj) -> Option<String> {
        let p = current_phase(obj)?;
        let words: Vec<&str> = p.instructions.as_deref().unwrap_or("").split_whitespace().take(10).collect();
        Some(if words.is_empty() { p.label() } else { format!("{} · {}", p.label(), words.join(" ")) })
    }
    fn large(&self, obj: &Obj) -> Node {
        let cur = current_phase(obj).map(|p| p.id);
        let mut kids: Vec<Node> = phase_defs(obj)
            .iter()
            .map(|d| {
                let on = Some(&d.id) == cur.as_ref();
                let tools = match &d.tools {
                    Some(t) if t.is_empty() => vec![badge("No tools", "neutral")],
                    Some(t) => t.iter().map(|x| badge(x.as_str(), "neutral")).collect(),
                    None => vec![badge("all listed tools", "neutral")],
                };
                let mut c = vec![
                    row(vec![text(d.label()).p("size", "lg"), if on { badge("current", "accent") } else { button("Use", "set").p("args", json!({ "phase": d.id })) }]),
                    Node::new("Stack").p("dir", "row").p("gap", 1).p("wrap", true).kids(tools),
                ];
                if let Some(i) = &d.instructions {
                    c.push(text(i.as_str()).p("size", "sm").p("md", true));
                }
                if let Some(x) = &d.exit {
                    c.push(text(format!("exit when {x}")).p("size", "xs").p("tone", "neutral"));
                }
                Node::new("Card").p("title", d.title()).p("tone", if on { "accent" } else { "neutral" }).kids(vec![col(c)])
            })
            .collect();
        if kids.is_empty() {
            kids.push(text("No phases"));
        }
        card(&obj.title, obj.phase, vec![Node::new("Grid").p("min", "sm").p("gap", 3).kids(kids)]).p("scene", "gallery")
    }
    fn prompt(&self, obj: &Obj) -> String {
        match current_phase(obj) {
            Some(p) => format!("phases \"{}\" ({}): current {}{}", obj.title, obj.id, p.id, p.exit.map(|x| format!(", exit when {x}")).unwrap_or_default()),
            None => format!("phases \"{}\" ({}): none", obj.title, obj.id),
        }
    }
}
