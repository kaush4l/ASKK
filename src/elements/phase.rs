//! # phase
//! The configurable focus: an ordered list of phases, each with what to concentrate on (`focus`),
//! its own special `instructions`, the outcomes it must produce (`expect`), when it is finished (`goal`), and optionally which `tools` it may call and which `elements`
//! the model sees in it. The engine works one phase at a time and moves on only when that phase's
//! goal is met: the `phase_done {met}` tool advances to the next phase in order, and needs the
//! evidence. No jumping. After the last phase it stays (or starts over with `repeat`).
//!
//! ```json
//! {"kind": "phase", "name": "phase", "config": {"phases": [
//!   {"name": "understand", "focus": "Restate the request.", "goal": "the request and the gaps are written down", "tools": ["read_file"]},
//!   {"name": "act", "focus": "Do the work.", "goal": "the change is made and checked", "elements": ["goal", "history", "handoff"]},
//!   {"name": "refocus", "refocus": true, "focus": "Write the summary the next steps need."}
//! ]}}
//! ```
//! A phase marked `refocus` is not in the sequence: its `focus` is the instruction sent when the
//! context is 90% full.
use crate::core::{read, tool, value, Component, Event, Spec, Tool};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

const DOC: &str = "Ordered phases (focus, instructions, expect, goal, tools?, elements?); phase_done {met} moves to the next once the goal is met.";

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Def {
    name: String,
    /// What to concentrate on in this phase.
    #[serde(default)]
    focus: String,
    /// Special instructions that hold only in this phase (rules, how to work, what to avoid).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    instructions: String,
    /// Outcomes this phase must produce (files, findings, a decision…), checked before moving on.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    expect: Vec<String>,
    /// When this phase is finished; `phase_done` must say how it is met.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    goal: String,
    /// Only these tools (plus `phase_done`) may be called in this phase.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<String>>,
    /// Only these elements are in the prompt in this phase (the phase itself always is).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    elements: Option<Vec<String>>,
    /// This phase is the refocus: its `focus` is the instruction sent when the context is 90% full.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    refocus: bool,
    /// Steps (model replies) this phase may take; once spent the prompt tells the model to call
    /// `phase_done` with what it has. 0 = no limit.
    #[serde(default, skip_serializing_if = "is_zero")]
    budget: usize,
}

fn is_zero(n: &usize) -> bool {
    *n == 0
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Cfg {
    #[serde(default)]
    phases: Vec<Def>,
    /// After the last phase, start again at the first.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    repeat: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Done {
    phase: String,
    met: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct St {
    #[serde(default)]
    current: String,
    /// Finished phases with how their goal was met, oldest first (last 20).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    done: Vec<Done>,
    /// Model replies so far in the current phase.
    #[serde(default, skip_serializing_if = "is_zero")]
    steps: usize,
}

pub struct Phase {
    name: String,
    cfg: Cfg,
    st: St,
}

pub fn new(s: Spec) -> Result<Box<dyn Component>, String> {
    let p = Phase { name: s.name, cfg: read(&s.config)?, st: read(&s.state)? };
    let mut seen = std::collections::BTreeSet::new();
    for d in &p.cfg.phases {
        if d.name.is_empty() || !seen.insert(d.name.as_str()) {
            return Err(format!("phase name '{}' is empty or repeated", d.name));
        }
    }
    Ok(Box::new(p))
}

/// The next phase after `cur` in `seq` (wrapping when `repeat`).
fn next_of(seq: &[String], cur: &str, repeat: bool) -> Option<String> {
    let i = seq.iter().position(|n| n == cur)?;
    seq.get(i + 1).cloned().or_else(|| repeat.then(|| seq[0].clone()))
}

impl Phase {
    /// The working phases, in order (the refocus phase is not one of them).
    fn seq(&self) -> Vec<&Def> {
        self.cfg.phases.iter().filter(|p| !p.refocus).collect()
    }
    fn current(&self) -> Option<&Def> {
        let seq = self.seq();
        seq.iter().find(|p| p.name == self.st.current).or(seq.first()).copied()
    }
    fn next(&self) -> Option<String> {
        let names: Vec<String> = self.seq().iter().map(|p| p.name.clone()).collect();
        next_of(&names, &self.current()?.name, self.cfg.repeat)
    }
}

impl Component for Phase {
    fn kind(&self) -> &'static str { "phase" }
    fn unique(&self) -> bool { true }
    fn category(&self) -> &'static str { "prompt" }
    fn icon(&self) -> &'static str { "flag" }
    fn slot(&self) -> crate::core::Slot { crate::core::Slot::Position }
    fn abilities(&self) -> Vec<String> { self.tools().iter().map(|t| t.name()).collect() }
    fn name(&self) -> &str { &self.name }
    fn doc(&self) -> &'static str { DOC }
    fn config(&self) -> Value { value(&self.cfg) }
    fn state(&self) -> Value { value(&self.st) }
    fn view(&self) -> crate::core::node::Node {
        let cur = self.current().map(|p| p.name.clone()).unwrap_or_default();
        let lines = self.seq().into_iter().map(|p| {
            let mark = if p.name == cur { "▶ " } else if self.st.done.iter().any(|d| d.phase == p.name) { "✓ " } else { "" };
            if p.goal.is_empty() { format!("{mark}{}: {}", p.name, p.focus) } else { format!("{mark}{}: {} (done when {})", p.name, p.focus, p.goal) }
        });
        super::tile(&self.name, "phase", lines)
    }
    fn refocus(&self) -> Option<String> {
        self.cfg.phases.iter().find(|p| p.refocus).map(|p| p.focus.clone()).filter(|f| !f.is_empty())
    }
    fn phase(&self) -> Option<String> {
        self.current().map(|p| p.name.clone())
    }
    fn indicator(&self) -> Option<String> {
        self.current().map(|p| format!("phase {}", p.name))
    }
    fn on(&mut self, ev: &Event) {
        match ev {
            Event::Called { tool, args, result } if tool == "phase_done" && !result.starts_with("error") => {
                let Some(cur) = self.current().map(|p| p.name.clone()) else { return };
                let Some(next) = self.next() else { return };
                self.st.done.push(Done { phase: cur, met: args["met"].as_str().unwrap_or_default().into() });
                let n = self.st.done.len().saturating_sub(20);
                self.st.done.drain(..n);
                self.st.current = next;
                self.st.steps = 0;
            }
            Event::Reply(_) => self.st.steps += 1,
            Event::Cleared => self.st = St::default(),
            _ => {}
        }
    }
    fn prompt(&self) -> Option<String> {
        let cur = self.current()?;
        let seq = self.seq();
        let at = seq.iter().position(|p| p.name == cur.name).unwrap_or(0) + 1;
        let mut out = format!("Phase {at}/{}: {}\nFocus: {}", seq.len(), cur.name, cur.focus);
        if !cur.instructions.trim().is_empty() {
            out.push_str(&format!("\nInstructions:\n{}", cur.instructions.trim()));
        }
        if !cur.expect.is_empty() {
            out.push_str("\nExpected outcomes:");
            for x in &cur.expect {
                out.push_str(&format!("\n- {x}"));
            }
        }
        if !cur.goal.is_empty() {
            out.push_str(&format!("\nGoal of this phase: {}", cur.goal));
        }
        if cur.budget > 0 {
            if self.st.steps >= cur.budget {
                out.push_str(&format!("\nBudget spent ({} steps). Do not explore further: call phase_done now with what you have, and note what is still unknown.", cur.budget));
            } else {
                out.push_str(&format!("\nStep {} of {} for this phase.", self.st.steps + 1, cur.budget));
            }
        }
        out.push_str(&match self.next() {
            Some(n) => format!("\nWhen the goal is met, call phase_done(met: \"<how it is met>\") to move on to {n}. Not before."),
            None => "\nThis is the last phase: answer when its goal is met.".into(),
        });
        Some(out)
    }
    fn tools(&self) -> Vec<Arc<dyn Tool>> {
        if self.seq().len() < 2 {
            return vec![];
        }
        let names: Vec<String> = self.seq().iter().map(|p| p.name.clone()).collect();
        let cur = self.current().map(|p| p.name.clone()).unwrap_or_default();
        let next = next_of(&names, &cur, self.cfg.repeat);
        vec![tool("phase_done", "the current phase's goal is met: move to the next phase", json!({"met": "how the goal is met (evidence)"}), move |a| {
            let met = a["met"].as_str().unwrap_or_default().trim();
            match &next {
                _ if met.is_empty() => Err("say how the goal is met (met)".into()),
                Some(n) => Ok(json!(format!("{cur} done; phase is now {n}"))),
                None => Err(format!("{cur} is the last phase: answer instead")),
            }
        })]
    }
    fn allows(&self, t: &str) -> bool {
        t == "phase_done" || self.current().and_then(|p| p.tools.as_ref()).map_or(true, |l| l.iter().any(|x| x == t))
    }
    fn shows(&self, element: &str) -> bool {
        element == self.name || self.current().and_then(|p| p.elements.as_ref()).map_or(true, |l| l.iter().any(|x| x == element))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_spent_budget_tells_the_model_to_move_on_and_resets_on_phase_done() {
        let cfg = json!({"phases": [{"name": "triage", "focus": "f", "budget": 2}, {"name": "change", "focus": "g"}]});
        let mut p = new(Spec { kind: "phase".into(), name: "phase".into(), config: cfg, ..Default::default() }).unwrap();
        assert!(p.prompt().unwrap().contains("Step 1 of 2"));
        p.on(&Event::Reply("x".into()));
        p.on(&Event::Reply("x".into()));
        assert!(p.prompt().unwrap().contains("Budget spent (2 steps)"));
        p.on(&Event::Called { tool: "phase_done".into(), args: json!({"met": "m"}), result: "ok".into() });
        let now = p.prompt().unwrap();
        assert!(now.contains("change") && !now.contains("Budget"), "{now}");
    }

    fn phases(repeat: bool) -> Box<dyn Component> {
        new(Spec {
            kind: "phase".into(),
            name: "phase".into(),
            config: json!({"repeat": repeat, "phases": [
                {"name": "plan", "focus": "think", "instructions": "Read before writing.", "expect": ["plan.md"], "goal": "a plan exists", "tools": ["read"], "elements": ["goal"]},
                {"name": "build", "focus": "do", "goal": "it works"},
                {"name": "refocus", "refocus": true, "focus": "sum up"}
            ]}),
            state: Value::Null,
        })
        .unwrap()
    }

    async fn done(p: &mut Box<dyn Component>, met: &str) -> Result<Value, String> {
        let r = p.tools()[0].invoke(json!({"met": met}), crate::core::Toolbox(Default::default(), None)).await;
        let text = match &r { Ok(v) => v.to_string(), Err(e) => format!("error: {e}") };
        p.on(&Event::Called { tool: "phase_done".into(), args: json!({"met": met}), result: text });
        r
    }

    #[test]
    fn first_phase_focus_goal_and_what_it_sees() {
        let p = phases(false);
        let text = p.prompt().unwrap();
        assert!(text.starts_with("Phase 1/2: plan\nFocus: think\nInstructions:\nRead before writing.\nExpected outcomes:\n- plan.md\nGoal of this phase: a plan exists"), "{text}");
        assert!(text.contains("move on to build"));
        assert!(p.allows("read") && p.allows("phase_done") && !p.allows("write"), "tools gated per phase");
        assert!(p.shows("goal") && p.shows("phase") && !p.shows("history"), "elements gated per phase");
        assert_eq!(p.refocus().as_deref(), Some("sum up"), "refocus is not in the sequence");
    }

    #[tokio::test]
    async fn moves_only_forward_and_only_with_evidence() {
        let mut p = phases(false);
        assert!(done(&mut p, " ").await.is_err(), "no evidence, no move");
        assert_eq!(p.phase().as_deref(), Some("plan"));
        assert!(done(&mut p, "plan.md written").await.is_ok());
        assert_eq!(p.phase().as_deref(), Some("build"));
        assert!(p.shows("history") && p.allows("write"), "build has no limits");
        let mut p = crate::core::build(p.spec()).unwrap();
        assert_eq!(p.phase().as_deref(), Some("build"), "survives a restart");
        assert_eq!(p.state()["done"][0], json!({"phase": "plan", "met": "plan.md written"}));
        assert!(p.prompt().unwrap().contains("last phase"));
        assert!(done(&mut p, "tests pass").await.is_err(), "the last phase does not move");
        assert_eq!(p.phase().as_deref(), Some("build"));
    }

    #[tokio::test]
    async fn repeat_starts_over() {
        let mut p = phases(true);
        done(&mut p, "a").await.unwrap();
        let mut p = crate::core::build(p.spec()).unwrap();
        done(&mut p, "b").await.unwrap();
        assert_eq!(p.phase().as_deref(), Some("plan"));
    }

    #[test]
    fn names_must_be_unique() {
        let bad = json!({"phases": [{"name": "a"}, {"name": "a"}]});
        assert!(new(Spec { kind: "phase".into(), name: "p".into(), config: bad, state: Value::Null }).is_err());
    }
}
