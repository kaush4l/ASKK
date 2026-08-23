//! THE FLOW, AS DATA. Five attributes `crates/core/src/board/flow.rs` hangs on
//! one board row, read once into one value the rail can draw without knowing
//! where they came from. Nothing here touches the app handle, a reactive value
//! or the DOM — those live one file up, in `mod.rs`, and only there:
//! it is a string and an agent name in, a `Flow` out.
//!
//! THERE IS NO `Route` ENUM HERE, AND THAT IS THE DESIGN (ROADMAP #7). The
//! route is a WORD, kept only to label the flow; the WALK is the authoritative
//! fact and it is never discarded because the word beside it is one this build
//! has not heard of. A fourth route lands as data and costs this crate nothing.
//!
//! I16 RUNS THROUGH EVERY FIELD. `data-walk` is empty before the vote and for a
//! route `agent::Route::named` refuses to name (it returns `Option` with no
//! `React` fallback on purpose), and `data-flow` says whether the blank means
//! "not yet" or "in another Worker's log". Both silences are carried, not
//! filled in — `rail.rs` states them in words rather than drawing a guess.

use crate::board::read_attrs::cell;

/// WHOSE PROCESS HOLDS THESE FACTS — `data-flow`, as the core wrote it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Vantage {
    /// `here`: this page's own log answers. A blank walk means "not yet".
    Here,
    /// `elsewhere`: the agent runs in its own Worker and its vote is in THAT
    /// log. A blank walk here is not a stage of progress at all.
    Elsewhere,
}

/// WHERE THE OPEN TURN IS, relative to one step of its walk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mark {
    Done,
    Here,
    Ahead,
}

impl Mark {
    /// The one word the stylesheet keys off (`web/flow.css`).
    pub(crate) fn word(self) -> &'static str {
        match self {
            Mark::Done => "done",
            Mark::Here => "here",
            Mark::Ahead => "ahead",
        }
    }
}

/// One agent's flow: the route it voted for, the stages that route really
/// walks, which one is open, and the lap clause the core already worded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Flow {
    pub(crate) vantage: Vantage,
    /// `data-route`. Empty before the vote, or for a word this build cannot
    /// name. Used for the badge and for nothing else.
    pub(crate) route: String,
    /// `data-walk`, split on `,`. Empty is a fact, never a default list.
    pub(crate) walk: Vec<String>,
    /// Which step of `walk` `data-stage` names. `None` when no stage is open,
    /// and also when the open stage is not one the walk lists — a fact from an
    /// older route is left unattached rather than snapped onto a step it is not.
    pub(crate) at: Option<usize>,
    /// `data-lap`, VERBATIM. `crates/core/src/board/flow.rs` is the one author
    /// of `pass {n} of up to {of}`; `crates/ui` cannot depend on `core`, so a
    /// second copy of that wording here could never be tested against the
    /// first. Empty on the first lap, and for an agent that cannot lap at all.
    pub(crate) lap: String,
}

impl Flow {
    /// The walk with each step marked. Empty walk in, empty vec out.
    pub(crate) fn steps(&self) -> Vec<(&str, Mark)> {
        self.walk
            .iter()
            .enumerate()
            .map(|(i, name)| {
                let mark = match self.at {
                    Some(at) if i < at => Mark::Done,
                    Some(at) if i == at => Mark::Here,
                    _ => Mark::Ahead,
                };
                (name.as_str(), mark)
            })
            .collect()
    }
}

/// One agent's flow off a `/board` projection already in hand. `read_attrs::cell`
/// is this crate's one reader of a board attribute and this goes through it, so
/// a row that is absent answers the same way everywhere: a `Here` flow with
/// nothing in it, which reads as "nothing has happened", and that is true.
pub(crate) fn of(board: &str, who: &str) -> Flow {
    let at = |name: &str| cell(board, who, name).unwrap_or_default();
    let walk: Vec<String> = at("data-walk")
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();
    let stage = at("data-stage");
    Flow {
        vantage: match at("data-flow").as_str() {
            "elsewhere" => Vantage::Elsewhere,
            _ => Vantage::Here,
        },
        at: walk.iter().position(|s| *s == stage),
        route: at("data-route"),
        walk,
        lap: at("data-lap"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A board row as the core writes it: `data-agent` first, every flow
    /// attribute after it in the same tag (`core::board::flow::hang`).
    fn row(flow: &str, route: &str, walk: &str, stage: &str, lap: &str) -> String {
        format!(
            "<article class=\"agent-row\" data-agent=\"main\" data-flow=\"{flow}\" \
             data-route=\"{route}\" data-walk=\"{walk}\" data-stage=\"{stage}\" \
             data-lap=\"{lap}\"></article>"
        )
    }

    /// THE INCREMENT'S HEADLINE CLAIM. A route word this build has never heard
    /// of still draws its whole walk, because the walk is the fact and the word
    /// is a label. Revert to make RED: match `route` against a closed list in
    /// `of` and blank the walk when it does not hit.
    #[test]
    fn a_fourth_flow_costs_the_frontend_zero_files() {
        let f = of(&row("here", "quest", "scout,build,land", "build", ""), "main");
        assert_eq!(f.route, "quest");
        assert_eq!(
            f.steps(),
            vec![("scout", Mark::Done), ("build", Mark::Here), ("land", Mark::Ahead)]
        );
    }

    /// `Route::named` returns `Option` with no fallback because drawing the
    /// WRONG flow is worse than drawing none (I16). Revert to make RED: give
    /// `walk` a `["work"]` default when the attribute is empty.
    #[test]
    fn an_absent_walk_is_never_filled_in() {
        let f = of(&row("here", "", "", "", ""), "main");
        assert!(f.walk.is_empty() && f.at.is_none() && f.route.is_empty());
        assert_eq!(f.vantage, Vantage::Here);
        // …and so does a row that is not on this board at all.
        assert_eq!(of("<p>no rows</p>", "main").walk, Vec::<String>::new());
    }

    /// A sub-agent's blank is a different fact from a blank before the vote,
    /// and the core states which. Revert to make RED: drop the `elsewhere` arm.
    #[test]
    fn a_sub_agents_row_reports_a_vantage_and_not_a_stage() {
        let f = of(&row("elsewhere", "", "", "", ""), "main");
        assert_eq!(f.vantage, Vantage::Elsewhere);
        assert!(f.walk.is_empty());
    }

    /// The lap clause crosses the seam as bytes. Revert to make RED: parse the
    /// numbers out and re-format them here.
    #[test]
    fn the_lap_clause_is_carried_verbatim() {
        let f = of(&row("here", "project", "plan,work", "work", "pass 2 of up to 4"), "main");
        assert_eq!(f.lap, "pass 2 of up to 4");
    }

    /// A fact naming a stage the current route does not walk is not snapped
    /// onto a neighbouring step. Revert to make RED: `at: Some(0)` on a miss.
    #[test]
    fn a_stage_outside_the_walk_marks_no_step() {
        let f = of(&row("here", "project", "plan,work", "critique", ""), "main");
        assert_eq!(f.at, None);
        assert!(f.steps().iter().all(|(_, m)| *m == Mark::Ahead));
    }

    /// Both one-step routes (`answer`, `react`) reach the rail as ONE step.
    #[test]
    fn a_one_step_route_is_one_step() {
        let f = of(&row("here", "answer", "answer", "answer", ""), "main");
        assert_eq!(f.steps(), vec![("answer", Mark::Here)]);
    }
}
