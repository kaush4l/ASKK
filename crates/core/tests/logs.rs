//! Increment 08 on the host, with in-memory ports (I3): each agent's own log,
//! the rolling window, and the two properties the Python guarantees about the
//! pair — **the log mirrors the window exactly after compaction**, and **every
//! append is written before the rewrite that replaces it**.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{DenyAllNet, FixedClock, ScriptedAgents, ScriptedModel, SeededRng};
use core::{boot, drive, handle, install_agents_as, App, Ports};
use kernel::{Request, Timestamp};

mod recording;
use recording::Recording;

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

/// `main` compacts at four entries and keeps two — the frontmatter carries the
/// setting, exactly as Python forwards any `Engine` field from `agent.md`.
fn agent_files() -> Vec<(String, String)> {
    let file = |name: &str, extra: &str| {
        (
            name.to_string(),
            format!("---\nname: {name}\ndescription: {name} does a thing\ntools: []\n{extra}---\nbody"),
        )
    };
    vec![
        file("main", "compact_at: 4\nkeep_recent: 2\n"),
        file("researcher", ""),
    ]
}

fn booted_as(store: Rc<Recording>, me: &str, replies: &[&str]) -> Rc<RefCell<App>> {
    let ports = Ports {
        model: Rc::new(ScriptedModel::with_replies(
            replies.iter().map(|r| ScriptedModel::text_reply(r)).collect(),
        )),
        store,
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(adapters_test::MemKv::new()),
        workspace: Rc::new(adapters_test::FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents_as(&mut app, agent_files(), me);
    block_on(core::restore_log(&mut app)).expect("the log reads back");
    Rc::new(RefCell::new(app))
}

fn say(app: &Rc<RefCell<App>>, message: &str) {
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", message)]),
    );
    block_on(drive(Rc::clone(app))).expect("the turn drives");
}

/// Two turns take the window past `compact_at`, the summarizer's reply
/// replaces the older half, and afterwards the STORE holds exactly what the
/// agent holds — not a growing record of turns it can no longer see.
#[test]
fn the_log_mirrors_the_window_exactly_after_compaction() {
    let store = Rc::new(Recording::default());
    let app = booted_as(Rc::clone(&store), "main", &["one", "NOTES", "two"]);
    say(&app, "hi");
    say(&app, "again");

    let held = core::window(&app.borrow());
    assert!(
        held[0].contains("Summary of the conversation so far:"),
        "the window opens with the summary: {held:?}"
    );
    assert!(held[0].contains("NOTES"), "the summarizer's own words: {held:?}");
    assert_eq!(store.log("main"), held, "the log IS the window");
    assert!(
        !store.log("main").iter().any(|l| l.contains("hi")),
        "what the summary replaced is gone from the store too: {:?}",
        store.log("main")
    );
}

/// "An append scheduled before this call is a turn that belongs in the file,
/// and letting it land afterwards would put it below the summary that already
/// covers it." One ordered queue is what makes that true here.
#[test]
fn every_append_lands_before_the_rewrite_that_replaces_it() {
    let store = Rc::new(Recording::default());
    let app = booted_as(Rc::clone(&store), "main", &["one", "NOTES", "two"]);
    say(&app, "hi");
    say(&app, "again");

    let ops = store.ops.borrow().clone();
    let rewrite = ops
        .iter()
        .position(|o| o.starts_with("rewrite"))
        .expect("a compaction rewrites the log");
    assert!(
        ops[..rewrite].iter().all(|o| o.starts_with("append")),
        "every append queued before it was drained first: {ops:?}"
    );
    assert_eq!(
        ops.iter().filter(|o| o.starts_with("rewrite")).count(),
        1,
        "one compaction, one rewrite: {ops:?}"
    );
    assert_eq!(store.log("main"), core::window(&app.borrow()));
}

/// A reload is a new process but not a new conversation: the window comes back
/// out of the log, compacted exactly as it was left.
#[test]
fn a_reload_rebuilds_the_same_window_from_the_log() {
    let store = Rc::new(Recording::default());
    let before = {
        let app = booted_as(Rc::clone(&store), "main", &["one", "NOTES", "two"]);
        say(&app, "hi");
        say(&app, "again");
        let held = core::window(&app.borrow());
        held
    };
    let reloaded = booted_as(Rc::clone(&store), "main", &["three"]);
    assert_eq!(
        core::window(&reloaded.borrow()),
        before,
        "the same window, not an empty paper"
    );
}

/// Each agent's log is its own, keyed by its own name — a sub-agent's Worker
/// reads back ITS conversation and never the lead's (the open item 07 left).
#[test]
fn each_agent_writes_and_reads_its_own_log() {
    let store = Rc::new(Recording::default());
    let mine = booted_as(Rc::clone(&store), "main", &["one"]);
    say(&mine, "hi");
    assert!(!store.log("main").is_empty());
    assert!(
        store.log("researcher").is_empty(),
        "nobody else's window was written: {:?}",
        store.log("researcher")
    );

    let theirs = booted_as(Rc::clone(&store), "researcher", &["their answer"]);
    say(&theirs, "their question");
    assert!(
        store.log("researcher").iter().any(|l| l.contains("their question")),
        "the sub-agent's own log: {:?}",
        store.log("researcher")
    );
    assert_eq!(
        store.log("main"),
        core::window(&mine.borrow()),
        "and the lead's is untouched by it"
    );
}

fn chat(app: &Rc<RefCell<App>>, who: &str) -> String {
    let mut req = Request::get("/chat");
    req.headers.push(("x-agent".into(), who.to_string()));
    handle(&mut app.borrow_mut(), req).body
}

/// The memory line after a compaction, which is where four findings from the
/// increment-08 walk landed: the summary is READABLE, the count has a unit and
/// a denominator, the copy says nothing was lost, and the line is a live region
/// so the change is announced rather than silent.
#[test]
fn the_memory_line_shows_the_summary_the_denominator_and_the_reassurance() {
    let store = Rc::new(Recording::default());
    let app = booted_as(Rc::clone(&store), "main", &["one", "NOTES", "two"]);
    say(&app, "hi");
    say(&app, "again");

    let html = chat(&app, "main");
    assert!(html.contains(r#"data-compacted="true""#), "{html}");
    assert!(
        html.contains("compaction runs at 4 entries and keeps the newest 2"),
        "the number a reader can anticipate the drop from: {html}"
    );
    assert!(
        html.contains("Nothing was lost: the transcript still holds every turn"),
        "{html}"
    );
    // Announced, and only the part that MOVED: a live region around the whole
    // sentence re-read twenty words every turn to report one number (12b walk,
    // finding 3). The rule after the count is outside it.
    assert!(
        html.contains(r#"<span class="wm-count" role="status">Working memory: 4 of 4 entries</span>"#),
        "the live region is the count alone: {html}"
    );
    assert!(
        !html.contains(r#"role="status">Working memory: 4 of 4 entries — "#),
        "the rule is not inside the live region: {html}"
    );
    assert!(
        html.contains("The summary that replaced the oldest turns for main"),
        "the summary has a disclosure of its own: {html}"
    );
    assert!(
        html.contains("NOTES"),
        "…and the summarizer's actual words are inside it: {html}"
    );
}

/// A sub-agent's window lives in its Worker, so the pane prints what that
/// Worker REPORTED — and says so plainly until it has reported anything. An
/// increment about per-agent memory that showed one agent out of three is the
/// finding this closes.
#[test]
fn a_sub_agents_memory_is_what_its_worker_reported_or_plainly_unknown() {
    let store = Rc::new(Recording::default());
    let app = booted_as(Rc::clone(&store), "main", &["one"]);

    let before = chat(&app, "researcher");
    assert!(
        before.contains("researcher has not reported it yet"),
        "not silence, and not a guess: {before}"
    );

    core::report_memory(
        &mut app.borrow_mut(),
        "researcher",
        5,
        Some("system: Summary of the conversation so far:\nIT SAID THIS"),
    );
    let after = chat(&app, "researcher");
    assert!(after.contains(r#"data-window="5""#), "{after}");
    assert!(
        after.contains("the oldest turns are now a summary the summarizer wrote"),
        "{after}"
    );
    assert!(
        after.contains("compaction runs at 75 entries and keeps the newest 24"),
        "its own file's setting, not the lead's: {after}"
    );
    assert!(
        after.contains("The summary that replaced the oldest turns for researcher")
            && after.contains("IT SAID THIS"),
        "a sub-agent's summary is readable too, not only the page's: {after}"
    );
    // The lead's own line is unchanged by its sub-agent's report.
    assert!(chat(&app, "main").contains(r#"data-compacted="false""#));
}
