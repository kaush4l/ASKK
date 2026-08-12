//! The tool loop's terminator: how far one turn may go, and who decides.
//!
//! Its own file rather than another test in `tools.rs`, which is already at
//! the 200-line ceiling this repo holds every file to.

use agent::{step, AgentState, Effect};
use kernel::{Event, EventId, EventKind, Timestamp, ToolId};

/// The ceiling is the AGENT's, not the machine's, and it is not four.
///
/// Four rounds cannot finish any real task — read a file, run a build, read
/// the errors, edit, build again is already five — and the counter exists to
/// stop a model LOOPING, not to stop an agent working. This drives the pure
/// machine round the loop and asserts both halves: it keeps going past the old
/// constant, and it stops dead on the number the file names.
#[test]
fn the_tool_loop_runs_to_the_agents_own_ceiling_and_then_stops() {
    let ev = |kind| Event {
        id: EventId(0),
        seq: 0,
        at: Timestamp(1_753_800_000_000),
        kind,
    };
    let mut fresh = AgentState::new();
    let spec = agent::parse_agent_file(
        "main",
        "---\nname: main\ndescription: d\ntools: []\nmax_rounds: 7\n---\nbody",
    )
    .expect("spec parses");
    agent::adopt_spec(&mut fresh, &spec, &[]);
    assert_eq!(fresh.max_rounds, 7, "the file's ceiling reached the state");

    let mut state = step(
        fresh,
        ev(EventKind::UserMessage {
            text: "do the work".into(),
            agent: String::new(),
            from: String::new(),
        }),
    )
    .0;
    // Round n: the model calls one tool, the result lands, and the machine
    // asks again — until the ceiling, where it emits the note instead.
    for round in 1..=7u16 {
        let (next, effects) = step(
            state,
            ev(EventKind::ModelReplied {
                text: "now()".into(),
                agent: String::new(),
            }),
        );
        assert!(matches!(effects.as_slice(), [Effect::InvokeTool { .. }]), "round {round}");
        let (next, effects) = step(
            next,
            ev(EventKind::ToolInvoked {
                tool: ToolId("now".into()),
                args: "{}".into(),
                ok: true,
                output: "…".into(),
            }),
        );
        state = next;
        if round < 7 {
            assert!(
                matches!(effects.as_slice(), [Effect::CallModel { .. }]),
                "round {round} of 7 must ask the model again, not stop: {effects:?}"
            );
        } else {
            match effects.as_slice() {
                [Effect::Emit { kind: EventKind::Custom { kind, payload_json } }] => {
                    assert_eq!(kind, "core.note");
                    assert!(payload_json.contains("after 7 rounds"), "{payload_json}");
                }
                other => panic!("the ceiling must stop the turn deterministically: {other:?}"),
            }
            assert!(state.task.is_none(), "a stopped turn holds no task");
        }
    }
}

/// A message typed while the agent is working is STEERING: it lands in the
/// history the next call assembles, and it emits nothing of its own.
///
/// The naive reading — fall through to the start-a-turn arm — would ask the
/// model a second time while the first batch is still out, and then decrement
/// `pending_tools` past the batch that had not landed yet. This asserts the
/// three facts that stop: no effect, the tool batch still outstanding, and the
/// sentence present in the paper the next round sends.
#[test]
fn a_message_typed_mid_run_steers_the_turn_instead_of_starting_one() {
    let ev = |kind| Event {
        id: EventId(0),
        seq: 0,
        at: Timestamp(1_753_800_000_000),
        kind,
    };
    let say = |text: &str| {
        ev(EventKind::UserMessage {
            text: text.into(),
            agent: String::new(),
            from: String::new(),
        })
    };
    let mut fresh = AgentState::new();
    let spec = agent::parse_agent_file("main", "---\nname: main\ndescription: d\ntools: []\n---\nb")
        .expect("spec parses");
    agent::adopt_spec(&mut fresh, &spec, &[]);

    let (state, _) = step(fresh, say("do the work"));
    let (state, effects) = step(
        state,
        ev(EventKind::ModelReplied { text: "now()".into(), agent: String::new() }),
    );
    assert!(matches!(effects.as_slice(), [Effect::InvokeTool { .. }]));

    let (state, effects) = step(state, say("actually, in UTC"));
    assert!(effects.is_empty(), "steering asks nothing on its own: {effects:?}");
    assert_eq!(state.pending_tools, 1, "the batch in flight is untouched");

    let (_, effects) = step(
        state,
        ev(EventKind::ToolInvoked {
            tool: ToolId("now".into()),
            args: "{}".into(),
            ok: true,
            output: "…".into(),
        }),
    );
    match effects.as_slice() {
        [Effect::CallModel { document, .. }] => {
            let sent = format!("{document:?}");
            assert!(sent.contains("actually, in UTC"), "the steer reached the paper: {sent}");
        }
        other => panic!("the round completes and asks once: {other:?}"),
    }
}

/// The steer that arrives while the MODEL is answering is the common case, and
/// it was the one that dropped the sentence on the floor.
///
/// The reply that lands next was produced without it — the model never saw it —
/// so if that reply is the final answer, ending the turn there leaves the
/// person's sentence in the history with the answer to the PREVIOUS question
/// beneath it, the composer un-busied, and nothing anywhere saying it had been
/// ignored. It reads as an answer to the steer.
#[test]
fn a_steer_that_races_the_final_answer_is_answered_not_dropped() {
    let ev = |kind| Event {
        id: EventId(0),
        seq: 0,
        at: Timestamp(1_753_800_000_000),
        kind,
    };
    let say = |text: &str| {
        ev(EventKind::UserMessage {
            text: text.into(),
            agent: String::new(),
            from: String::new(),
        })
    };
    let reply = |text: &str| {
        ev(EventKind::ModelReplied {
            text: text.into(),
            agent: String::new(),
        })
    };
    let mut fresh = AgentState::new();
    let spec = agent::parse_agent_file("main", "---\nname: main\ndescription: d\ntools: []\n---\nb")
        .expect("spec parses");
    agent::adopt_spec(&mut fresh, &spec, &[]);

    // The question, then the steer while the model is still thinking.
    let (state, _) = step(fresh, say("what is the time"));
    let (state, effects) = step(state, say("in UTC, please"));
    assert!(effects.is_empty(), "steering asks nothing on its own");
    assert!(state.steered, "and it is recorded as unanswered");

    // The answer to the FIRST question arrives. It cannot be the answer to the
    // steer, so the turn continues with one more call carrying it.
    let (state, effects) = step(state, reply("It is 3pm."));
    match effects.as_slice() {
        [Effect::CallModel { document, .. }] => {
            let sent = format!("{document:?}");
            assert!(sent.contains("in UTC, please"), "the steer is in the paper: {sent}");
        }
        other => panic!("the steer must be answered, not dropped: {other:?}"),
    }
    assert!(!state.steered, "consumed by the call that carries it");
    assert!(state.task.is_some(), "and the turn is still the same turn");

    // That call's answer ends the turn, because nothing is outstanding now.
    let (state, effects) = step(state, reply("It is 15:00 UTC."));
    assert!(effects.is_empty(), "the turn ends: {effects:?}");
    assert!(state.task.is_none());
}
