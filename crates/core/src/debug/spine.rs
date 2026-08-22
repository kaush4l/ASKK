//! THE SPINE OF THE ANSWER — the three lines that say what a turn is DOING and
//! why it decided that: the route it voted for, the stages that route really
//! walks, and the phase machine underneath them. `render.rs` beside it owns the
//! panel's shape and the turn's frame.
//!
//! They are one subject because they are one question asked at three depths,
//! and because every one of them reads a fact that had no reader before this
//! module existed.

use module::view::{Fragment, FragmentBuilder};

use crate::debug::route::{self, Chosen};
use crate::debug::turns::Turn;

/// One line of the spine.
pub(crate) fn line(class: &str, text: String) -> Fragment {
    FragmentBuilder::new("p").class(class).text(&text).build()
}

/// THE CLAUSE THE MODEL WROTE FOR ITS VOTE. "The model wrote no reason" is
/// worth saying about a vote that landed and skipped it; beside a fallback
/// notice it would be the same fact said twice, so there it is left out.
fn why(chosen: &Chosen) -> Option<Fragment> {
    match (chosen.why.is_empty(), chosen.voted) {
        (false, _) => Some(line("note debug-why", format!("why: {}", chosen.why))),
        (true, true) => Some(line(
            "note debug-why",
            "why: the model voted and wrote no reason with it.".to_string(),
        )),
        (true, false) => None,
    }
}

/// The route, the clause behind it, and any other field the fact carries.
pub(crate) fn spine(turn: &Turn) -> Vec<Fragment> {
    let Some(chosen) = turn.route.as_ref() else {
        return match turn.entered.is_empty() {
            true => Vec::new(),
            false => vec![line(
                "note debug-route",
                "No route was voted in this turn — the stages below are the agent file's own \
                 declared list."
                    .to_string(),
            )],
        };
    };
    let walks = match route::walked(&chosen.route) {
        Some(list) => list.join(" → "),
        None => "a route this build does not know".to_string(),
    };
    let mut said = vec![line("note debug-route", format!("route: {} — {walks}", chosen.route))];
    said.extend(why(chosen));
    // A FALLBACK IS NOT A VOTE, and it is the one thing here that would make
    // the pane lie if it were drawn the same. `.warn` and not `.error`: nothing
    // failed, and the turn is running the route the machine picked when it
    // could not read the model's reply.
    if !chosen.voted {
        said.push(line(
            "warn debug-fallback",
            "The model's vote could not be read, so the machine chose this route itself."
                .to_string(),
        ));
    }
    for (key, value) in &chosen.also {
        said.push(line("note debug-also", format!("{key}: {value}")));
    }
    said
}

/// WHICH STAGE, OF THE LIST ACTUALLY WALKED. The route replaced the file's
/// `stages:` the moment the vote landed (`agent::stages::route`), so the count
/// comes from the route and only falls back to what was entered.
pub(crate) fn walk(turn: &Turn) -> Option<Fragment> {
    let here = turn.entered.last()?;
    let list = turn.route.as_ref().and_then(|c| route::walked(&c.route));
    let (nth, of) = match &list {
        Some(l) => (l.iter().position(|s| s == here), l.len()),
        None => (Some(turn.entered.len() - 1), turn.entered.len()),
    };
    let place = match nth {
        Some(n) => format!("stage {} of {of}: {here}", n + 1),
        None => format!("{here} — a stage the route's own list does not hold"),
    };
    Some(
        FragmentBuilder::new("p")
            .class("note debug-walk")
            .text(&format!("{} · {place}", turn.entered.join(" → ")))
            .build(),
    )
}

/// THE PHASE MACHINE UNDERNEATH (ADR-010). `PhaseEntered` is a different
/// question from the stage — the stage is the loop the agent file and the route
/// asked for, the phase is the machine that carries it — and it is named as a
/// different question here, because two lists of similar words with no
/// distinction drawn is the wall of records this pane exists to avoid.
pub(crate) fn phases(turn: &Turn) -> Option<Fragment> {
    (!turn.phases.is_empty()).then(|| {
        FragmentBuilder::new("p")
            .class("note debug-phase")
            .text(&format!("phase machine: {}", turn.phases.join(" → ")))
            .build()
    })
}

