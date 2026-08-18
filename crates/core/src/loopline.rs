//! One line naming the loop an agent runs, for the cards that describe it.
//! Split from `origin.rs` (which describes where an agent CAME from) for the
//! 200-line rule (I12) once an agent could choose its loop per message.

use agent::AgentSpec;

/// What `loop_line` says of an agent that declares `strategy`.
const CHOOSES: &str = "Picks its loop per message: answers simple ones outright, reaches for \
    tools when it needs them, and plans → works → checks → critiques anything bigger.";
/// THE LOOP THIS AGENT RUNS, in one line. Increment 20 shipped a declared loop
/// that no surface named (`verify`, `stage`, `loop` and `delegat` each occurred
/// zero times across all six views — cold walk, 21); 31 added the lap count.
/// `stages:` and `passes:` are the whole source; this invents no state (I8).
pub(crate) fn loop_line(spec: &AgentSpec) -> String {
    // …AND AN AGENT THAT CHOOSES ITS LOOP HAS NO LIST TO PRINT: `Runs in
    // stages: strategy.` is true and says nothing, so name what it can choose.
    if spec.stages.iter().any(|s| s == agent::STAGE_STRATEGY) {
        return CHOOSES.to_string();
    }
    match (spec.stages.is_empty(), spec.passes) {
        // NOT "one reply": with no `stages:` a react agent still takes as many tool
        // rounds as it needs. What it skips is the plan before and the check after.
        (true, _) => "Runs no stages: it works and answers in one go, with no plan before it and \
                      no check after."
            .to_string(),
        (false, 1) => format!("Runs in stages: {}.", spec.stages.join(" → ")),
        (false, n) => format!("Runs in stages, up to {n} laps a turn: {}.", spec.stages.join(" → ")),
    }
}
