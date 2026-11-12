//! # Run: how a run of an engine's loop reads
//!
//! The loop keeps a record of each run ([`crate::core::run::Run`]): its steps, the stages of
//! each step, the tools a stage called. This file says how a person reads that record, once,
//! for every UI: the one line a run comes down to, a tone for how it stands, each stage's head
//! line, each tool call as the program and what came back, and what an engine at work is
//! doing. A page draws these as rows that open; the terminal writes them as lines.
// The tab's own page shows a run as plain lines (`talk::stages`) and uses none of this yet.
#![cfg_attr(feature = "local", allow(dead_code))]
use crate::core::flow::{about, name, Stage};
use crate::core::run::{took, Mark, Run};

/// How a run's state feels, for a UI to colour in its own way (a dot, a word, a mark).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tone {
    /// At work now.
    Busy,
    /// Ended with an answer.
    Ok,
    /// Ended without one (stopped, out of steps, interrupted).
    Warn,
    /// Ended with an error.
    Error,
}

impl Tone {
    /// The tone as one lowercase word (a class name, a label).
    pub fn name(self) -> &'static str {
        match self {
            Tone::Busy => "busy",
            Tone::Ok => "ok",
            Tone::Warn => "warn",
            Tone::Error => "error",
        }
    }
}

/// The tone of a run's status.
pub fn tone(status: &str) -> Tone {
    match status {
        "running" => Tone::Busy,
        "done" => Tone::Ok,
        "error" => Tone::Error,
        _ => Tone::Warn,
    }
}

/// `1 step`, `3 steps`.
fn count(n: usize, one: &str) -> String {
    format!("{n} {one}{}", if n == 1 { "" } else { "s" })
}

/// How many tools a run called, read from the one line each `act` stage wrote.
pub fn calls_made(run: &Run) -> usize {
    run.steps.iter().flat_map(|s| &s.marks).filter(|m| m.stage == Stage::Act).filter_map(|m| m.note.split(' ').next()?.parse::<usize>().ok()).sum()
}

/// A run in one line: where it is while it works, or how it ended and how long it took.
pub fn headline(run: &Run) -> String {
    let steps = run.steps.len();
    if run.running() {
        let stage = run.stage().map(name).unwrap_or("starting");
        return format!("Working · step {} · {stage}", steps.max(1));
    }
    let calls = calls_made(run);
    let made = if calls == 0 { String::new() } else { format!(" · {}", count(calls, "call")) };
    match tone(&run.status) {
        Tone::Ok => format!("Worked for {} · {}{made}", took(run.ms), count(steps, "step")),
        Tone::Error => format!("Failed after {} · {}{made}", took(run.ms), count(steps, "step")),
        _ => format!("Ended ({}) after {} · {}{made}", run.status, took(run.ms), count(steps, "step")),
    }
}

/// What an engine is doing, in a few words: its activity and what the activity is on, or
/// `ready` when it waits to be asked.
pub fn doing(activity: &str, detail: &str) -> String {
    match (activity, detail) {
        ("", _) | ("idle", _) => "ready".to_string(),
        (a, "") => a.to_string(),
        (a, d) => format!("{a} · {d}"),
    }
}

/// Whether an activity means the engine is at work (so a UI offers Stop and shows it working).
pub fn at_work(activity: &str) -> bool {
    !matches!(activity, "" | "idle" | "error" | "stopped")
}

/// One stage as its head line: the stage's name, what it did, how long it took (`…` while it
/// is still open).
pub fn stage_head(m: &Mark) -> (&'static str, String, String) {
    (name(m.stage), m.note.clone(), if m.ms == 0 { "…".into() } else { took(m.ms) })
}

/// What a stage is for, in one sentence.
pub fn stage_about(m: &Mark) -> &'static str {
    about(m.stage)
}

/// One tool call a stage made: the tool, what it was given (for `run_code`, the program), and
/// what came back.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Call {
    pub tool: String,
    /// The arguments as written: `code: "…", language: "js"`.
    pub given: String,
    pub result: String,
    pub failed: bool,
}

impl Call {
    /// The call the way a reply writes it: `run_code(code: "…")`.
    pub fn written(&self) -> String {
        format!("{}({})", self.tool, self.given)
    }

    /// The result's first line, cut to a width a row can show.
    pub fn glance(&self, most: usize) -> String {
        let first = self.result.lines().next().unwrap_or_default();
        if first.chars().count() > most { format!("{}…", first.chars().take(most).collect::<String>()) } else { first.to_string() }
    }
}

/// The tool calls a stage made (only the `act` stage makes any), in the order they finished.
pub fn calls(m: &Mark) -> Vec<Call> {
    if m.stage != Stage::Act {
        return vec![];
    }
    m.detail
        .iter()
        .map(|(sig, result)| {
            let (tool, rest) = sig.split_once('(').unwrap_or((sig.as_str(), ""));
            Call { tool: tool.to_string(), given: rest.strip_suffix(')').unwrap_or(rest).to_string(), result: result.clone(), failed: result.starts_with("error") }
        })
        .collect()
}

/// The texts a stage kept that are not tool calls, each `(label, text, about how many tokens)`.
pub fn kept(m: &Mark) -> Vec<(String, String, usize)> {
    if m.stage == Stage::Act {
        return vec![];
    }
    m.detail.iter().map(|(label, text)| (label.clone(), text.clone(), crate::core::tokens(text))).collect()
}

/// Who said a turn, as a person reads it: `you` for the person, else the name given.
pub fn who(from: &str) -> &str {
    if from == "user" { "you" } else { from }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::run::Step;

    #[test]
    fn a_run_reads_as_one_headline_and_its_calls_as_program_and_result() {
        let act = Mark { stage: Stage::Act, note: "1 call(s) ran".into(), ms: 7, detail: vec![("run_code(code: \"2+2\", language: \"js\")".into(), "{\"result\":4}".into())] };
        let think = Mark { stage: Stage::Think, note: "asked m".into(), ms: 0, detail: vec![("reply".into(), "answer: 4".into())] };
        let mut run = Run { steps: vec![Step { n: 1, marks: vec![think.clone(), act.clone()] }], status: "running".into(), ..Default::default() };
        assert_eq!(headline(&run), "Working · step 1 · act");
        run.status = "done".into();
        run.ms = 3200;
        assert_eq!(headline(&run), "Worked for 3.2s · 1 step · 1 call");
        run.status = "out of steps".into();
        assert_eq!(headline(&run), "Ended (out of steps) after 3.2s · 1 step · 1 call");
        let c = calls(&act);
        assert_eq!((c[0].tool.as_str(), c[0].given.as_str(), c[0].result.as_str(), c[0].failed), ("run_code", "code: \"2+2\", language: \"js\"", "{\"result\":4}", false));
        assert_eq!(c[0].written(), "run_code(code: \"2+2\", language: \"js\")");
        assert_eq!(c[0].glance(6), "{\"resu…");
        assert!(calls(&think).is_empty() && kept(&act).is_empty());
        assert_eq!(kept(&think), vec![("reply".to_string(), "answer: 4".to_string(), 3)]);
        assert_eq!(stage_head(&think), ("think", "asked m".to_string(), "…".to_string()));
        assert_eq!([tone("running"), tone("done"), tone("error"), tone("stopped")], [Tone::Busy, Tone::Ok, Tone::Error, Tone::Warn]);
        assert_eq!((doing("calling", "run_code"), doing("idle", "x"), at_work("thinking"), at_work("idle")), ("calling · run_code".to_string(), "ready".to_string(), true, false));
        assert_eq!((who("user"), who("askk")), ("you", "askk"));
    }
}
