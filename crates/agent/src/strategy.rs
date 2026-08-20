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

/// The vote, read out of the reply. Only a line whose first word is `ROUTE`
/// counts, and only the three words count as votes — everything else is the
/// middle route, for the reason in this file's header.
pub fn route_of(reply: &str) -> Route {
    let voted = reply
        .lines()
        .filter_map(|line| line.trim().strip_prefix("ROUTE"))
        .filter_map(|rest| rest.trim_start().strip_prefix(':'))
        .map(|word| word.trim().trim_matches(['*', '`', '.', '"']).to_lowercase())
        .next();
    match voted.as_deref() {
        Some("answer") => Route::Answer,
        Some("project") => Route::Project,
        _ => Route::React,
    }
}

/// The reply shape the strategy stage demands.
///
/// WHY IT ALSO ASKS FOR `WHY`. A single-token reply from a small model is a
/// guess as often as a decision; one clause of justification is the cheapest
/// available form of "think before answering", and it costs about six tokens.
/// It is also what makes a wrong route debuggable — the vote alone says the
/// machine chose, and the line says what it chose it on.
pub const OBJECT: ResponseObject = ResponseObject {
    about: "Decide how much work this message needs before anything is done about it. \
        `answer` — you can answer it now from what you already know or from earlier turns. \
        `react` — it needs a tool first: a search, a file, a command, something you must look \
        up. `project` — it is something to build or work through in more than one step, and \
        it is worth planning before starting. When two fit, pick the smaller one.",
    fields: &[
        Field {
            name: "ROUTE",
            about: "one word — answer, react, or project",
        },
        Field {
            name: "WHY",
            about: "one short clause saying what decided it",
        },
    ],
};

