//! # notes
//! Markdown the engine keeps about itself: its goal, its current focus, what it has learnt.
//! Config:
//! - `file`: the markdown file in the engine folder (`goal.md`); boot reads it into state and
//!   writes it back on save, so the file *is* the state.
//! - `mode`: `replace` (default; tool `set_<name> {text}` replaces the text) or `sections`
//!   (tool `learn {section, lesson}` adds `- lesson` under `## section`; refocus lessons go to
//!   `## refocus`).
//! - `hint`: shown when the text is empty (what belongs here).
use crate::core::{read, tool, value, Component, Event, Spec, Tool};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

const DOC: &str = "Markdown notes (goal, focus, learning) backed by a .md file; replace or sectioned (learn tool).";

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Cfg {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    file: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    mode: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    hint: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct St {
    #[serde(default)]
    text: String,
}

pub struct Notes {
    name: String,
    cfg: Cfg,
    st: St,
}

pub fn new(s: Spec) -> Result<Box<dyn Component>, String> {
    let cfg: Cfg = read(&s.config)?;
    if !["", "replace", "sections"].contains(&cfg.mode.as_str()) {
        return Err(format!("mode must be replace or sections, not '{}'", cfg.mode));
    }
    Ok(Box::new(Notes { name: s.name, cfg, st: read(&s.state)? }))
}

/// Add `- lesson` under `## section` (created at the end if missing); same lesson twice is kept once.
pub fn add_lesson(text: &str, section: &str, lesson: &str) -> String {
    let head = format!("## {section}");
    let item = format!("- {}", lesson.trim());
    let mut lines: Vec<String> = text.lines().map(String::from).collect();
    match lines.iter().position(|l| l.trim() == head) {
        Some(at) => {
            let end = lines[at + 1..].iter().position(|l| l.starts_with("## ")).map_or(lines.len(), |e| at + 1 + e);
            if lines[at + 1..end].iter().any(|l| l.trim() == item) {
                return text.into();
            }
            let mut ins = end;
            while ins > at + 1 && lines[ins - 1].trim().is_empty() {
                ins -= 1;
            }
            lines.insert(ins, item);
        }
        None => {
            while lines.last().is_some_and(|l| l.trim().is_empty()) {
                lines.pop();
            }
            if !lines.is_empty() {
                lines.push(String::new());
            }
            lines.push(head);
            lines.push(item);
        }
    }
    lines.join("\n") + "\n"
}

impl Notes {
    fn sections(&self) -> bool {
        self.cfg.mode == "sections"
    }
    fn setter(&self) -> String {
        format!("set_{}", self.name)
    }
}

impl Component for Notes {
    fn kind(&self) -> &'static str { "notes" }
    fn name(&self) -> &str { &self.name }
    fn doc(&self) -> &'static str { DOC }
    fn config(&self) -> Value { value(&self.cfg) }
    fn state(&self) -> Value { value(&self.st) }
    fn view(&self) -> crate::compose::Node {
        let lines: Vec<String> = self.st.text.lines().filter(|l| !l.trim().is_empty()).map(String::from).collect();
        super::tile(&self.name, if self.cfg.file.is_empty() { "notes" } else { &self.cfg.file }, if lines.is_empty() { vec![self.cfg.hint.clone()] } else { lines })
    }
    fn on(&mut self, ev: &Event) {
        match ev {
            Event::Called { tool, args, result } if !result.starts_with("error") => {
                if self.sections() && tool == "learn" {
                    self.st.text = add_lesson(&self.st.text, args["section"].as_str().unwrap_or("general"), args["lesson"].as_str().unwrap_or_default());
                } else if !self.sections() && *tool == self.setter() {
                    self.st.text = args["text"].as_str().unwrap_or_default().trim().to_string() + "\n";
                }
            }
            Event::Folded(summary) if self.sections() && !summary.trim().is_empty() => {
                self.st.text = add_lesson(&self.st.text, "refocus", &summary.split_whitespace().collect::<Vec<_>>().join(" "));
            }
            _ => {}
        }
    }
    fn prompt(&self) -> Option<String> {
        let t = self.st.text.trim();
        match (t.is_empty(), self.cfg.hint.is_empty()) {
            (false, _) => Some(t.into()),
            (true, false) => Some(format!("(empty: {})", self.cfg.hint)),
            (true, true) => None,
        }
    }
    fn tools(&self) -> Vec<Arc<dyn Tool>> {
        if self.sections() {
            return vec![tool("learn", "record a lesson under a section of learning", json!({"section": "topic", "lesson": "one line"}), |a| {
                match (a["section"].as_str(), a["lesson"].as_str()) {
                    (Some(s), Some(l)) if !s.trim().is_empty() && !l.trim().is_empty() => Ok(json!(format!("learnt under {s}"))),
                    _ => Err("section and lesson required".into()),
                }
            })];
        }
        let name = self.name.clone();
        vec![tool(&self.setter(), &format!("replace the {name} text (markdown)"), json!({"text": "markdown"}), move |a| {
            a["text"].as_str().filter(|t| !t.trim().is_empty()).map(|_| json!(format!("{name} updated"))).ok_or_else(|| "text missing".into())
        })]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notes(name: &str, mode: &str, text: &str) -> Box<dyn Component> {
        new(Spec { kind: "notes".into(), name: name.into(), config: json!({"mode": mode, "hint": "what to aim for"}), state: json!({"text": text}) }).unwrap()
    }

    #[test]
    fn replace_mode_sets_the_text_and_hints_when_empty() {
        let mut g = notes("goal", "replace", "");
        assert_eq!(g.prompt().unwrap(), "(empty: what to aim for)");
        assert_eq!(g.tools()[0].name(), "set_goal");
        g.on(&Event::Called { tool: "set_goal".into(), args: json!({"text": "Ship v2"}), result: "goal updated".into() });
        assert_eq!(crate::core::build(g.spec()).unwrap().prompt().unwrap(), "Ship v2");
        g.on(&Event::Called { tool: "set_goal".into(), args: json!({"text": "x"}), result: "error: no".into() });
        assert_eq!(g.prompt().unwrap(), "Ship v2");
    }

    #[test]
    fn sections_mode_files_lessons_under_headings_and_keeps_refocus_lessons() {
        let mut l = notes("learning", "sections", "## rust\n- clone less\n\n## ui\n- one colour per kind\n");
        l.on(&Event::Called { tool: "learn".into(), args: json!({"section": "rust", "lesson": "tests first"}), result: "ok".into() });
        l.on(&Event::Called { tool: "learn".into(), args: json!({"section": "rust", "lesson": "tests first"}), result: "ok".into() });
        l.on(&Event::Called { tool: "learn".into(), args: json!({"section": "shell", "lesson": "spawn long jobs"}), result: "ok".into() });
        l.on(&Event::Folded("add works\nsub fails".into()));
        assert_eq!(
            l.prompt().unwrap(),
            "## rust\n- clone less\n- tests first\n\n## ui\n- one colour per kind\n\n## shell\n- spawn long jobs\n\n## refocus\n- add works sub fails"
        );
        assert!(l.tools()[0].name() == "learn");
    }
}
