//! THE LOOP CHOOSES ITSELF — one cheap call that decides how much turn this
//! message deserves.
//!
//! `stages:` used to be a fixed list in `agent.md`, so every turn walked all of
//! it: `[plan, work, verify]` paid for a brief and a check to answer "hello",
//! and `[work]` had no plan for a project. Neither is a property of the AGENT;
//! both are properties of the MESSAGE, and the only thing that has read the
//! message by then is the model.
//!
//! So the first stage asks it. Three routes — `answer`, `react`, `project` —
//! and WHAT DISTINGUISHES THEM IS NOT WRITTEN HERE. It is in
//! `public/stages/strategy.md`, the file a person edits to tune routing without
//! a rebuild; restating it in this header would be the second copy that drifts.
//! [`Route::stages`] below says what each route COSTS, which is this file's
//! half of the answer.
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
    /// that talks to the person — and what changes around it is the route.
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

    /// The route one WORD names, `None` for a word this build does not know —
    /// `as_str` read backwards, and the only place in the tree that turns a
    /// route word into a route.
    ///
    /// IT DELIBERATELY DOES NOT FALL TO `React`, WHICH IS WHY IT IS SEPARATE
    /// FROM `route_of`. A VOTE fails towards the middle because a turn has to
    /// run (this file's header). A PROJECTION has no such duty: a surface
    /// handed `quest` would draw `work` and say the turn is doing one thing
    /// while it does another. So the fallback stays in `route_of`, and every
    /// reader merely LOOKING at a recorded route gets the honest `None`.
    pub fn named(word: &str) -> Option<Route> {
        match word {
            "answer" => Some(Route::Answer),
            "react" => Some(Route::React),
            "project" => Some(Route::Project),
            _ => None,
        }
    }
}

/// The label the vote is written under, and the one its reason is. Named here
/// because `stages::facts` reads the second out of the same reply and the two
/// must be read the same way — a model decorating one label decorates both.
pub const ROUTE: &str = "ROUTE";
pub const WHY: &str = "WHY";

/// The value written on the line labelled `label`, or `None` if no line is.
///
/// THE LABEL IS CLEANED EXACTLY AS THE VALUE IS, which is the whole of this
/// function: a small model writes the two named lines as markdown about as
/// often as it writes them bare, and `**ROUTE:** project` was unreadable while
/// only the value was being trimmed. It still has to OPEN its line, after
/// [`unmarked`]'s block prefixes and [`plain`]'s decoration and after nothing
/// else — finding the label anywhere would make a sentence about routing into
/// a vote, and the model is asked to explain itself on the line below.
pub(crate) fn labelled<'a>(reply: &'a str, label: &str) -> Option<&'a str> {
    reply.lines().find_map(|line| {
        let (found, value) = unmarked(line).split_once(':')?;
        plain(found).eq_ignore_ascii_case(label).then(|| plain(value))
    })
}

/// A line with every MARKDOWN BLOCK PREFIX taken off it, so that what remains
/// either opens with the label or is not a vote.
///
/// **THE GRAMMAR, STATED AND CLOSED (2026-08-23).** IN: the prefixes CommonMark
/// defines and no others — a bullet (`-`, `*`, `+`), an ordered marker (`1.`,
/// `2)`), an ATX heading (`#` … `######`), a blockquote (`>`), and indentation,
/// which `trim` already ate. They NEST, so this strips them in written order:
/// `> - ROUTE: answer` is one quoted bullet.
///
/// THE CLOSED SET IS THE WHOLE CHANGE. `e27a387` added `**` and `-` to a list;
/// 2026-08-23 then measured `## ROUTE: project` and `> ROUTE: project` still
/// landing silently on `react`. A list that grows one character per surprise
/// never finishes, because the failure is SILENT — an unreadable vote is a
/// `react` indistinguishable from a vote for `react`. Naming the RULE lets the
/// next round argue with the rule instead of adding a sixth character.
///
/// OUT, each a decision and each a named case in `tests/vote_shapes.rs`. A
/// table pipe, a definition-list colon, a footnote bracket: not block prefixes,
/// and two would make the SEPARATOR ambiguous. `>ROUTE:` unspaced, because a
/// marker is only a marker when whitespace follows — the rule that stops
/// `**ROUTE**` being a bullet and `#tag` a heading. `####### `, not a heading in
/// CommonMark either. And anything altering the SEPARATOR (`=`, `->`), the
/// VALUE (a clause, a hedge, a second field) or the LINE (a label mid-sentence).
fn unmarked(line: &str) -> &str {
    let mut line = line.trim();
    while let Some((head, rest)) = line.split_once(char::is_whitespace) {
        if !is_marker(head) {
            break;
        }
        line = rest.trim_start();
    }
    line
}

/// One markdown block prefix — bullet, ordered marker, ATX heading, blockquote.
fn is_marker(head: &str) -> bool {
    let numbered = head
        .strip_suffix(['.', ')'])
        .is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()));
    let heading = (1..=6).contains(&head.len()) && head.bytes().all(|c| c == b'#');
    matches!(head, "-" | "*" | "+" | ">") || numbered || heading
}

/// Whitespace and the INLINE decoration a model puts round a field: emphasis,
/// code spans, quotes, and the full stop it ends a sentence with.
fn plain(text: &str) -> &str {
    text.trim_matches(|c: char| c.is_whitespace() || "*`_\"'.".contains(c))
}

/// THE VOTE, or `None` when the reply did not contain one. The `None` is the
/// point: `route_of` turns it into `react`, and a fallback indistinguishable
/// from a vote FOR `react` made this stage's one decision unreadable in the log.
pub fn vote_in(reply: &str) -> Option<Route> {
    Route::named(&labelled(reply, ROUTE)?.to_lowercase())
}

/// The vote, failing towards the middle route for this file's header's reason.
pub fn route_of(reply: &str) -> Route {
    vote_in(reply).unwrap_or(Route::React)
}

/// The reply shape the strategy stage demands — THE SHAPE, AND NOT THE
/// CRITERIA.
///
/// The criteria used to live here as a string literal while the file a person
/// opens to tune routing — `public/stages/strategy.md` — held one sentence and
/// no criteria at all. THEY MOVED TO THE BRIEF, AND ONLY THERE: this object
/// reaches a model through one path (`brief::contract`, `strategy` and no other
/// stage) and `brief::keyed` makes that brief mandatory, so the turn refuses
/// before this constant renders unbriefed. `tests/strategy.rs` keeps it so.
///
/// THE READING TOLERANCE IS IN NEITHER, deliberately. `unmarked` accepts a
/// markdown heading or blockquote round the label; the brief says nothing about
/// it and must not, because that tolerance exists for a model that FAILED to
/// follow this contract, and printing it would read as permission to.
///
/// WHY IT ALSO ASKS FOR `WHY`. A single-token reply from a small model is a
/// guess as often as a decision; one clause of justification is the cheapest
/// form of "think before answering" and costs about six tokens. It is also what
/// makes a wrong route debuggable — the vote says the machine chose, the line
/// says what it chose on.
pub const OBJECT: ResponseObject = ResponseObject {
    about: "Decide how much work this message needs before anything is done about it. \
        The routes, and how to choose between them, are in the directive block above.",
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

