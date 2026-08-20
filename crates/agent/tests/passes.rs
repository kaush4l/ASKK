//! THE LOOP AROUND THE LOOP (increment 22) — `passes:`, asserted through
//! `step`, so what is pinned is the sequence of effects a real turn produces
//! rather than the arithmetic underneath it. Host-only, like every other agent
//! test: a pass is one more instruction and one more call.

mod common;

use agent::{step, AgentState, Effect};
use kernel::{Event, EventId, EventKind, Timestamp, ToolId};

const BUILDER: &str = include_str!("agents/builder.md");
const MAIN: &str = include_str!("../../../public/agents/main/agent.md");

fn ev(kind: EventKind) -> Event {
    Event { id: EventId(0), seq: 0, at: Timestamp(1_753_800_000_000), kind }
}

fn say(text: &str) -> Event {
    ev(EventKind::UserMessage { text: text.into(), agent: String::new(), from: String::new() })
}

fn reply(text: &str) -> Event {
    ev(EventKind::ModelReplied { text: text.into(), agent: String::new() })
}

/// A command that ran and printed something: `verify::observe` reads it as
/// evidence, which is the same fold the continue condition is gated on.
fn ran() -> Event {
    ev(EventKind::ToolInvoked {
        tool: ToolId("exec".into()),
        args: "{}".into(),
        ok: true,
        output: "42".into(),
    })
}

fn agent_with(frontmatter: &str) -> AgentState {
    let mut fresh = AgentState::new();
    let file = format!("---\nname: a\ndescription: d\ntools: []\n{frontmatter}---\nbody");
    let spec = agent::parse_agent_file("a", &file).expect("spec parses");
    agent::adopt_spec(&mut fresh, &spec, &[]);
    // Beside the spec, exactly as `core` installs them: a stage refuses to be
    // entered without the words it enters with (`agent::brief`).
    common::brief(&mut fresh);
    fresh
}

fn stage_fact(effect: &Effect) -> Option<String> {
    match effect {
        Effect::Emit { kind: EventKind::Custom { kind, payload_json } }
            if kind == agent::STAGE_ENTERED =>
        {
            Some(agent::stage_of(payload_json))
        }
        _ => None,
    }
}

fn ending(effects: &[Effect]) -> Option<String> {
    effects.iter().find_map(|e| match e {
        Effect::Emit { kind: EventKind::Custom { kind, payload_json } } if kind == agent::ENDED => {
            Some(agent::ended_why(payload_json))
        }
        _ => None,
    })
}

fn spent(effect: &Effect) -> Option<(u16, u16)> {
    match effect {
        Effect::Emit { kind: EventKind::Custom { kind, payload_json } }
            if kind == agent::PASS_SPENT =>
        {
            Some(agent::pass_of(payload_json))
        }
        _ => None,
    }
}

/// THE COMPATIBILITY RULE, AND IT IS THE SAME ONE `stages:` SHIPS WITH. A file
/// that names no `passes:` gets one, and one pass is byte-for-byte the turn
/// this build has always taken: the last stage's prose ends it, with `answered`
/// and no pass fact anywhere.
#[test]
fn one_pass_is_the_default_and_the_default_is_todays_turn() {
    let spec = agent::parse_agent_file("a", "---\nname: a\nstages: [work]\n---\nb").expect("parses");
    assert_eq!(spec.passes, 1, "absence means one lap");

    let (state, _) = step(agent_with("stages: [work]\n"), say("do it"));
    let (state, _) = step(state, ran());
    let (state, effects) = step(state, reply("Done."));
    assert_eq!(ending(&effects).as_deref(), Some(agent::ANSWERED));
    assert!(!effects.iter().any(|e| spent(e).is_some()), "no lap was spent: {effects:?}");
    assert!(state.task.is_none(), "and the turn is over");
}

/// A PASS THAT ACTED GOES ROUND AGAIN — FROM `work`, NEVER FROM `plan`.
/// Re-planning from scratch every lap is how a run drifts off the goal it
/// opened with, so the cursor lands on the stage that acts.
#[test]
fn a_pass_that_acted_goes_round_again_from_work() {
    let (state, effects) = step(agent_with("stages: [plan, work, verify]\npasses: 2\n"), say("go"));
    assert_eq!(stage_fact(&effects[0]).as_deref(), Some("plan"));
    let (state, effects) = step(state, reply("OUTCOME — a file exists."));
    assert_eq!(stage_fact(&effects[0]).as_deref(), Some("work"));
    let (state, _) = step(state, ran());
    let (state, effects) = step(state, reply("Wrote it."));
    assert_eq!(stage_fact(&effects[0]).as_deref(), Some("verify"));

    // The list has run out, the lap did something, and there is budget left.
    let (state, effects) = step(state, reply("It printed 42."));
    assert_eq!(spent(&effects[0]), Some((2, 2)), "the lap is a FACT, with its count");
    assert_eq!(stage_fact(&effects[1]).as_deref(), Some("work"), "back to work, not to plan");
    assert!(matches!(effects[2], Effect::CallModel { .. }), "and it is asked: {effects:?}");
    assert!(ending(&effects).is_none(), "nothing ended");
    assert!(state.task.is_some(), "the turn is still the same turn");
}

/// THE CONTINUE CONDITION IS MECHANICAL. A pass that produced no tool call at
/// all is the loop's natural end and ends the turn normally — the model is
/// never asked whether it is done, because a local 12B answers "not yet"
/// indefinitely (AutoGPT #1994, #3444).
#[test]
fn a_pass_that_ran_nothing_ends_the_turn_normally() {
    let (state, _) = step(agent_with("stages: [work]\npasses: 5\n"), say("hello"));
    let (state, effects) = step(state, reply("Hello — nothing to do here."));
    assert_eq!(ending(&effects).as_deref(), Some(agent::ANSWERED), "not a ceiling: {effects:?}");
    assert!(!effects.iter().any(|e| spent(e).is_some()));
    assert!(state.task.is_none());
}

/// …AND ONE PRODUCTIVE PASS DOES NOT BUY THE WHOLE BUDGET. The evidence is
/// per-lap: a pass that acted earns exactly the next one, and if that one only
/// talks, the turn ends there rather than running out the budget.
#[test]
fn evidence_does_not_carry_from_one_pass_to_the_next() {
    let (state, _) = step(agent_with("stages: [work]\npasses: 5\n"), say("go"));
    let (state, _) = step(state, ran());
    let (state, effects) = step(state, reply("Did it."));
    assert_eq!(spent(&effects[0]), Some((2, 5)), "the first lap acted: {effects:?}");
    let (state, effects) = step(state, reply("Nothing more to do."));
    assert_eq!(ending(&effects).as_deref(), Some(agent::ANSWERED), "the silent lap ends it");
    assert!(state.task.is_none());
}

/// THE BUDGET IS ACROSS THE GOAL, NOT PER PASS. `ending::end` clears
/// `tool_rounds` and a pass is not an ending, so the ceiling stays
/// `max_rounds` — if a pass reset the rounds the real ceiling would silently be
/// `max_rounds × passes`, and that product is the user's bill.
#[test]
fn the_round_budget_spans_the_passes() {
    let (state, _) = step(agent_with("stages: [work]\npasses: 3\nmax_rounds: 2\n"), say("go"));
    let (state, _) = step(state, ran());
    let (state, effects) = step(state, reply("One."));
    assert!(spent(&effects[0]).is_some(), "a second lap started");
    assert_eq!(state.tool_rounds, 1, "the round it already spent is still spent");

    // The second lap's first round is the SECOND round of the turn, and that is
    // the ceiling — not the second of six.
    let (state, effects) = step(state, ran());
    assert_eq!(ending(&effects).as_deref(), Some(agent::ROUND_CEILING), "{effects:?}");
    assert_eq!(state.tool_rounds, 0, "and an ending clears them, as it always did");
}

/// RUNNING OUT OF PASSES IS ITS OWN ENDING, NOT AN ANSWER (R17-P0-2: a
/// six-part task was abandoned and reported as `main finished`). The last lap
/// was still changing things, so the ending says the budget stopped it.
#[test]
fn running_out_of_passes_is_its_own_ending() {
    let (state, _) = step(agent_with("stages: [work]\npasses: 2\n"), say("go"));
    let (state, _) = step(state, ran());
    let (state, _) = step(state, reply("First pass done."));
    let (state, _) = step(state, ran());
    let (state, effects) = step(state, reply("Second pass done, more remains."));
    assert_eq!(ending(&effects).as_deref(), Some(agent::PASS_CEILING), "{effects:?}");
    assert!(state.task.is_none(), "and the turn is over");
    assert_ne!(agent::PASS_CEILING, agent::ANSWERED);
    assert_ne!(agent::PASS_CEILING, agent::ROUND_CEILING);
}

/// THE USER STOPS IT. An autonomous loop with no stop is a wedge in the user's
/// own browser tab, so the pass that would have started next never does:
/// `stop::boundary` catches the `CallModel` the lap rides out with.
#[test]
fn the_stop_halts_a_looping_agent_at_the_next_pass() {
    let (state, _) = step(agent_with("stages: [work]\npasses: 9\n"), say("go forever"));
    let (state, _) = step(state, ran());
    let (state, effects) = step(
        state,
        ev(EventKind::Custom { kind: agent::STOP_REQUESTED.into(), payload_json: "null".into() }),
    );
    assert!(effects.is_empty(), "the press starts nothing of its own");
    assert!(state.stopping);

    let (state, effects) = step(state, reply("Pass one done."));
    match effects.as_slice() {
        [Effect::Emit { kind: EventKind::Custom { kind, .. } }] => {
            assert_eq!(kind, agent::STOPPED, "the next lap is not started")
        }
        other => panic!("a stopped loop records the stop and nothing else: {other:?}"),
    }
    assert!(state.task.is_none() && !state.stopping);
}

/// `passes:` WITHOUT `stages:` IS REFUSED, on `engine: reakt`'s rule (19): a
/// pass is a lap of the stage list, so a budget with no list to lap parses
/// clean and does nothing at all.
#[test]
fn a_pass_budget_with_no_stages_to_lap_is_refused() {
    assert!(agent::parse_agent_file("a", "---\nname: a\npasses: 4\n---\nb").is_err());
    assert!(agent::parse_agent_file("a", "---\nname: a\npasses: lots\n---\nb").is_err());
    // …and the two shapes that mean something stay legal.
    let one = agent::parse_agent_file("a", "---\nname: a\npasses: 1\n---\nb").expect("one lap");
    assert_eq!((one.passes, one.stages.len()), (1, 0));
    let four = agent::parse_agent_file("a", "---\nname: a\nstages: [work]\npasses: 4\n---\nb")
        .expect("four laps of a real list");
    assert_eq!(four.passes, 4);
}

/// THE SHIPPED CONFIGURATION. One agent carries the loop so the feature ships
/// exercised, and it is NOT the one a greeting arrives at.
#[test]
fn the_looping_configuration_ships_on_builder_and_not_on_main() {
    let builder = agent::parse_agent_file("builder", BUILDER).expect("builder parses");
    assert_eq!(builder.stages, ["plan", "work", "verify"]);
    assert!(builder.passes > 1, "the one agent that loops");
    assert!(
        builder.description.contains("goal"),
        "its description says what it is for: {}",
        builder.description
    );
    let main = agent::parse_agent_file("main", MAIN).expect("main parses");
    assert_eq!(main.passes, 1, "a greeting must not cost five passes");
}

/// THE GOAL HAS TO OUTLIVE THE WINDOW. `main` compacts at 8 entries and a
/// five-lap run eats its own plan, so the plan brief tells the work stage to
/// put the outcome and the finish line in the SPACE — one existing tool, no new
/// store. Only where the agent has a space to write to.
#[test]
fn the_plan_brief_sends_the_goal_to_the_space() {
    let (_, effects) = step(agent_with("stages: [plan, work]\nspace: research\n"), say("go"));
    let Effect::CallModel { document, .. } = &effects[1] else { panic!("expected the call") };
    let text = format!("{document:?}");
    assert!(text.contains("remember"), "the brief names the tool that survives compaction");
    assert!(text.contains("done_when") && text.contains("outcome"), "…and both keys");

    // An agent with no space is told nothing about a tool it was never granted.
    let (_, effects) = step(agent_with("stages: [plan, work]\n"), say("go"));
    let Effect::CallModel { document, .. } = &effects[1] else { panic!("expected the call") };
    assert!(!format!("{document:?}").contains("done_when"));
}
