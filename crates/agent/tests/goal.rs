//! THE STANDING GOAL (increment 26) — a continue condition that is an OBSERVED
//! EXIT CODE, asserted through `step`, so what is pinned is the sequence of
//! effects a real turn produces rather than the arithmetic underneath it.
//!
//! Host-only, like every other agent test. The check never runs here and does
//! not need to: `step` is pure, so it DESCRIBES the command as an effect and
//! the result is handed back as an ordinary `ToolInvoked` — which is exactly
//! what the runtime does with it, one await further out.

mod common;

use agent::{step, AgentState, Effect};
use kernel::{Event, EventId, EventKind, Timestamp, ToolId};

const BUILDER: &str = include_str!("agents/builder.md");
const MAIN: &str = include_str!("../../../public/agents/main/agent.md");

/// A whole legal goal, which is four lines: the two prose keys, the command,
/// and the space the command runs in.
const GOAL: &str = "space: research\ngoal.outcome: the file exists\ngoal.check: test -f DONE.md\n\
                    goal.done_when: DONE.md is in the workspace\n";

fn ev(kind: EventKind) -> Event {
    Event { id: EventId(0), seq: 0, at: Timestamp(1_753_800_000_000), kind }
}

fn say(text: &str) -> Event {
    ev(EventKind::UserMessage { text: text.into(), agent: String::new(), from: String::new() })
}

fn reply(text: &str) -> Event {
    ev(EventKind::ModelReplied { text: text.into(), agent: String::new() })
}

/// One `exec` result. `ok` is the exit code already collapsed to the one bit
/// the continue condition needs — `core::workspace::gate` computes it as
/// `ran.status == 0`, at the only place in this app a command runs.
fn came_back(ok: bool, output: &str) -> Event {
    ev(EventKind::ToolInvoked {
        tool: ToolId("exec".into()),
        args: "{}".into(),
        ok,
        output: output.into(),
    })
}

fn agent_with(frontmatter: &str) -> AgentState {
    let mut fresh = AgentState::new();
    let file = format!("---\nname: a\ndescription: d\ntools: []\n{frontmatter}---\nbody");
    let spec = agent::parse_agent_file("a", &file).expect("spec parses");
    agent::adopt_spec(&mut fresh, &spec, &[]);
    common::brief(&mut fresh);
    fresh
}

fn ending(effects: &[Effect]) -> Option<String> {
    effects.iter().find_map(|e| match e {
        Effect::Emit { kind: EventKind::Custom { kind, payload_json } } if kind == agent::ENDED => {
            Some(agent::ended_why(payload_json))
        }
        _ => None,
    })
}

fn checked(effects: &[Effect]) -> Option<(String, bool, String)> {
    effects.iter().find_map(|e| match e {
        Effect::Emit { kind: EventKind::Custom { kind, payload_json } }
            if kind == agent::GOAL_CHECKED =>
        {
            Some(agent::checked_of(payload_json))
        }
        _ => None,
    })
}

/// The document of the model call in a batch of effects. A stage list emits its
/// `STAGE_ENTERED` fact first, so the call is never reliably at index 0.
fn asked(effects: &[Effect]) -> String {
    effects
        .iter()
        .find_map(|e| match e {
            Effect::CallModel { document, .. } => Some(format!("{document:?}")),
            _ => None,
        })
        .expect("the model is asked")
}

fn command_of(effects: &[Effect]) -> Option<String> {
    effects.iter().find_map(|e| match e {
        Effect::InvokeTool { tool, args_json } if tool.0 == "exec" => Some(args_json.clone()),
        _ => None,
    })
}

/// Walk a turn to the point where the last stage has replied in prose, which is
/// where the cursor runs off the end and the goal is read.
fn to_the_end_of_the_list(state: AgentState) -> (AgentState, Vec<Effect>) {
    let (state, _) = step(state, reply("OUTCOME — a file."));
    let (state, _) = step(state, reply("Wrote it."));
    step(state, reply("It printed 42."))
}

/// THE COMPATIBILITY RULE. A file with no `goal.*` key behaves byte-for-byte as
/// it did: the same continue condition (`acted`), the same ending, no check
/// anywhere, and — the part a rendered-prompt test would miss — no block in the
/// paper either, because `adopt_spec` attaches nothing it was not given.
#[test]
fn an_agent_with_no_goal_is_the_turn_this_build_has_always_taken() {
    let (state, effects) = step(agent_with("stages: [work]\npasses: 3\n"), say("go"));
    let rendered = asked(&effects);
    // By SECTION ID: the word "goal" occurs in the affordances prose, and a
    // needle that loose would pass over a block that really was attached.
    assert!(!rendered.contains("SectionId(\"goal\")"), "no block was attached: {rendered}");

    let (state, _) = step(state, came_back(true, "42"));
    let (state, effects) = step(state, reply("Did it."));
    assert!(command_of(&effects).is_none(), "nothing was checked: {effects:?}");
    assert!(checked(&effects).is_none());
    // …and the lap it earned is the one `acted` earned it, exactly as before.
    let (state, effects) = step(state, reply("Nothing more to do."));
    assert_eq!(ending(&effects).as_deref(), Some(agent::ANSWERED));
    assert!(state.task.is_none());
}

/// A CHECK THAT EXITS 0 STOPS THE TURN, BUDGET LEFT OR NOT. The whole point:
/// the goal is met, so there is nothing to spend the remaining passes on, and
/// nobody asked the model whether it agreed.
#[test]
fn a_check_that_passes_stops_the_turn_with_passes_left() {
    let (state, _) = step(agent_with(&format!("stages: [plan, work, verify]\npasses: 4\n{GOAL}")), say("go"));
    let (state, effects) = to_the_end_of_the_list(state);
    let args = command_of(&effects).expect("phase one asks for the check");
    assert!(args.contains("test -f DONE.md"), "the declared command, verbatim: {args}");
    assert!(ending(&effects).is_none(), "nothing is decided yet");
    assert!(state.standing.checking, "and the harness says the next result is its own");
    assert_eq!(state.pass, 0, "no lap has been spent on the strength of a guess");

    let (state, effects) = step(state, came_back(true, ""));
    assert_eq!(ending(&effects).as_deref(), Some(agent::ANSWERED), "{effects:?}");
    assert!(state.task.is_none(), "the turn is over with three passes unspent");
    let (command, ok, _) = checked(&effects).expect("the check is a fact");
    assert_eq!((command.as_str(), ok), ("test -f DONE.md", true));
}

/// …AND A CHECK THAT DOES NOT SPENDS ANOTHER LAP, with what it printed put in
/// front of the model — a lap that starts over not knowing what failed is a lap
/// that repeats the failure.
#[test]
fn a_check_that_fails_spends_another_lap_and_says_why() {
    let (state, _) = step(agent_with(&format!("stages: [plan, work, verify]\npasses: 4\n{GOAL}")), say("go"));
    let (state, effects) = to_the_end_of_the_list(state);
    assert!(command_of(&effects).is_some());

    let (state, effects) = step(state, came_back(false, "no such file\n(exit status 1)"));
    assert!(ending(&effects).is_none(), "not over: {effects:?}");
    let (_, ok, _) = checked(&effects).expect("the check is a fact whichever way it went");
    assert!(!ok, "and the fact says it failed");
    let rendered = asked(&effects);
    assert!(rendered.contains("test -f DONE.md"), "the command is quoted back: {rendered}");
    assert!(rendered.contains("no such file"), "…and so is what it printed");
    assert!(!state.standing.checking, "and the harness is no longer waiting on itself");
}

/// THE HARNESS'S CHECK IS NOT THE MODEL'S OWN `exec`, and the correlation that
/// separates them is asserted rather than trusted: `checking` is only ever set
/// where `pending_tools` is 0, so no call the model wrote can be outstanding to
/// be confused with it.
#[test]
fn the_harness_check_is_not_the_models_own_exec() {
    let (state, _) = step(agent_with(&format!("stages: [work]\npasses: 3\n{GOAL}")), say("go"));
    // The MODEL calls `exec`. It is folded as an observation, spends a round,
    // and the harness never claims it.
    let (state, _) = step(state, reply("exec({\"command\": \"ls\"})"));
    assert!(!state.standing.checking, "a call the model wrote is not the harness's");
    let (state, _) = step(state, came_back(true, "a.txt"));
    assert_eq!(state.tool_rounds, 1, "the model's call spent a round of its budget");
    assert!(state.standing.met.is_none(), "and said nothing about the goal");

    // Now the harness's, and the precondition that makes the flag sound.
    let (state, effects) = step(state, reply("Done."));
    assert!(command_of(&effects).is_some());
    assert!(state.standing.checking && state.pending_tools == 0, "no model call is in flight");

    let rounds = state.tool_rounds;
    let (state, _) = step(state, came_back(false, "nope"));
    assert_eq!(state.tool_rounds, rounds, "the harness's own question is not billed as a round");
}

/// EVERY LAP RE-CHECKS. A goal met on one lap says nothing about the next, so
/// `met` is cleared with the rest of the lap's evidence.
#[test]
fn the_check_is_run_again_on_every_lap() {
    let (state, _) = step(agent_with(&format!("stages: [work]\npasses: 4\n{GOAL}")), say("go"));
    let (state, effects) = step(state, reply("Lap one."));
    assert!(command_of(&effects).is_some(), "lap one is checked");
    let (state, effects) = step(state, came_back(false, "nope"));
    assert!(command_of(&effects).is_none(), "…and the lap it earned starts with the model");
    assert!(state.standing.met.is_none(), "the verdict does not carry into the new lap");

    let (state, effects) = step(state, reply("Lap two."));
    assert!(command_of(&effects).is_some(), "lap two is checked too: {effects:?}");
    let (state, _) = step(state, came_back(true, ""));
    assert!(state.task.is_none(), "and it passed, so the turn stops");
}

/// THE BUDGET RAN OUT WITH THE GOAL UNMET, and that is not `answered` and not
/// the pass ceiling either: the machine has a command's own exit code, which is
/// a stronger thing to report than "the last lap was still changing files".
#[test]
fn a_budget_that_runs_out_with_the_goal_unmet_says_so() {
    let (state, _) = step(agent_with(&format!("stages: [work]\npasses: 2\n{GOAL}")), say("go"));
    let (state, _) = step(state, reply("Lap one."));
    let (state, _) = step(state, came_back(false, "nope"));
    let (state, _) = step(state, reply("Lap two."));
    let (state, effects) = step(state, came_back(false, "still nope"));
    assert_eq!(ending(&effects).as_deref(), Some(agent::GOAL_UNMET), "{effects:?}");
    assert_ne!(agent::GOAL_UNMET, agent::PASS_CEILING);
    assert_ne!(agent::GOAL_UNMET, agent::ANSWERED);
    assert!(state.task.is_none() && state.standing.met.is_none(), "and the turn is over, and clean");
}

/// A PASSING CHECK IS EVIDENCE. A command ran, after whatever the turn wrote,
/// and exited 0 — which is exactly what the verify gate wants — so a turn that
/// wrote a file and then met its goal does not end as `unchecked`.
#[test]
fn a_passing_check_is_the_evidence_the_verify_gate_wanted() {
    let (state, _) = step(agent_with(&format!("stages: [work]\npasses: 2\n{GOAL}")), say("go"));
    let (state, _) = step(state, reply("write_file({\"path\": \"a.md\", \"contents\": \"x\"})"));
    let (state, _) = step(
        state,
        ev(EventKind::ToolInvoked {
            tool: ToolId("write_file".into()),
            args: "{}".into(),
            ok: true,
            output: "wrote a.md".into(),
        }),
    );
    // The gate asks twice — nothing has run since the write — and then gives up
    // rather than eating the answer. On this build that landed as `unchecked`.
    let (state, _) = step(state, reply("Wrote it."));
    let (state, _) = step(state, reply("Still nothing has run."));
    let (state, effects) = step(state, reply("I cannot check it myself."));
    assert!(command_of(&effects).is_some(), "the goal is read once the gate is done");
    let (state, effects) = step(state, came_back(true, "ok"));
    assert_eq!(ending(&effects).as_deref(), Some(agent::ANSWERED), "not unchecked: {effects:?}");
    assert!(state.task.is_none());
}

/// A STOPPED TURN DOES NOT RUN IT, and it is not exempted. `stop::boundary`
/// treats anything that is not an ending, a steer or a nudge as new work, and a
/// command the person did not ask for, started after they pressed Stop, is
/// exactly the thing that press means to prevent.
#[test]
fn a_stopped_turn_does_not_run_the_check() {
    let (state, _) = step(agent_with(&format!("stages: [work]\npasses: 9\n{GOAL}")), say("go"));
    let (state, effects) = step(
        state,
        ev(EventKind::Custom { kind: agent::STOP_REQUESTED.into(), payload_json: "null".into() }),
    );
    assert!(effects.is_empty() && state.stopping);

    let (state, effects) = step(state, reply("Lap one."));
    assert!(command_of(&effects).is_none(), "the check is new work, and new work is refused");
    match effects.as_slice() {
        [Effect::Emit { kind: EventKind::Custom { kind, .. } }] => {
            assert_eq!(kind, agent::STOPPED, "the stop is the only record: {effects:?}")
        }
        other => panic!("a stopped turn records the stop and nothing else: {other:?}"),
    }
    assert!(state.task.is_none());
}

/// THE OUTCOME AND THE FINISH LINE REACH THE MODEL. A goal that lived only in
/// Rust would be the failure this codebase names most often — a setting that
/// looks applied, with the loop gated on something nobody was told.
///
/// The COMMAND is deliberately not in that block: it arrives as the result of
/// running it (`a_check_that_fails_spends_another_lap_and_says_why` pins that),
/// so the model aims at the outcome and then reads what was observed.
#[test]
fn the_outcome_and_the_finish_line_are_in_the_prompt() {
    let (_, effects) = step(agent_with(&format!("stages: [work]\n{GOAL}")), say("go"));
    let rendered = asked(&effects);
    assert!(rendered.contains("the file exists"), "the outcome: {rendered}");
    assert!(rendered.contains("DONE.md is in the workspace"), "…and the finish line");
    assert!(!rendered.contains("test -f DONE.md"), "…and not the command");
}

/// THE FOUR REFUSALS, each loud, each naming what to do. A goal that parses
/// clean and gates nothing is `engine: reakt` with better manners.
#[test]
fn a_goal_that_could_gate_nothing_is_refused() {
    let file = |fm: &str| format!("---\nname: a\n{fm}---\nb");
    let refused = |fm: &str| match agent::parse_agent_file("a", &file(fm)) {
        Err(agent::AgentError::MalformedAgentFile { message, .. }) => message,
        other => panic!("that file should not have parsed: {other:?}"),
    };
    // Prose with no command falls silently back to `acted` — the proxy the goal
    // exists to replace.
    assert!(refused("goal.outcome: a thing\n").contains("goal.check"));
    assert!(refused("goal.done_when: a file\n").contains("goal.check"));
    // A command with no goal is a command with no reason.
    let m = refused("space: s\nstages: [work]\ngoal.check: true\n");
    assert!(m.contains("goal.outcome"), "{m}");
    // No list to lap, so the check gates nothing — `passes:`' own rule.
    let m = refused("space: s\ngoal.outcome: o\ngoal.check: true\n");
    assert!(m.contains("stages"), "{m}");
    // No space, so `core::workspace::gate` grants no folder and the command can
    // never run: the same failure one key over.
    let m = refused("stages: [work]\ngoal.outcome: o\ngoal.check: true\n");
    assert!(m.contains("space"), "{m}");
    // …and the whole, legal shape still parses.
    let spec = agent::parse_agent_file("a", &file(&format!("stages: [work]\n{GOAL}")))
        .expect("a whole goal is legal");
    assert_eq!(spec.goal.check, "test -f DONE.md");
}

/// WHERE IT SHIPS, AND WHERE IT DELIBERATELY DOES NOT. `builder` is handed a
/// goal and left alone, so the mechanism ships exercised. `main` is where a
/// greeting arrives, and a standing goal on a general assistant would be a
/// product decision nobody made.
#[test]
fn the_goal_ships_on_builder_and_not_on_main() {
    let builder = agent::parse_agent_file("builder", BUILDER).expect("builder parses");
    assert!(!builder.goal.check.is_empty(), "the one agent gated on an exit code");
    assert!(!builder.goal.outcome.is_empty() && !builder.goal.done_when.is_empty());
    assert!(!builder.space.is_empty(), "…and the space its check runs in");
    // The model is NOT told to hold `exec` for it: the harness issues the check
    // and the allowlist governs only what the model itself may call.
    let main = agent::parse_agent_file("main", MAIN).expect("main parses");
    assert_eq!(main.goal, agent::Goal::default(), "a greeting has no standing goal");
}
