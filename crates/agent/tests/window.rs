//! The rolling window, pinned against the Python's ACTUAL behaviour rather
//! than a reading of it: `core/engine.py` was run with a stub summarizer at
//! `compact_at=6, keep_recent=2` and the numbers below are what it printed —
//! the transcript it handed over, the window it kept, and the log it wrote.
//!
//! Python output, verbatim:
//!   TRANSCRIPT_GIVEN: COMPACT_PROMPT + "[USER]: m1\n\n[ASSISTANT]: m2\n\n
//!                     [USER]: m3\n\n[ASSISTANT]: m4"
//!   WINDOW: [system "Summary of the conversation so far:\nNOTES", user m5,
//!            assistant m6]
//!   noop: False   (len(messages) <= keep never compacts)

use agent::{compacted, due, set_window, transcript, window, AgentState, SUMMARY_HEADING};
use context::State;
use kernel::Timestamp;

const AT: Timestamp = Timestamp(1_753_800_000_000);

fn paper_of(lines: &[&str]) -> State {
    let mut state = AgentState::new();
    let owned: Vec<String> = lines.iter().map(|l| (*l).to_string()).collect();
    set_window(&mut state.paper, &owned, AT);
    state.paper
}

const SIX: [&str; 6] = [
    "user: m1",
    "assistant: m2",
    "user: m3",
    "assistant: m4",
    "user: m5",
    "assistant: m6",
];

/// The whole shape in one: it is due at `>= compact_at`, the summarizer is
/// handed everything except the newest `keep`, and what survives is the
/// summary followed by exactly that tail.
#[test]
fn compaction_replaces_the_older_window_with_a_summary_and_keeps_the_tail() {
    let mut paper = paper_of(&SIX);
    assert!(due(&paper, 6), "six entries reaches compact_at=6");
    assert!(!due(&paper, 7), "and not compact_at=7");
    assert!(!due(&paper, 0), "0 never compacts (the summarizer's own setting)");

    let handed = transcript(&paper, 2).expect("four entries are old enough");
    assert!(
        handed.ends_with("user: m1\n\nassistant: m2\n\nuser: m3\n\nassistant: m4"),
        "the four oldest, joined the way Python joins them: {handed}"
    );
    assert!(
        !handed.contains("m5") && !handed.contains("m6"),
        "the newest two are NOT summarised away: {handed}"
    );

    assert!(compacted(&mut paper, "NOTES", 2, AT));
    assert_eq!(
        window(&paper),
        vec![
            format!("system: {SUMMARY_HEADING}\nNOTES"),
            "user: m5".to_string(),
            "assistant: m6".to_string(),
        ],
        "summary + retained tail, and nothing else"
    );
}

/// Python `compact`: `len(messages) <= keep` returns False and touches
/// nothing. Nothing is old enough, so there is nothing to summarise.
#[test]
fn nothing_older_than_the_tail_is_never_compacted() {
    let mut paper = paper_of(&["user: one", "assistant: two"]);
    assert!(transcript(&paper, 2).is_none());
    assert!(!compacted(&mut paper, "NOTES", 2, AT));
    assert_eq!(window(&paper).len(), 2, "the window is untouched");
}

/// "A failed summarizer must leave the file alone, or a conversation would be
/// lost to an error that cost nothing else." An empty summary is that failure.
#[test]
fn a_summarizer_that_returns_nothing_leaves_the_conversation_alone() {
    let mut paper = paper_of(&SIX);
    assert!(!compacted(&mut paper, "   \n ", 2, AT));
    assert_eq!(window(&paper).len(), 6);
}

/// The window ROLLS: the second compaction is handed a transcript that opens
/// with the first summary, and folds it into the new one.
#[test]
fn the_next_compaction_folds_the_previous_summary_into_itself() {
    let mut paper = paper_of(&SIX);
    compacted(&mut paper, "FIRST", 2, AT);
    let mut lines = window(&paper);
    lines.extend(["user: m7".into(), "user: m8".into()]);
    set_window(&mut paper, &lines, AT);

    let handed = transcript(&paper, 2).expect("five entries, two kept");
    assert!(
        handed.contains(&format!("system: {SUMMARY_HEADING}\nFIRST")),
        "the earlier summary is IN the transcript it folds: {handed}"
    );
    compacted(&mut paper, "SECOND", 2, AT);
    assert_eq!(
        window(&paper),
        vec![
            format!("system: {SUMMARY_HEADING}\nSECOND"),
            "user: m7".to_string(),
            "user: m8".to_string(),
        ]
    );
}
