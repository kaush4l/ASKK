//! # Boxes: every session as one object
//!
//! On the screen there is one kind of thing: a box. A box is a session, something that runs
//! and can be looked at and spoken to (`docs/concept.md`). What differs between boxes is how
//! deep askk can see into them, and that depends on what is known about them:
//!
//! | [`Depth`] | askk knows | because |
//! | --- | --- | --- |
//! | `Screen` | that it runs, and its screen | the service holds its terminal (not built yet) |
//! | `Recognised` | which agent it is, and a guess at its state | its process and its screen (not built yet) |
//! | `Reported` | each turn and its state, as the agent says them | a harness ([`super::session`]) |
//! | `Spec` | its goal, its learnings, its tools, every stage of every run | askk built it: an engine |
//!
//! Every UI draws a [`SessionBox`] and nothing else, so this file is the one place that says
//! what an engine or a session is as a box: its state, its depth, its last line, its facts.
//! "Done and not yet looked at" is not here: that is a window's own knowledge, not the
//! service's (`ui/features/boxes.rs`).
use super::held::Held;
use super::session::{self, Session};
use super::Engine;
use serde::{Deserialize, Serialize};

/// How deep askk can see into a box. Later ones know everything the earlier ones do.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Depth {
    Screen,
    Recognised,
    Reported,
    #[default]
    Spec,
}

/// What a box is doing, in the same words at every depth.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    /// It is doing something.
    Working,
    /// It waits for the owner.
    Blocked,
    /// The last thing did not work; a fact named `error` says why.
    Failed,
    /// Finished, or waiting to be spoken to.
    Idle,
    /// askk cannot tell.
    #[default]
    Unknown,
}

/// One thing known about a box, as a label and its words (`goal`, `tools`, `turns`...).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Fact {
    pub label: String,
    pub value: String,
}

fn fact(label: &str, value: impl Into<String>) -> Fact {
    Fact { label: label.into(), value: value.into() }
}

/// A session as every UI is given it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct SessionBox {
    /// Its kind and its own name within that kind: `engine:askk/coder`, `session:12`.
    pub id: String,
    /// `engine`, or the harness a session is with (`claude`, `codex`...).
    pub kind: String,
    pub depth: Depth,
    pub state: State,
    pub title: String,
    /// An emoji or an icon's name; empty = the kind's own.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub icon: String,
    /// What groups it with others: an engine's parent, a session's project folder.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub place: String,
    /// One line: what it is doing now, or the last thing it said.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub last: String,
    /// What its depth lets askk say about it, in the order a person reads it.
    #[serde(default)]
    pub facts: Vec<Fact>,
}

/// The parts of an engine's spec, by the names its elements carry in the defaults.
pub const GOAL: &str = "goal";
pub const LEARNING: &str = "learning";
pub const ASKS: &str = "asks";

/// The longest `last` line and fact a box carries; the rest is the box's own page to show.
const LINE: usize = 160;

/// The first line of `text` that says something, without a heading's marks, cut to [`LINE`].
pub fn first_line(text: &str) -> String {
    let line = text.lines().map(|l| l.trim().trim_start_matches('#').trim()).find(|l| !l.is_empty()).unwrap_or_default();
    if line.chars().count() <= LINE {
        return line.to_string();
    }
    let cut: String = line.chars().take(LINE - 1).collect();
    format!("{}…", cut.trim_end())
}

/// What `text` is about in one line: its first line that is not a heading, else its heading.
pub fn gist(text: &str) -> String {
    let body = text.lines().find(|l| !l.trim().is_empty() && !l.trim_start().starts_with('#')).unwrap_or_default();
    first_line(if body.is_empty() { text } else { body })
}

/// How many lines of `text` say something.
fn said(text: &str) -> usize {
    text.lines().filter(|l| !l.trim().is_empty()).count()
}

/// What an engine is, as plain values (so that what follows needs no running engine).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EngineParts {
    pub path: String,
    pub name: String,
    pub icon: String,
    /// `thinking`, `calling`... and what about (`core/engine.rs`, `activity`).
    pub activity: (String, String),
    /// The engine's own word for how its last run ended (`idle`, `error: ...`, `interrupted`).
    pub status: String,
    /// Its latest summary, or its description.
    pub summary: String,
    pub goal: String,
    pub learning: String,
    pub asks: String,
    pub tools: Vec<String>,
}

/// An engine as a box. It is the deepest kind: askk built it, so its goal, what it learnt and
/// its tools are all known.
pub fn engine_box(p: &EngineParts) -> SessionBox {
    let working = super::engine::working(&p.activity.0);
    let asks = said(&p.asks);
    let failed = p.status.starts_with("error") || p.status == "interrupted";
    let state = match () {
        _ if working => State::Working,
        _ if asks > 0 => State::Blocked,
        _ if failed => State::Failed,
        _ => State::Idle,
    };
    let last = match state {
        State::Working => format!("{} {}", p.activity.0, p.activity.1).trim().to_string(),
        State::Blocked => first_line(&p.asks),
        _ => first_line(&p.summary),
    };
    let mut facts = vec![];
    if state == State::Failed {
        facts.push(fact("error", first_line(&p.status)));
    }
    if asks > 0 {
        facts.push(fact("asks", format!("{asks} for you")));
    }
    if !p.goal.trim().is_empty() {
        facts.push(fact("goal", gist(&p.goal)));
    }
    facts.push(fact("learnings", said(&p.learning).to_string()));
    facts.push(fact(super::TOOLBOX, if p.tools.is_empty() { "none".to_string() } else { p.tools.join(", ") }));
    SessionBox {
        id: format!("engine:{}", p.path),
        kind: "engine".into(),
        depth: Depth::Spec,
        state,
        title: p.name.clone(),
        icon: p.icon.clone(),
        place: p.path.rsplit_once('/').map(|(parent, _)| parent.to_string()).unwrap_or_default(),
        last,
        facts,
    }
}

/// Read a running engine's parts.
pub fn parts(e: &Engine) -> EngineParts {
    let file = e.file.held().clone();
    let text = |name: &str| {
        let els = e.elements.held();
        els.iter().find(|el| el.name() == name).and_then(|el| el.state().get("text").and_then(|t| t.as_str()).map(String::from)).unwrap_or_default()
    };
    let summary = super::engine::summary(&e.elements.held(), &file.description);
    let mut tools = e.toolbox().names();
    tools.sort();
    EngineParts { path: e.path.clone(), name: file.name, icon: file.icon, activity: e.activity(), status: file.status, summary, goal: text(GOAL), learning: text(LEARNING), asks: text(ASKS), tools }
}

/// A session with another agent's own loop, as a box: askk knows what the harness reports.
pub fn session_box(s: &Session) -> SessionBox {
    let state = match s.state {
        session::State::Busy => State::Working,
        session::State::Failed => State::Failed,
        session::State::Idle => State::Idle,
    };
    let mut facts = vec![];
    if state == State::Failed && !s.error.is_empty() {
        facts.push(fact("error", first_line(&s.error)));
    }
    facts.push(fact("turns", s.turns.len().to_string()));
    facts.push(fact("after a restart", if s.native.is_some() { "goes on where it was" } else { "starts anew: the agent gave no id yet" }));
    SessionBox {
        id: format!("session:{}", s.id),
        kind: s.harness.clone(),
        depth: Depth::Reported,
        state,
        title: s.title.clone(),
        icon: String::new(),
        place: s.project.clone(),
        last: s.turns.last().map(|t| first_line(&t.text)).unwrap_or_default(),
        facts,
    }
}

/// Every box there is: the engines depth first, then the sessions oldest first.
pub fn all() -> Vec<SessionBox> {
    fn walk(e: &Engine, out: &mut Vec<SessionBox>) {
        out.push(engine_box(&parts(e)));
        e.subs().iter().for_each(|s| walk(s, out));
    }
    let mut out = vec![];
    super::world::world().engines.iter().for_each(|e| walk(e, &mut out));
    let store = super::store::data();
    out.extend(session::list(&*store, &super::manifest::manifest().sessions).iter().map(session_box));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::session::Turn;

    fn engine() -> EngineParts {
        EngineParts { path: "askk/coder".into(), name: "coder".into(), summary: "Adds numbers".into(), goal: "# Goal\n\nWrite a program and run it.\n".into(), learning: "## js\n- reduce sums\n".into(), tools: vec!["now".into(), "run_code".into()], status: "idle".into(), ..Default::default() }
    }

    #[test]
    fn an_engine_is_the_deepest_box_and_says_its_goal_learnings_and_tools() {
        let b = engine_box(&engine());
        assert_eq!((b.id.as_str(), b.kind.as_str(), b.depth, b.state), ("engine:askk/coder", "engine", Depth::Spec, State::Idle));
        assert_eq!((b.place.as_str(), b.last.as_str()), ("askk", "Adds numbers"));
        let said: Vec<(&str, &str)> = b.facts.iter().map(|f| (f.label.as_str(), f.value.as_str())).collect();
        assert_eq!(said, [("goal", "Write a program and run it."), ("learnings", "2"), ("tools", "now, run_code")]);
    }

    #[test]
    fn an_engine_at_work_is_working_one_with_a_question_is_blocked_one_that_broke_is_failed() {
        let mut p = engine();
        p.asks = "which folder?\n".into();
        let b = engine_box(&p);
        assert_eq!((b.state, b.last.as_str()), (State::Blocked, "which folder?"), "a question for the owner blocks it");
        assert_eq!(b.facts[0], fact("asks", "1 for you"));
        p.activity = ("calling".into(), "run_code".into());
        let b = engine_box(&p);
        assert_eq!((b.state, b.last.as_str()), (State::Working, "calling run_code"), "work in hand is said first");
        let mut p = engine();
        p.status = "error: the model gave no answer".into();
        let b = engine_box(&p);
        assert_eq!((b.state, b.facts[0].clone()), (State::Failed, fact("error", "error: the model gave no answer")));
        p.status = "interrupted".into();
        assert_eq!(engine_box(&p).state, State::Failed, "cut off by a restart is not idle");
    }

    #[test]
    fn a_session_is_as_deep_as_its_harness_reports() {
        let turn = |who: &str, text: &str| Turn { who: who.into(), text: text.into() };
        let mut s = Session { id: 12, harness: "claude".into(), title: "fix the build".into(), project: "askk".into(), turns: vec![turn("user", "fix it"), turn("agent", "Done.\nTwo files changed.")], ..Default::default() };
        let b = session_box(&s);
        assert_eq!((b.id.as_str(), b.kind.as_str(), b.depth, b.state), ("session:12", "claude", Depth::Reported, State::Idle));
        assert_eq!((b.place.as_str(), b.last.as_str()), ("askk", "Done."));
        assert_eq!(b.facts, [fact("turns", "2"), fact("after a restart", "starts anew: the agent gave no id yet")]);
        s.native = Some("abc".into());
        s.state = session::State::Failed;
        s.error = "claude is not installed".into();
        let b = session_box(&s);
        assert_eq!((b.state, b.facts[0].clone()), (State::Failed, fact("error", "claude is not installed")));
        assert_eq!(b.facts[2].value, "goes on where it was");
        s.state = session::State::Busy;
        assert_eq!(session_box(&s).state, State::Working);
    }

    #[test]
    fn a_long_line_is_cut_on_a_letter_not_inside_one() {
        let long = "é".repeat(400);
        let cut = first_line(&long);
        assert_eq!(cut.chars().count(), LINE);
        assert!(cut.ends_with('…'));
        assert_eq!(first_line("\n\n## Heading \nrest"), "Heading");
        assert_eq!((gist("# Goal\n\nDo it well.\n"), gist("# Only a heading\n")), ("Do it well.".to_string(), "Only a heading".to_string()));
        assert!(Depth::Screen < Depth::Recognised && Depth::Reported < Depth::Spec, "a later depth knows more");
    }
}
