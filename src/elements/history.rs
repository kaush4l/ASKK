//! # history
//! The run's turns: user input, model replies, tool calls with results. Config `max` (turns in
//! the prompt, default 40). State `turns` is kept in full, so it survives restarts. It also
//! notices repeated call sequences and suggests a script (shortcut).
use crate::core::{read, value, Component, Event, Spec};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const DOC: &str = "Turns (user, model, tool) in order; last `max` in the prompt; flags repeated tool sequences.";

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Cfg {
    #[serde(default)]
    max: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Turn {
    pub role: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub tool: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct St {
    #[serde(default)]
    turns: Vec<Turn>,
}

pub struct History {
    name: String,
    cfg: Cfg,
    st: St,
}

pub fn new(s: Spec) -> Result<Box<dyn Component>, String> {
    Ok(Box::new(History { name: s.name, cfg: read(&s.config)?, st: read(&s.state)? }))
}

/// The longest tool sequence (length 2..=4) that occurs at least 3 times in a row-free scan.
pub fn repeated(tools: &[String]) -> Option<Vec<String>> {
    for n in (2..=4).rev() {
        for w in tools.windows(n) {
            let count = tools.windows(n).filter(|x| *x == w).count();
            if count >= 3 {
                return Some(w.to_vec());
            }
        }
    }
    None
}

impl History {
    fn push(&mut self, role: &str, text: String, tool: &str) {
        self.st.turns.push(Turn { role: role.into(), text, tool: tool.into() });
    }
    fn max(&self) -> usize {
        if self.cfg.max == 0 { 40 } else { self.cfg.max }
    }
}

impl Component for History {
    fn kind(&self) -> &'static str { "history" }
    fn name(&self) -> &str { &self.name }
    fn doc(&self) -> &'static str { DOC }
    fn config(&self) -> Value { value(&self.cfg) }
    fn state(&self) -> Value { value(&self.st) }
    fn view(&self) -> crate::compose::Node {
        let n = self.st.turns.len();
        let last = self.st.turns.iter().rev().take(3).rev().map(|t| format!("{}: {}", t.role, t.text.chars().take(80).collect::<String>()));
        super::tile(&self.name, "history", std::iter::once(format!("{n} turns")).chain(last))
    }
    fn on(&mut self, ev: &Event) {
        match ev {
            Event::Input(t) => self.push("user", t.clone(), ""),
            Event::Reply(t) => self.push("model", t.clone(), ""),
            Event::Called { tool, args, result } => self.push("tool", format!("{tool}({args}) -> {result}"), tool),
            Event::Folded(summary) => {
                let keep = self.st.turns.len().saturating_sub(4);
                let rest = self.st.turns.split_off(keep);
                self.st.turns = vec![Turn { role: "summary".into(), text: summary.clone(), tool: String::new() }];
                self.st.turns.extend(rest);
            }
            _ => {}
        }
    }
    fn prompt(&self) -> Option<String> {
        if self.st.turns.is_empty() {
            return None;
        }
        let skip = self.st.turns.len().saturating_sub(self.max());
        let mut out: Vec<String> = self.st.turns[skip..].iter().map(|t| format!("{}: {}", t.role, t.text)).collect();
        let tools: Vec<String> = self.st.turns.iter().filter(|t| !t.tool.is_empty()).map(|t| t.tool.clone()).collect();
        if let Some(seq) = repeated(&tools) {
            out.push(format!("note: the sequence {} repeats; consider a script for it", seq.join(" → ")));
        }
        Some(out.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn records_every_kind_of_turn_and_keeps_the_last_max() {
        let mut h = new(Spec { kind: "history".into(), name: "h".into(), config: json!({"max": 2}), ..Default::default() }).unwrap();
        assert!(h.prompt().is_none());
        h.on(&Event::Input("q".into()));
        h.on(&Event::Called { tool: "t".into(), args: json!({}), result: "r".into() });
        h.on(&Event::Reply("a".into()));
        assert_eq!(h.prompt().unwrap(), "tool: t({}) -> r\nmodel: a");
        assert_eq!(h.state()["turns"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn repeated_sequences_are_flagged() {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(repeated(&s(&["a", "b", "a", "b", "a", "b"])), Some(s(&["a", "b"])));
        assert_eq!(repeated(&s(&["a", "b", "c"])), None);
    }
}
