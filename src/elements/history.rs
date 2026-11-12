//! # history
//! A short log, so the prompt stays nearly the same size: the last `max` (default 25) user inputs
//! and model replies, plus the tool calls of the latest step only. Those results are shown once:
//! the next reply removes them (anything worth keeping goes in notes). A refocus summary stays at
//! the top. It also notices repeated call sequences and suggests a script (shortcut).
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
    /// Tool names called so far (for the repeated-sequence hint), last 40.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    calls: Vec<String>,
    /// The run log the card shows: last 12 calls with their parameters and (trimmed) results.
    /// Kept across replies, unlike tool turns.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    log: Vec<Call>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Call {
    pub call: String,
    pub result: String,
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

/// A result without JSON wrapping: strings unquoted, objects as `key: value` pairs (empty ones
/// dropped), anything else as is.
pub fn plain(result: &str) -> String {
    match serde_json::from_str::<Value>(result.trim()) {
        Ok(Value::String(s)) => s,
        Ok(Value::Object(m)) => m
            .iter()
            .filter(|(_, v)| !matches!(v, Value::Null) && v.as_str() != Some("") && v.as_array().map_or(true, |a| !a.is_empty()))
            .map(|(k, v)| format!("{k}: {}", v.as_str().map(String::from).unwrap_or_else(|| v.to_string())))
            .collect::<Vec<_>>()
            .join(", "),
        _ => result.trim().into(),
    }
}

impl History {
    fn push(&mut self, role: &str, text: String, tool: &str) {
        self.st.turns.push(Turn { role: role.into(), text, tool: tool.into() });
    }
    fn max(&self) -> usize {
        if self.cfg.max == 0 { 25 } else { self.cfg.max }
    }
    /// Keep the summary, the last `max` user/model turns, and the latest tool results.
    fn trim(&mut self) {
        let max = self.max();
        let talk = self.st.turns.iter().filter(|t| t.role == "user" || t.role == "model").count();
        let mut drop = talk.saturating_sub(max);
        self.st.turns.retain(|t| {
            if drop > 0 && (t.role == "user" || t.role == "model") {
                drop -= 1;
                return false;
            }
            true
        });
    }
}

impl Component for History {
    fn kind(&self) -> &'static str { "history" }
    fn category(&self) -> &'static str { "prompt" }
    fn icon(&self) -> &'static str { "history" }
    fn slot(&self) -> crate::core::Slot { crate::core::Slot::Conversation }
    fn log(&self) -> Vec<(String, String)> { self.st.log.iter().map(|c| (c.call.clone(), c.result.clone())).collect() }
    fn summary(&self) -> Option<String> { self.st.turns.iter().find(|t| t.role == "summary").map(|t| t.text.clone()) }
    fn transcript(&self) -> Vec<(String, String)> { self.st.turns.iter().map(|t| (t.role.clone(), t.text.clone())).collect() }
    fn name(&self) -> &str { &self.name }
    fn doc(&self) -> &'static str { DOC }
    fn config(&self) -> Value { value(&self.cfg) }
    fn state(&self) -> Value { value(&self.st) }
    fn view(&self) -> crate::core::node::Node {
        let n = self.st.turns.len();
        let last = self.st.turns.iter().rev().take(3).rev().map(|t| format!("{}: {}", t.role, t.text.chars().take(80).collect::<String>()));
        super::tile(&self.name, "history", std::iter::once(format!("{n} turns")).chain(last))
    }
    fn on(&mut self, ev: &Event) {
        match ev {
            Event::Input(t) => self.push("user", t.clone(), ""),
            Event::Reply(t) => {
                // The previous step's results were seen; drop them.
                self.st.turns.retain(|t| t.role != "tool");
                self.push("model", t.clone(), "");
            }
            Event::Called { tool, args, result } => {
                self.push("tool", format!("{} → {}", crate::core::tool::call_sig(tool, args), plain(result)), tool);
                self.st.calls.push(tool.clone());
                let n = self.st.calls.len().saturating_sub(40);
                self.st.calls.drain(..n);
                let r = plain(result);
                let result = if r.chars().count() > 240 { format!("{}…", r.chars().take(240).collect::<String>()) } else { r };
                self.st.log.push(Call { call: crate::core::tool::call_sig(tool, args), result });
                let n = self.st.log.len().saturating_sub(12);
                self.st.log.drain(..n);
            }
            Event::Cleared => self.st = St::default(),
            Event::Rewound(n) => {
                if let Some(at) = self.st.turns.iter().enumerate().filter(|(_, t)| t.role == "user").nth(*n).map(|(i, _)| i) {
                    self.st.turns.truncate(at);
                }
            }
            Event::Folded(summary) => {
                let keep = self.st.turns.len().saturating_sub(4);
                let rest: Vec<Turn> = self.st.turns.split_off(keep).into_iter().filter(|t| t.role != "summary").collect();
                self.st.turns = vec![Turn { role: "summary".into(), text: summary.clone(), tool: String::new() }];
                self.st.turns.extend(rest);
            }
            _ => {}
        }
        self.trim();
    }
    fn prompt(&self) -> Option<String> {
        if self.st.turns.is_empty() {
            return None;
        }
        // Tool results read like the calls that made them: `read_file(path: "a") → text`.
        // Model turns are their own fields (`plan:`, `act:`, `answer:`): no role label needed.
        let mut out: Vec<String> = self.st.turns.iter().map(|t| if t.role == "tool" || t.role == "model" { t.text.clone() } else { format!("{}: {}", t.role, t.text) }).collect();
        if let Some(seq) = repeated(&self.st.calls) {
            out.push(format!("note: the sequence {} repeats; consider a script for it", seq.join(" → ")));
        }
        Some(out.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn call(t: &str) -> Event {
        Event::Called { tool: t.into(), args: json!({}), result: "r".into() }
    }

    #[test]
    fn tool_results_are_shown_once_then_dropped_by_the_next_reply() {
        let mut h = new(Spec { kind: "history".into(), name: "h".into(), ..Default::default() }).unwrap();
        assert!(h.prompt().is_none());
        h.on(&Event::Input("q".into()));
        h.on(&Event::Reply("call t".into()));
        h.on(&call("t"));
        assert_eq!(h.prompt().unwrap(), "user: q\ncall t\nt() → r");
        h.on(&Event::Called { tool: "read_file".into(), args: json!({"path": "a.rs"}), result: "fn main".into() });
        assert!(h.prompt().unwrap().ends_with("read_file(path: \"a.rs\") → fn main"));
        h.on(&Event::Reply("done".into()));
        assert_eq!(h.prompt().unwrap(), "user: q\ncall t\ndone");
        let log = h.state()["log"].as_array().unwrap().clone();
        assert_eq!(log.last().unwrap()["result"], "fn main", "the run log outlives the reply");
        assert!(log.last().unwrap()["call"].as_str().unwrap().contains("a.rs"), "the call keeps its parameters");
    }

    #[test]
    fn results_lose_their_json_wrapping() {
        assert_eq!(plain(r#"{"code":0,"stdout":"hi","stderr":""}"#), "code: 0, stdout: hi");
        assert_eq!(plain(r#""remembered k""#), "remembered k");
        assert_eq!(plain("5.0"), "5.0");
        assert_eq!(plain("plain text"), "plain text");
    }

    #[test]
    fn clearing_forgets_every_turn() {
        let mut h = new(Spec { kind: "history".into(), name: "h".into(), ..Default::default() }).unwrap();
        h.on(&Event::Input("q".into()));
        h.on(&call("t"));
        h.on(&Event::Cleared);
        assert!(h.prompt().is_none());
        assert_eq!(h.state(), serde_json::to_value(St::default()).unwrap());
    }

    #[test]
    fn the_log_keeps_the_last_max_inputs_and_replies_and_the_summary() {
        let mut h = new(Spec { kind: "history".into(), name: "h".into(), config: json!({"max": 3}), ..Default::default() }).unwrap();
        for i in 0..5 {
            h.on(&Event::Input(format!("q{i}")));
        }
        h.on(&Event::Folded("sum".into()));
        for i in 5..10 {
            h.on(&Event::Input(format!("q{i}")));
        }
        assert_eq!(h.prompt().unwrap(), "summary: sum\nuser: q7\nuser: q8\nuser: q9");
        for t in ["a", "b", "a", "b", "a", "b"] {
            h.on(&call(t));
            h.on(&Event::Reply("x".into()));
        }
        assert!(h.prompt().unwrap().ends_with("consider a script for it"), "repeats are remembered after results are dropped");
        assert!(h.state()["turns"].as_array().unwrap().len() <= 4);
    }

    #[test]
    fn repeated_sequences_are_flagged() {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(repeated(&s(&["a", "b", "a", "b", "a", "b"])), Some(s(&["a", "b"])));
        assert_eq!(repeated(&s(&["a", "b", "c"])), None);
    }
}
