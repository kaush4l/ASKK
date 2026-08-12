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
