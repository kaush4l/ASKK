//! ROUND 17, THE CONTROLS: the two facts the seam owes the panes that say what
//! a stop does. The copy itself lives in `ui`, which is Dioxus and does not
//! compile on the host (I3) — but both defects were failures of FACT, and the
//! facts are here.
//!
//! P1-6. Pressing the Commands view's own Stop rendered `you ran $ sleep 40;
//! echo done — failed`, in red, over an explanation that was honest and
//! complete: *"The workspace failed: you stopped it…"*. `failed` is what
//! happens TO you, and this was a deliberate act. `trace::trustworthy::word` set the
//! precedent — `not there yet` for an outcome that is neither ok nor failed.
//!
//! P0-1. The wait row on an agent this page cannot stop sent a stuck person to
//! the Commands view for a stop that view does not have. What replaces it is
//! the agent's own `max_rounds:` — the one thing that is true of every run —
//! and this is the header the pane reads it off.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
use core::{boot, drive, handle, install_agents, App, Ports};
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

/// The two agents the wait row has to speak about: this page's own, and one
/// with no workspace at all, which is the case the false clause was shown on.
const LEAD: &str =
    "---\nname: main\ndescription: the lead\nspace: research\ntools: [exec]\nmax_rounds: 9\n---\nP";
const ALONE: &str =
    "---\nname: author\ndescription: writes agents\nspace:\ntools: []\nmax_rounds: 12\n---\nP";

fn booted(shell: Rc<FakeShell>) -> Rc<RefCell<App>> {
    let mut app = block_on(boot(Ports {
        model: Rc::new(ScriptedModel::with_replies(Vec::new())),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: shell,
        agents: Rc::new(ScriptedAgents::none()),
    }))
    .expect("boot succeeds");
    install_agents(
        &mut app,
        vec![("main".to_string(), LEAD.to_string()), ("author".to_string(), ALONE.to_string())],
    );
    Rc::new(RefCell::new(app))
}

fn body(app: &Rc<RefCell<App>>, req: Request) -> String {
    handle(&mut app.borrow_mut(), req).body
}

/// R17-P1-6. The command a person stopped, in the pane they stopped it from.
/// A stopped command ends through the same `Err` a crash arrives on, so the row
/// could only tell the two apart by the sentence the engine wrote — and it did
/// not try.
#[test]
fn a_command_you_stopped_is_stopped_and_not_failed() {
    let app = booted(Rc::new(FakeShell::new().failing(
        "sleep 40",
        "You stopped it, and this Linux really interrupted the command; the shell recovered.",
    )));
    body(&app, Request::post_form("/terminal", &[("command", "sleep 40; echo done")]));
    let _ = block_on(drive(Rc::clone(&app)));
    let pane = body(&app, Request::get("/terminal"));

    assert!(pane.contains("sleep 40; echo done"), "the command is on the row: {pane}");
    // THE WORD. Beside the colour and never instead of it, the R3-18 rule.
    assert!(pane.contains("— stopped"), "a stop you asked for is stopped: {pane}");
    assert!(!pane.contains("— failed"), "…and is not called a failure: {pane}");
    // THE COLOUR. `term-run error` is the red one; this row is the plain one.
    assert!(!pane.contains("term-run error"), "…and is not painted red: {pane}");
    assert!(pane.contains("data-outcome=\"stopped\""), "{pane}");
    // THE LEAD. The explanation was never the problem; the sentence in front
    // of it was, and it no longer opens by calling the workspace broken.
    assert!(pane.contains("You stopped it, and this Linux really interrupted"), "{pane}");
    assert!(!pane.contains("The Linux failed:"), "{pane}");
    // …and it is still our prose, so it still wraps (R12-4).
    assert!(pane.contains("<pre class=\"said\""), "{pane}");
}

/// …and a command that really broke is still a failure, in red. The predicate
/// keys on the engines' own opening, so a timeout — which c2w reports through
/// the same `Err` — keeps every word it had.
#[test]
fn a_command_that_really_failed_is_still_a_failure() {
    let app = booted(Rc::new(FakeShell::new().failing(
        "sleep 40",
        "no answer in 300s, so the command was interrupted; the shell recovered",
    )));
    body(&app, Request::post_form("/terminal", &[("command", "sleep 40; echo done")]));
    let _ = block_on(drive(Rc::clone(&app)));
    let pane = body(&app, Request::get("/terminal"));
    assert!(pane.contains("— failed"), "a timeout is a failure: {pane}");
    assert!(pane.contains("term-run error"), "…and is red: {pane}");
    assert!(pane.contains("The Linux failed: no answer in 300s"), "{pane}");
}

/// R17-P0-1. The wait row could say only "the Commands view can stop it",
/// which is false on an agent with no workspace and false on the engine that
/// cannot signal a running command. What is true of every run is the ceiling
/// in that agent's own file, and the pane reads it here.
#[test]
fn the_conversation_carries_the_agents_own_step_ceiling() {
    let app = booted(Rc::new(FakeShell::new()));
    let ceiling = |who: &str| {
        handle(&mut app.borrow_mut(), Request::get("/chat").with_header("x-agent", who))
            .headers
            .iter()
            .find(|(k, _)| k == "x-max-rounds")
            .map(|(_, v)| v.clone())
    };
    // The workspace-less agent — the one the false clause was shown on.
    assert_eq!(ceiling("author").as_deref(), Some("12"), "author's own file");
    // …and it is the AGENT'S number, not one wording for the whole page.
    assert_eq!(ceiling("main").as_deref(), Some("9"), "main's own file");
}
