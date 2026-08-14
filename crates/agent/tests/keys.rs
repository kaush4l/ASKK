//! TWO FRONTMATTER KEYS THAT DID NOTHING (increment 19).
//!
//! `spec.rs` refuses `compact_at: lots` rather than defaulting it, on the stated
//! rule that a setting which looks applied is worse than no setting. `engine:`
//! and `temperature:` had been breaking that rule in the shipped agent files the
//! whole time: both parsed, both rendered back out, both printed on the agent
//! card as fact, and neither reached the machine.

use kernel::{Event, EventId, EventKind, Timestamp};

use agent::{adopt_spec, parse_agent_file, step, toolbox_for, AgentState, Effect};

fn file(extra: &str) -> String {
    format!("---\nname: a\ndescription: d\nmodel: local\n{extra}\n---\nbody")
}

fn ask(state: AgentState, text: &str) -> (AgentState, Vec<Effect>) {
    step(
        state,
        Event {
            id: EventId(0),
            seq: 0,
            at: Timestamp(1_753_800_000_000),
            kind: EventKind::UserMessage {
                text: text.into(),
                agent: String::new(),
                from: String::new(),
            },
        },
    )
}

/// The whole of the temperature bug, end to end: the file says 0.7 and the
/// effect that goes to the model carries 0.7.
#[test]
fn temperature_rides_the_model_call() {
    let spec = parse_agent_file("a", &file("temperature: 0.7\ntools: []")).expect("parses");
    assert_eq!(spec.temperature, Some(0.7));
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &[]);
    assert_eq!(state.temperature, Some(0.7));
    let (_, effects) = ask(state, "hello");
    let [Effect::CallModel { temperature, .. }] = effects.as_slice() else {
        panic!("expected one CallModel, got {effects:?}");
    };
    assert_eq!(*temperature, Some(0.7));
}

/// A file with no `temperature:` line asks for none, and the effect says so —
/// the endpoint's own default, not a number this build made up.
#[test]
fn no_temperature_in_the_file_is_no_temperature_on_the_wire() {
    let spec = parse_agent_file("a", &file("tools: []")).expect("parses");
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &[]);
    let (_, effects) = ask(state, "hello");
    let [Effect::CallModel { temperature, .. }] = effects.as_slice() else {
        panic!("expected one CallModel, got {effects:?}");
    };
    assert_eq!(*temperature, None);
}

/// `engine: base` is what the agent card has claimed it is since R2-16 —
/// "answers in one reply, without calling tools". Before this it was a word:
/// `tools: []` reads as EVERY built-in (`subagent::resolve`), so the one shipped
/// `base` agent was the most capable one in the tree.
#[test]
fn base_grants_no_tools_and_react_grants_them() {
    let base = parse_agent_file("a", &file("engine: base\ntools: []")).expect("parses");
    assert!(toolbox_for(&base, &[]).tools.is_empty(), "base calls nothing");
    let react = parse_agent_file("a", &file("engine: react\ntools: []")).expect("parses");
    assert!(!toolbox_for(&react, &[]).tools.is_empty(), "react keeps the built-ins");
    // A file that names no engine keeps the loop this build has always run —
    // absence must not quietly disarm an agent.
    let silent = parse_agent_file("a", &file("tools: []")).expect("parses");
    assert_eq!(silent.engine, agent::ENGINE_REACT);
    assert!(!toolbox_for(&silent, &[]).tools.is_empty());
}

/// An engine this build cannot run is REFUSED, on `compact_at: lots`'s rule.
/// R18's critic saved `engine: reakt` with no complaint and the card reported it
/// back as fact.
#[test]
fn an_engine_the_machine_cannot_run_is_refused() {
    let err = parse_agent_file("a", &file("engine: reakt\ntools: []")).expect_err("refused");
    let said = format!("{err:?}");
    assert!(said.contains("reakt") && said.contains("react"), "says what it takes: {said}");
    // …and so is a `tools:` list under an engine that grants none, because a
    // dropped list is the same "looks applied" bug one key along.
    assert!(parse_agent_file("a", &file("engine: base\ntools: [now]")).is_err());
}
