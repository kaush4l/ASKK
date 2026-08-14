//! Round 3's findings, each as the behaviour it asked for, through the seam on
//! the host (I3). The critic's verdict was that a first-timer's single
//! SUCCESSFUL run reads as a double failure, and both halves of that were one
//! screen disagreeing with itself: the launcher against the board (R3-2), the
//! transcript against the tool trace (R3-1, whose fix is in `ui`). What can be
//! pinned here is the PROJECTION — the words, and the signal behind them.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
use core::{boot, handle, install_agents, App, Ports};
use kernel::{Request, Timestamp};

fn block_on<F: Future>(fut: F) -> F::Output {
    let mut fut = pin!(fut);
    let mut cx = Context::from_waker(Waker::noop());
    for _ in 0..10_000 {
        if let Poll::Ready(v) = fut.as_mut().poll(&mut cx) {
            return v;
        }
    }
    panic!("future not ready under in-memory ports");
}

const AT: Timestamp = Timestamp(1_753_800_000_000);

/// `compact_at: 4` so the trigger is reachable in a test, and a summarizer that
/// is deliberately NOT loaded — which is one of the two ways a real window ends
/// up past its own trigger.
fn shipped() -> Vec<(String, String)> {
    vec![
        (
            "main".to_string(),
            "---\nname: main\ndescription: the lead\ntools: []\ncompact_at: 4\n\
             keep_recent: 2\n---\nPROMPT"
                .into(),
        ),
        (
            "researcher".to_string(),
            "---\nname: researcher\ndescription: the reader\ntools: []\ncompact_at: 4\n\
             keep_recent: 2\n---\nPROMPT"
                .into(),
        ),
    ]
}

fn booted() -> Rc<RefCell<App>> {
    let mut app = block_on(boot(Ports {
        model: Rc::new(ScriptedModel::with_replies(Vec::new())),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(AT)),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    }))
    .expect("boot succeeds");
    install_agents(&mut app, shipped());
    Rc::new(RefCell::new(app))
}

fn board(app: &Rc<RefCell<App>>) -> kernel::Response {
    handle(&mut app.borrow_mut(), Request::get("/board"))
}

fn chat(app: &Rc<RefCell<App>>) -> String {
    handle(&mut app.borrow_mut(), Request::get("/chat")).body
}

fn chat_with(app: &Rc<RefCell<App>>, who: &str) -> String {
    handle(
        &mut app.borrow_mut(),
        Request::get("/chat").with_header("x-agent", who),
    )
    .body
}

/// R3-2. One second after `Start agent` the Dashboard read `main is on it` in
/// the left card and `main — ready — your turn whenever you like` in the card
/// beside it. The launcher's fact is the accepted utterance; the board's was the
/// status alone, which the Worker had not moved yet. Now both come off the same
/// fold — and the board says NOT FINAL, so the page keeps looking instead of
/// going quiet in the one second that matters.
#[test]
fn a_launched_task_reads_as_working_on_the_board_at_the_instant_of_the_press() {
    let app = booted();
    let idle = board(&app);
    assert!(idle.body.contains("ready"), "{}", idle.body);
    assert!(!idle.headers.iter().any(|(k, _)| k == "x-busy"), "nothing is running yet");

    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", "write a haiku about lasers")]),
    );

    // Accepted, not yet pumped — the window the launcher's confirmation lives in.
    let res = board(&app);
    assert!(
        res.body.contains(r#"data-status="working""#),
        "the board must not say ready about a task it has accepted: {}",
        res.body
    );
    // …and it counts what it holds: the turn is accepted, the Worker has not
    // entered it, so no turn has been TAKEN yet. The row says both, and neither
    // number is invented.
    assert!(res.body.contains("working · no turns yet"), "{}", res.body);
    assert!(
        res.headers.iter().any(|(k, _)| k == "x-watch"),
        "a board with work accepted is not final, or the page stops polling: {:?}",
        res.headers
    );
    assert!(res.headers.iter().any(|(k, _)| k == "x-busy"), "{:?}", res.headers);
}

/// R3-12 and R3-13. One label per state, and a number that means one thing.
#[test]
fn the_board_has_one_word_per_state_and_counts_turns_not_replies() {
    let app = booted();
    let idle = board(&app).body;
    assert!(idle.contains("ready · no turns yet"), "{idle}");
    // The three wordings the critic found in one list, and the fabricated unit.
    for gone in [
        "ready to start",
        "your turn whenever you like",
        "working now",
        "no replies yet",
        "reply",
    ] {
        assert!(!idle.contains(gone), "'{gone}' is still on the board: {idle}");
    }
}

/// R3-14. Eleven of eight. The count is measured against a TRIGGER, and a turn
/// can push a window past it — compaction is checked before a model call, and
/// skipped entirely when no summarizer is loaded — so the fraction has to stop
/// claiming to be a capacity.
#[test]
fn the_memory_line_stops_pretending_the_trigger_is_a_ceiling() {
    let app = booted();
    // Eleven entries against a trigger of four — the shape the walk found, and
    // reachable whenever a summarisation is skipped or fails.
    core::report_memory(&mut app.borrow_mut(), "researcher", 11, None);
    let html = chat_with(&app, "researcher");
    assert!(!html.contains("of 4 entries"), "a count past its own trigger: {html}");
    assert!(
        html.contains("entries, past the 4 that triggers one"),
        "over the mark, said in words: {html}"
    );
    // …and WHOSE rule it is, because the numbers differ per agent.
    assert!(html.contains("agent file compacts at 4 entries"), "{html}");
}

/// R3-14, the other half: it is no longer the first thing in the conversation.
/// Nothing is cut — it is inside the disclosure that already carries where this
/// agent came from, which is the same press.
#[test]
fn the_working_memory_line_is_behind_the_identity_disclosure() {
    let app = booted();
    let html = chat(&app);
    let (before, _) = html
        .split_once(r#"<span class="wm-count""#)
        .expect("the line is still rendered, in full");
    assert!(
        before.contains(r#"<details class="agent-identity""#),
        "it opens the transcript again: {html}"
    );
    assert!(
        // `chat-log` is `chat-log-{who}` since THREADS.md §7; the prefix is
        // what this asserts about, so it stops at the name.
        !before.contains(r#"<div id="chat-log"#),
        "it must be above the log, not inside the conversation: {html}"
    );
}

/// R3-17. The trace is in the side panel, not "below"; and a notice that is not
/// speech says so, in the same slot every other line uses for a speaker.
#[test]
fn notices_are_attributed_and_point_at_where_the_trace_actually_is() {
    let app = booted();
    let html = chat(&app);
    assert!(!html.contains("see the tool trace below"), "{html}");
    assert!(
        html.contains(r#"<span class="speaker">Note: </span>"#),
        "an unattributed line in a column where everything else has one: {html}"
    );
}
