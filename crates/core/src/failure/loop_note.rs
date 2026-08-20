//! THE NOTICES THE LOOP ITSELF PUTS ON SCREEN — which stage (20, 21), which lap
//! (22), and which check the harness ran of its own accord (26).
//!
//! None of these is an ENDING. They are the machine moving a turn along, and
//! without them the conversation shows one agent answering three times in a row
//! with nothing saying who asked the second time — the `VERIFY_NUDGED` defect,
//! once per mechanism. A round nobody can see is a token meter running behind a
//! spinner (I8), so every fact the loop emits gets a sentence here.
//!
//! ONE LIST, FOUR READERS. `is_loop_fact` is that list, and `chat::fold`'s two
//! folds, `failure::ending::one` and `is_note` all ask it rather than each
//! repeating the names. The three used to be spelled out at four call sites;
//! adding a fourth fact to three of them and forgetting the fourth is exactly
//! how one surface starts telling a different story from the next.

/// Whether this fact is the loop saying it moved, rather than a turn ending.
/// Every reader of that question asks HERE.
pub(crate) fn is_loop_fact(kind: &str) -> bool {
    kind == agent::STAGE_ENTERED || kind == agent::PASS_SPENT || kind == agent::GOAL_CHECKED
}

/// The sentence for one of them, or `None` where the fact is not the loop's.
pub(crate) fn note(kind: &str, payload_json: &str) -> Option<(String, String)> {
    match kind {
        k if k == agent::STAGE_ENTERED => Some(stage_note(payload_json)),
        k if k == agent::PASS_SPENT => Some(pass_note(payload_json)),
        k if k == agent::GOAL_CHECKED => Some(goal_note(payload_json)),
        _ => None,
    }
}

/// THE CHECK THE HARNESS RAN, AND WHAT IT SAID (26). The machine ran a command
/// nobody typed, and the whole point of this increment is that the exit code —
/// not the model's account of its progress — decides whether the turn goes
/// round again. So the sentence names the command, says which way it went, and
/// quotes what it printed. Nothing here is a verdict on the work: an exit code
/// is not an opinion, and neither is this.
fn goal_note(payload_json: &str) -> (String, String) {
    let (command, ok, output) = agent::checked_of(payload_json);
    let verdict = match ok {
        true => "passed, so the goal is met and the turn stops here",
        false => "did not pass, so the goal is not met yet",
    };
    let printed = match output.trim().is_empty() {
        true => String::new(),
        false => format!("\n\n```\n{}\n```", output.trim()),
    };
    (
        "Goal check".to_string(),
        format!(
            "This agent's file names `{command}` as the command that says whether its goal \
             is done. The page ran it — nobody typed it — and it {verdict}.{printed}"
        ),
    )
}

/// WHICH STAGE, AND WHAT IT IS FOR (20). Without it the conversation shows one
/// agent answering three times in a row with nothing saying why — the
/// `VERIFY_NUDGED` defect, once per declared stage. The sentence names the
/// stage's job and claims nothing about the work.
///
/// …AND IT IS LABELLED WITH THE STAGE'S OWN NAME (21). All four wore `Note:`,
/// the page's generic word for "not speech", so the loop had no name on any
/// screen: a critic searched the rendered text of all six views and found
/// `verify` 0 times, `stage` 0, `loop` 0. The label comes off the
/// `core.stage_entered` fact already in the log — no second state (I8).
fn stage_note(payload_json: &str) -> (String, String) {
    let (label, said) = match agent::stage_of(payload_json).as_str() {
        s if s == agent::STAGE_PLAN => (
            "Plan stage",
            "Turning the request into a brief — what will be true when this is done, which \
             files, and the command that would show it. It calls nothing at this point.",
        ),
        s if s == agent::STAGE_VERIFY => (
            "Verify stage",
            "Running the check the brief named, and reading what it prints.",
        ),
        s if s == agent::STAGE_CRITIQUE => (
            "Critique stage",
            "Reading the turn back to name what is still missing, before answering.",
        ),
        _ => ("Work stage", "Doing the work."),
    };
    (label.to_string(), said.to_string())
}

/// A LAP OF THE STAGES, ON SCREEN (22). An agent that keeps working across
/// passes is a token meter running behind a spinner unless the laps are
/// visible, so the fact `agent::passes` emits gets a line of its own — with the
/// count, because "still going" and "going for the fourth time out of five" are
/// different things to read. The sentence also says what earned it: the
/// continue condition is mechanical, and nobody should have to read the source
/// to find out that the model was not asked whether it was done.
fn pass_note(payload_json: &str) -> (String, String) {
    let (pass, of) = agent::pass_of(payload_json);
    (
        format!("Pass {pass} of {of}"),
        "The last pass changed or ran something and the goal is not done, so it is going \
         round again from the work stage. Nothing asked the model whether it was finished — \
         a pass that touches nothing ends the turn."
            .to_string(),
    )
}
