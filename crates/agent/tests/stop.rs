//! THE STOP (R16-P0-2), against the pure machine. Two consecutive fresh-context
//! critics named "you cannot stop a running agent" as the single blocker; this
//! is the half of the answer that does not need a browser.
//!
//! Its own file rather than another test in `rounds.rs`, which is already near
//! the ceiling this repo holds every file to.

use agent::{step, AgentState, Effect};
use kernel::{Event, EventId, EventKind, Timestamp, ToolId};

fn ev(kind: EventKind) -> Event {
    Event {
        id: EventId(0),
        seq: 0,
        at: Timestamp(1_753_800_000_000),
        kind,
    }
}

fn say(text: &str) -> Event {
    ev(EventKind::UserMessage {
        text: text.into(),
        agent: String::new(),
        from: String::new(),
    })
}

fn reply(text: &str) -> Event {
    ev(EventKind::ModelReplied {
        text: text.into(),
        agent: String::new(),
    })
}

fn result() -> Event {
    ev(EventKind::ToolInvoked {
        tool: ToolId("now".into()),
        args: "{}".into(),
        ok: true,
        output: "…".into(),
    })
}

fn press_stop() -> Event {
    ev(EventKind::Custom {
        kind: agent::STOP_REQUESTED.into(),
        payload_json: "null".into(),
    })
}

fn agent_with(frontmatter: &str) -> AgentState {
    let mut fresh = AgentState::new();
    let file = format!("---\nname: main\ndescription: d\ntools: []\n{frontmatter}---\nbody");
    let spec = agent::parse_agent_file("main", &file).expect("spec parses");
    agent::adopt_spec(&mut fresh, &spec, &[]);
    fresh
}

/// The press itself emits nothing — the `steered` shape — and then the NEXT
/// boundary ends the turn instead of starting the round after it.
///
/// This is the run the critic could not get out of: `max_rounds: 64`, a model
/// that keeps calling tools, and no exit but reloading the tab. Here it is
/// stopped at round three, deterministically, with the number in the fact.
#[test]
fn a_stop_ends_the_run_at_the_next_boundary_and_says_how_far_it_got() {
    let mut state = step(agent_with("max_rounds: 64\n"), say("loop forever")).0;
    for round in 1..=3u16 {
        let (next, effects) = step(state, reply("now()"));
        assert!(matches!(effects.as_slice(), [Effect::InvokeTool { .. }]), "round {round}");
        let (next, effects) = step(next, result());
        assert!(matches!(effects.as_slice(), [Effect::CallModel { .. }]), "round {round}");
        state = next;
    }
    assert_eq!(state.tool_rounds, 3, "three rounds of tool calls are behind it");

    // The press, mid-run, while a model call is in flight.
    let (state, effects) = step(state, press_stop());
    assert!(effects.is_empty(), "the press starts nothing of its own: {effects:?}");
    assert!(state.stopping, "and it is recorded on the turn");
    assert!(state.task.is_some(), "the turn in flight is still the turn in flight");

    // The call in flight lands. It asked for a tool; the tool is NOT run.
    let (state, effects) = step(state, reply("now()"));
    match effects.as_slice() {
        [Effect::Emit {
            kind: EventKind::Custom { kind, payload_json },
        }] => {
            assert_eq!(kind, agent::STOPPED);
            assert_eq!(agent::rounds(payload_json), 3, "the rounds it had done: {payload_json}");
        }
        other => panic!("a stopped turn records the stop and nothing else: {other:?}"),
    }
    assert!(state.task.is_none(), "a stopped turn holds no task");
    assert!(!state.stopping, "and the flag is consumed, not left armed");
}

/// The other boundary: the stop is pressed while TOOLS are out. Every result
/// still lands — nothing in this product can pull a command out of the Linux,
/// or a goal out of a sub-agent's Worker — and the model is not asked again.
#[test]
fn tools_already_running_land_and_no_further_model_call_is_made() {
    let state = step(agent_with(""), say("do the work")).0;
    let (state, effects) = step(state, reply("now()\nnow()"));
    assert_eq!(effects.len(), 2, "two calls out: {effects:?}");

    let (state, effects) = step(state, press_stop());
    assert!(effects.is_empty());
    let (state, effects) = step(state, result());
    assert!(effects.is_empty(), "one result outstanding is not a boundary: {effects:?}");
    assert_eq!(state.pending_tools, 1);

    let (state, effects) = step(state, result());
    assert!(
        matches!(
            effects.as_slice(),
            [Effect::Emit { kind: EventKind::Custom { kind, .. } }] if kind == agent::STOPPED
        ),
        "the last result is the boundary, and it stops: {effects:?}"
    );
    assert!(state.task.is_none());
}

/// A stop ends ONE turn. The flag surviving into the next one would make the
/// product unusable in a way no test of the first turn could see: every later
/// question answered with "stopped by you" and never asked at all.
#[test]
fn the_next_turn_after_a_stop_runs_normally() {
    let state = step(agent_with(""), say("first")).0;
    let (state, _) = step(state, press_stop());
    let (state, effects) = step(state, reply("now()"));
    assert!(matches!(effects.as_slice(), [Effect::Emit { .. }]), "stopped: {effects:?}");

    let (state, effects) = step(state, say("second"));
    assert!(matches!(effects.as_slice(), [Effect::CallModel { .. }]), "asked: {effects:?}");
    assert!(!state.stopping);
    let (state, effects) = step(state, reply("now()"));
    assert!(
        matches!(effects.as_slice(), [Effect::InvokeTool { .. }]),
        "and its tools run: {effects:?}"
    );
    let (_, effects) = step(state, result());
    assert!(matches!(effects.as_slice(), [Effect::CallModel { .. }]), "and it loops: {effects:?}");
}

/// Pressing Stop with nothing running arms nothing. Otherwise the flag would
/// sit on an idle agent and kill the next question the person asked.
#[test]
fn a_stop_with_no_turn_running_is_recorded_as_nothing() {
    let (state, effects) = step(agent_with(""), press_stop());
    assert!(effects.is_empty());
    assert!(!state.stopping, "an idle agent is already stopped");
}

/// R17-P0-2. AN ENDING IS NOT NEW WORK. `step` now says how a turn ended by
/// returning a `core.ended` fact, and the boundary catches effects on the way
/// out — so an unfiltered check would read a turn that ANSWERED under a pressed
/// stop as one the person cut off, and report a completed run as stopped.
#[test]
fn a_turn_that_answered_under_a_pressed_stop_is_not_reported_as_stopped() {
    let mut state = AgentState::new();
    let spec = agent::parse_agent_file("main", "---\nname: main\ndescription: d\ntools: []\n---\nb")
        .expect("spec parses");
    agent::adopt_spec(&mut state, &spec, &[]);

    let (state, _) = step(state, say("what time is it"));
    let (state, _) = step(state, press_stop());
    // The call in flight lands, and it is the answer.
    let (state, effects) = step(state, reply("It is 15:00 UTC."));
    match effects.as_slice() {
        [Effect::Emit { kind: EventKind::Custom { kind, payload_json } }] => {
            assert_eq!(kind, agent::ENDED, "the turn ended by answering, not by the stop");
            assert_eq!(agent::ended_why(payload_json), agent::ANSWERED);
        }
        other => panic!("an answered turn reports itself answered: {other:?}"),
    }
    assert!(state.task.is_none(), "and the turn is over either way");
}
