//! THE LOOP CHOOSES ITSELF — one cheap call that decides how much turn this
//! message deserves.
//!
//! `stages:` used to be a fixed list in `agent.md`, so every turn walked all of
//! it. An agent declaring `[plan, work, verify]` paid for a brief and a check to
//! answer "hello", and one declaring `[work]` had no plan for a project. Neither
//! is a property of the AGENT; both are properties of the MESSAGE, and the only
//! thing that has read the message by then is the model.
//!
//! So the first stage asks it. Three routes, and they are deliberately the three
//! a person would name:
//!
//! - `answer` — this can be answered from what is already known. No tools, one
//!   call, done. The greeting stops costing a plan.
//! - `react` — this needs a tool: a search, a file, a command. The react loop,
//!   which is what this build has always run.
//! - `project` — this is something to build. Plan first (enhance the request,
//!   pull in the skills that apply), then work, then check, then critique.
//!
//! IT FAILS TOWARDS THE MIDDLE. An unreadable vote, a missing line, a model that
//! answered the question instead of voting — all become `react`, because react
//! is the route that can still reach either outcome: it can answer in prose on
//! the first call, and it can call tools until it is done. Failing to `answer`
//! would strand a request that needed a tool; failing to `project` would bill
//! four calls for a greeting.

use crate::components::{Field, ResponseObject};

pub const STRATEGY: &str = "strategy";

/// Which loop a turn runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Answer,
    React,
    Project,
}

impl Route {
    /// The stages this route walks. `work` is in all three — it is the turn
    /// that talks to the person — and what changes around it is what the route
    /// is FOR.
    pub fn stages(self) -> Vec<String> {
        let names: &[&str] = match self {
            // No tools: `stages::tools_on` reads `answer` and refuses them, so
            // the route is enforced and not merely announced.
            Route::Answer => &[crate::stages::ANSWER],
            Route::React => &[crate::stages::WORK],
            Route::Project => &[
                crate::stages::PLAN,
                crate::stages::WORK,
                crate::stages::VERIFY,
                crate::stages::CRITIQUE,
            ],
        };
        names.iter().map(|s| (*s).to_string()).collect()
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Route::Answer => "answer",
            Route::React => "react",
            Route::Project => "project",
        }
    }
}

/// The label the vote is written under, and the label its reason is written
/// under. Named here because `stages::facts` reads the second one out of the
/// same reply and the two must be read the same way — a model that decorates
/// one label decorates both.
pub const ROUTE: &str = "ROUTE";
pub const WHY: &str = "WHY";

/// The value written on the line labelled `label`, or `None` if no line is.
///
/// THE LABEL IS CLEANED EXACTLY AS THE VALUE IS, which is the whole of this
/// function. The contract asks for two named lines; a small model writes them
/// as a markdown list about as often as it writes them bare, and it emphasises
/// the label because a label looks like a heading. `**ROUTE:** project`,
/// `- ROUTE: answer` and `1. ROUTE: project` were all unreadable while the
/// value alone was being trimmed, and an unreadable vote is a silent `react`.
///
/// It still has to OPEN its line, after a list marker and emphasis come off and
/// after nothing else. Finding the label anywhere would make a sentence about
/// routing into a vote, and the model is asked to explain itself on the line
/// below.
pub(crate) fn labelled<'a>(reply: &'a str, label: &str) -> Option<&'a str> {
    reply.lines().find_map(|line| {
        let (found, value) = unmarked(line).split_once(':')?;
        plain(found).eq_ignore_ascii_case(label).then(|| plain(value))
    })
}

/// A line with its list marker taken off: `-`, `*`, `+`, `1.`, `2)`. A marker
/// counts only when whitespace follows it, which is what stops `**ROUTE**`
/// from being read as a bullet.
fn unmarked(line: &str) -> &str {
    let line = line.trim();
    match line.split_once(char::is_whitespace) {
        Some((head, rest)) if is_marker(head) => rest.trim_start(),
        _ => line,
    }
}

fn is_marker(head: &str) -> bool {
    let numbered = head
        .strip_suffix(['.', ')'])
        .is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()));
    matches!(head, "-" | "*" | "+") || numbered
}

/// Whitespace and the decoration a model puts round a field: emphasis, code
/// spans, quotes, and the full stop it ends a sentence with.
fn plain(text: &str) -> &str {
    text.trim_matches(|c: char| c.is_whitespace() || "*`_\"'.".contains(c))
}

/// THE VOTE, or `None` when the reply did not contain one. The `None` is the
/// point: `route_of` turns it into `react`, and a fallback that looked
/// identical to a vote for `react` made the one decision this stage exists to
/// make unreadable in the log (`stages::facts`).
pub fn vote_in(reply: &str) -> Option<Route> {
    match labelled(reply, ROUTE)?.to_lowercase().as_str() {
        "answer" => Some(Route::Answer),
        "react" => Some(Route::React),
        "project" => Some(Route::Project),
        _ => None,
    }
}

/// The vote, read out of the reply, failing towards the middle route for the
/// reason in this file's header.
pub fn route_of(reply: &str) -> Route {
    vote_in(reply).unwrap_or(Route::React)
}

/// The reply shape the strategy stage demands — THE SHAPE, AND NOT THE
/// CRITERIA.
///
/// The criteria used to be here, as a string literal, while the file a person
/// opens to tune routing — `public/stages/strategy.md` — held one sentence and
/// no criteria at all. So the half that decided the route could not be edited
/// without a rebuild and the half that could be edited changed nothing.
///
/// THEY MOVED TO THE BRIEF, AND IT IS SAFE FOR THEM TO LIVE ONLY THERE. This
/// object reaches a model through exactly one path — `brief::contract` returns
/// it for the `strategy` stage and no other — and `brief::keyed` lists that
/// same stage among the ones that MUST be briefed, so `strategy.md` is loaded
/// or the turn refuses before this constant is ever rendered. One source, no
/// copy to drift; `tests/strategy.rs` holds the test that keeps it that way.
///
/// WHY IT ALSO ASKS FOR `WHY`. A single-token reply from a small model is a
/// guess as often as a decision; one clause of justification is the cheapest
/// available form of "think before answering", and it costs about six tokens.
/// It is also what makes a wrong route debuggable — the vote alone says the
/// machine chose, and the line says what it chose it on.
pub const OBJECT: ResponseObject = ResponseObject {
    about: "Decide how much work this message needs before anything is done about it. \
        The routes, and how to choose between them, are set out in the directive block \
        above.",
    fields: &[
        Field {
            name: ROUTE,
            about: "one word — answer, react, or project",
        },
        Field {
            name: WHY,
            about: "one short clause saying what decided it",
        },
    ],
};

