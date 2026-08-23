//! THE RAIL — one agent's flow, drawn. A `Flow` in, an `Element` out: no app
//! handle, no reactive value, no seam call, no raw-HTML injection. It is the
//! first component in this tree whose props are DATA, which is what makes it
//! replaceable by a UI pack that never imports the browser adapter. Those four
//! absences are ROADMAP #7's criterion and it is a GREP, so they are named in
//! words the check cannot mistake for the thing.
//!
//! THREE DECISIONS IN WRITING, each a silence the roadmap asked to be ruled on:
//!
//! 1. **A WALK OF ONE STEP DRAWS ITS ONE STEP AND SAYS NOTHING OF "ONE".**
//!    `crates/core/src/board/stage.rs` refuses to write `stage 1 of 1` (I15) and
//!    this rail owes that refusal the same answer: no count anywhere, because
//!    the CHIPS are the position. So `answer` and `react` appear as themselves
//!    rather than as "no flow" — drawing nothing for a length-1 walk would hide
//!    two of the three flows in the component built to make them visible.
//!
//! 2. **NO WALK IS SAID, NOT DRAWN.** `agent::Route::named` returns `None` with
//!    no `React` fallback because drawing the wrong flow is worse than drawing
//!    none (I16). An empty walk gets a SENTENCE and zero chips, never a
//!    greyed-out guess at what the walk probably is.
//!
//! 3. **`elsewhere` IS A VANTAGE, NOT A STAGE.** "Not started" would be a
//!    fabrication about a turn that may be half done in another worker, so the
//!    note says whose log holds the facts instead.
//!
//! NOT ASSERTED HERE, STATED NOT IMPLIED (I17): the `rsx!`. `crates/ui` is
//! bin-only so nothing can link and render it; the tests cover every WORD-LEVEL
//! decision through the pure fns, and the rendering was walked at 375 and 1280.

use dioxus::prelude::*;

use super::read::{Flow, Vantage};

/// THE ACCESSIBLE NAME OF THE WHOLE RAIL — one sentence for someone who cannot
/// see the chips. No count, per decision 1: the only `" of "` this component
/// can render is inside the lap clause, which is the core's own bytes.
pub(crate) fn summary(flow: &Flow) -> String {
    if flow.vantage == Vantage::Elsewhere {
        return "Flow: this agent runs in its own worker".into();
    }
    match (flow.walk.is_empty(), flow.at) {
        (true, _) => "Flow: no route chosen yet".into(),
        (false, Some(at)) => format!("Flow: {}, at {}", label(flow), flow.walk[at]),
        (false, None) => format!("Flow: {}, no stage open", label(flow)),
    }
}

/// The route WORD, or what to call a walk whose word this build cannot name.
/// Never a guessed route (I16).
fn label(flow: &Flow) -> &str {
    match flow.route.is_empty() {
        true => "an unnamed route",
        false => &flow.route,
    }
}

/// WHAT THE RAIL SAYS WHEN IT HAS NO WALK TO DRAW. Empty when there is one.
/// The blanks are different facts and get different sentences — I16, here.
pub(crate) fn note(flow: &Flow) -> String {
    if flow.vantage == Vantage::Elsewhere {
        return "This agent runs in a worker of its own. Which loop it chose, and how far \
                through it is, are facts of that worker's log — nothing on this page can \
                read them.".into();
    }
    if !flow.walk.is_empty() {
        return String::new();
    }
    match flow.route.is_empty() {
        // Before the vote, and between turns. NOT "idle": the board row beside
        // this one owns the status word, and this says only what IT knows.
        true => "No loop chosen yet. The first thing a turn does is decide how much turn \
                 the message deserves; the stages it picks appear here.".into(),
        // A recorded route this build has no walk for. The word is still true,
        // so it is printed; the stages are not invented to sit under it.
        false => format!(
            "This turn chose the route `{}`, whose stages this build of the page \
             cannot draw.", flow.route),
    }
}

/// One agent's flow. `aria-label` carries the sentence, the chips carry the
/// picture, and `aria-hidden` on the list stops a screen reader hearing both.
pub(crate) fn rail(flow: &Flow) -> Element {
    let steps = flow.steps();
    rsx! {
        section { class: "flow-rail", aria_label: "{summary(flow)}",
            // NO EMPTY HEAD. Walked at 1280px: before the vote both children
            // are absent and the row still reserved height, so the honest "no
            // loop chosen yet" note sat under 16px of nothing.
            if !flow.route.is_empty() || !flow.lap.is_empty() {
                div { class: "flow-head",
                    if !flow.route.is_empty() {
                        span { class: "flow-route", "{flow.route}" }
                    }
                    // VERBATIM (`core::board::flow::lap`), never re-worded here.
                    if !flow.lap.is_empty() { span { class: "flow-lap", "{flow.lap}" } }
                }
            }
            if steps.is_empty() {
                p { class: "flow-note", "{note(flow)}" }
            } else {
                ol { class: "flow-walk", aria_hidden: "true",
                    for (i, (name, mark)) in steps.iter().enumerate() {
                        li { key: "{i}", class: "flow-step", "data-mark": mark.word(),
                            span { class: "flow-dot" }
                            "{name}"
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flow::read::Mark;

    fn flow(vantage: Vantage, route: &str, walk: &[&str], at: Option<usize>, lap: &str) -> Flow {
        let walk = walk.iter().map(|s| (*s).to_string()).collect();
        Flow { vantage, route: route.into(), walk, at, lap: lap.into() }
    }

    /// DECISION 1. No count, at any length — and no `1 of 1`, which
    /// `core::board::stage.rs` refuses to write for the same reason. The lap
    /// clause is the ONE string here that may contain `of`, and it is the
    /// core's bytes. Revert to make RED: add `step {n} of {len}` to `summary`.
    #[test]
    fn the_rail_never_counts_and_a_walk_of_one_says_nothing_of_one() {
        let project = ["plan", "work", "verify", "critique"];
        for f in [
            flow(Vantage::Here, "answer", &["answer"], Some(0), ""),
            flow(Vantage::Here, "react", &["work"], Some(0), ""),
            flow(Vantage::Here, "project", &project, Some(1), ""),
        ] {
            let said = format!("{} {}", summary(&f), note(&f));
            assert!(!said.contains(" of "), "the rail counted: {said}");
            assert!(!said.contains(" 1 "), "the rail numbered a step: {said}");
        }
    }

    /// …and a length-1 walk still DRAWS its step rather than vanishing, which
    /// is what makes two of the three flows visible at all.
    #[test]
    fn a_one_step_flow_is_drawn_rather_than_hidden() {
        let f = flow(Vantage::Here, "answer", &["answer"], Some(0), "");
        assert_eq!(f.steps(), vec![("answer", Mark::Here)]);
        assert_eq!(note(&f), "", "a walk this rail can draw needs no sentence");
    }

    /// DECISION 2. Revert to make RED: return `String::new()` for an empty walk
    /// and let the empty `<ol>` stand.
    #[test]
    fn an_absent_walk_is_stated_and_never_guessed() {
        let f = flow(Vantage::Here, "", &[], None, "");
        assert!(note(&f).contains("No loop chosen yet"));
        for guess in ["plan", "work", "verify", "critique", "react", "answer"] {
            assert!(!note(&f).contains(guess), "the note invented a stage: {guess}");
        }
        assert_eq!(summary(&f), "Flow: no route chosen yet");
    }

    /// …and a route word with no walk behind it keeps the word and invents no
    /// stages. Revert to make RED: fall through to the "no loop chosen" arm.
    #[test]
    fn a_route_this_build_cannot_draw_keeps_its_word() {
        let f = flow(Vantage::Here, "quest", &[], None, "");
        assert!(note(&f).contains("quest"));
        assert!(!note(&f).contains("No loop chosen yet"));
    }

    /// DECISION 3. Revert to make RED: delete the `Elsewhere` arm of `note` so
    /// a sub-agent falls into the "no loop chosen yet" sentence.
    #[test]
    fn a_sub_agent_is_never_called_not_started() {
        let f = flow(Vantage::Elsewhere, "", &[], None, "");
        let said = format!("{} {}", summary(&f), note(&f));
        for wrong in ["not started", "No loop chosen yet", "yet to", "idle"] {
            assert!(!said.contains(wrong), "`{wrong}` is a claim this page cannot make: {said}");
        }
        assert!(said.contains("worker"), "the note must say WHOSE log holds the facts: {said}");
    }

    /// A stage the walk does not list leaves every chip unlit and says so,
    /// rather than lighting the first. Revert to make RED: `Some(0)` default.
    #[test]
    fn no_open_stage_is_said_rather_than_assumed() {
        let f = flow(Vantage::Here, "project", &["plan", "work"], None, "");
        assert_eq!(summary(&f), "Flow: project, no stage open");
    }

    /// The three marks are the three words `web/flow.css` keys off.
    #[test]
    fn every_mark_has_exactly_one_word() {
        let words = [Mark::Done.word(), Mark::Here.word(), Mark::Ahead.word()];
        assert_eq!(words, ["done", "here", "ahead"]);
    }
}
