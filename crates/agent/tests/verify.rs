//! THE VERIFY GATE, through the pure step function (`agent::verify`).
//!
//! An agent that writes a file and then says "done" has told you nothing you can
//! check. The gate holds that answer, twice, and then lets it land under an
//! ending that says what is and is not known — never that anything was
//! *verified*, which is a word this build does not own.

use kernel::{Event, EventId, EventKind, Timestamp, ToolId};

use agent::{adopt_spec, ended_why, parse_agent_file, step, AgentState, Effect};

const FILE: &str = "---\nname: a\ndescription: d\nmodel: local\nspace: research\n\
                    tools: [exec, write_file]\n---\nbody";

fn ev(kind: EventKind) -> Event {
    Event { id: EventId(0), seq: 0, at: Timestamp(1_753_800_000_000), kind }
}

fn said(text: &str) -> Event {
    ev(EventKind::ModelReplied { text: text.into(), agent: String::new() })
}

fn ran(tool: &str, output: &str) -> Event {
    ev(EventKind::ToolInvoked {
        tool: ToolId(tool.into()),
        args: "{}".into(),
        ok: true,
        output: output.into(),
    })
}

fn working() -> AgentState {
    let spec = parse_agent_file("a", FILE).expect("spec parses");
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &[]);
    step(
        state,
        ev(EventKind::UserMessage {
            text: "write notes.md".into(),
            agent: String::new(),
            from: String::new(),
        }),
    )
    .0
}

/// Why the turn ended, out of the one ending effect in the list.
fn ending(effects: &[Effect]) -> String {
    let Some(Effect::Emit { kind: EventKind::Custom { payload_json, .. } }) = effects
        .iter()
        .find(|e| matches!(e, Effect::Emit { kind: EventKind::Custom { kind, .. } } if kind == agent::ENDED))
    else {
        panic!("no ending in {effects:?}");
    };
    ended_why(payload_json)
}

/// One write, then prose. The turn does not end: the machine says in the log
/// that it asked, and asks the model once more.
#[test]
fn a_write_with_nothing_run_after_it_does_not_end_the_turn() {
    let state = step(working(), said("write_file({\"path\": \"n.md\"})")).0;
    let state = step(state, ran("write_file", "wrote n.md")).0;
    let (state, effects) = step(state, said("Done — I wrote the file."));
    assert!(
        matches!(
            effects.as_slice(),
            [Effect::Emit { kind: EventKind::Custom { kind, .. } }, Effect::CallModel { .. }]
                if kind == agent::VERIFY_NUDGED
        ),
        "the nudge is a FACT beside the extra call: {effects:?}"
    );
    assert!(state.task.is_some(), "the turn is still running");
    // …TWICE, AND THEN THE ANSWER LANDS. A gate that can hold an answer forever
    // is a gate that loses answers.
    let (state, effects) = step(state, said("Still done."));
    assert_eq!(effects.len(), 2, "the second nudge: {effects:?}");
    let (state, effects) = step(state, said("Still done."));
    assert_eq!(ending(&effects), agent::UNCHECKED);
    assert!(state.task.is_none(), "and the turn is over");
}

/// A write, then a command that printed something. Log ORDER is the freshness
/// rule, so this answer is not held and the ending is the ordinary one.
#[test]
fn a_write_read_back_by_a_command_answers_normally() {
    let state = step(working(), said("write_file({\"path\": \"n.md\"})")).0;
    let state = step(state, ran("write_file", "wrote n.md")).0;
    let state = step(state, said("exec({\"command\": \"cat n.md\"})")).0;
    let state = step(state, ran("exec", "hello from n.md")).0;
    let (_, effects) = step(state, said("Done — I wrote it and read it back."));
    assert_eq!(effects.len(), 1, "no nudge: {effects:?}");
    assert_eq!(ending(&effects), agent::ANSWERED);
}

/// THE COMMAND MUST COME AFTER THE WRITE. A `cat` run before the edit is
/// evidence about a file that no longer exists in that state — and because the
/// fold is left-to-right, the write clears it with no clock involved.
#[test]
fn a_command_before_the_write_is_not_evidence_for_it() {
    let state = step(working(), said("exec({\"command\": \"ls\"})")).0;
    let state = step(state, ran("exec", "n.md")).0;
    let state = step(state, said("write_file({\"path\": \"n.md\"})")).0;
    let state = step(state, ran("write_file", "wrote n.md")).0;
    let (_, effects) = step(state, said("Done."));
    assert_eq!(effects.len(), 2, "held: {effects:?}");
}

/// A COMMAND THAT PRINTED NOTHING IS NOT EVIDENCE — the same predicate the Tool
/// trace uses to write `ok, and it printed nothing` beside such a row.
#[test]
fn a_silent_command_is_not_evidence() {
    let state = step(working(), said("write_file({\"path\": \"n.md\"})")).0;
    let state = step(state, ran("write_file", "wrote n.md")).0;
    let state = step(state, said("exec({\"command\": \"true\"})")).0;
    let state = step(state, ran("exec", "(no output)")).0;
    let (_, effects) = step(state, said("Done."));
    assert_eq!(effects.len(), 2, "silence is not a check: {effects:?}");
}

/// A READ-ONLY TURN IS NEVER TOUCHED. The gate is about a change nobody looked
/// at; an agent that read three files and answered changed nothing.
#[test]
fn a_turn_that_changed_nothing_is_not_nudged() {
    let state = step(working(), said("exec({\"command\": \"ls\"})")).0;
    let state = step(state, ran("exec", "n.md")).0;
    let (_, effects) = step(state, said("There is one file."));
    assert_eq!(effects.len(), 1, "no nudge: {effects:?}");
    assert_eq!(ending(&effects), agent::ANSWERED);
}

/// The evidence belongs to ONE turn: a fresh question starts with none, so last
/// turn's `cat` cannot vouch for this turn's write.
#[test]
fn evidence_does_not_survive_the_turn_that_earned_it() {
    let state = step(working(), said("exec({\"command\": \"ls\"})")).0;
    let state = step(state, ran("exec", "n.md")).0;
    let state = step(state, said("There is one file.")).0;
    assert!(!state.green && !state.mutated, "an ended turn holds no evidence");
    let state = step(
        state,
        ev(EventKind::UserMessage {
            text: "now write it".into(),
            agent: String::new(),
            from: String::new(),
        }),
    )
    .0;
    let state = step(state, said("write_file({\"path\": \"n.md\"})")).0;
    let state = step(state, ran("write_file", "wrote n.md")).0;
    let (_, effects) = step(state, said("Done."));
    assert_eq!(effects.len(), 2, "held: {effects:?}");
}
