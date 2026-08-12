//! Compaction inside a long turn. Its own file: `rounds.rs` owns the loop's
//! terminator and this owns the window, and both hold the 200-line rule (I12).

use agent::{step, AgentState};
use kernel::{Event, EventId, EventKind, Timestamp, ToolId};

/// A long turn compacts while it runs, so round thirty can still see round one.
///
/// Compaction used to be called from the `UserMessage` arm alone — right when a
/// turn was one call and four tool rounds, since the window could not outgrow
/// the budget inside one. At sixty-four rounds the window grows all through the
/// turn and `assemble` degrades silently at the budget, so the late rounds of a
/// long run were quietly losing the task they were working on.
#[test]
fn a_long_turn_compacts_while_it_is_still_running() {
    let ev = |kind| Event {
        id: EventId(0),
        seq: 0,
        at: Timestamp(1_753_800_000_000),
        kind,
    };
    let mut fresh = AgentState::new();
    let spec = agent::parse_agent_file(
        "main",
        "---\nname: main\ndescription: d\ntools: []\ncompact_at: 6\nkeep_recent: 2\n---\nb",
    )
    .expect("spec parses");
    // A summarizer must be attached, or compaction is a no-op by design: a
    // missing one costs a compaction and never a conversation.
    let summarizer = agent::parse_agent_file(
        "summarizer",
        "---\nname: summarizer\ndescription: compresses\ntools: []\n---\nYou compress.",
    )
    .expect("spec parses");
    agent::adopt_spec(&mut fresh, &spec, &[summarizer]);

    let mut state = step(
        fresh,
        ev(EventKind::UserMessage {
            text: "do the long thing".into(),
            agent: String::new(),
            from: String::new(),
        }),
    )
    .0;
    // Round after round of one tool call each, with no user message anywhere:
    // the only place compaction can be triggered from is the tool-result path.
    let mut compacted = false;
    for _ in 0..8 {
        let (next, _) = step(
            state,
            ev(EventKind::ModelReplied { text: "now()".into(), agent: String::new() }),
        );
        let (next, _) = step(
            next,
            ev(EventKind::ToolInvoked {
                tool: ToolId("now".into()),
                args: "{}".into(),
                ok: true,
                output: "…".into(),
            }),
        );
        state = next;
        if state.compacting {
            compacted = true;
            break;
        }
    }
    assert!(compacted, "a turn this long must compact without a user message to trigger it");
}
