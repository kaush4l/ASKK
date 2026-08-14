//! Increment 12's two honesty findings, as host behaviour (I3) — no browser,
//! no Wasm, no selected tab.
//!
//! 1. The board said "working" for two minutes after that turn
//!    had failed, whenever the agent that moved was not the one on screen. The
//!    UI half is that `AgentBoard` now keeps the page's only clock; the HOST
//!    half is that the board projection has to SAY it is not final, for any
//!    agent, so something can know to ask again. That signal is `x-watch`.
//! 2. Provenance lived five thousand pixels from the agent you were using. The
//!    chat projection now carries the same origin sentence the Agents panel
//!    does, from the same function, so they cannot disagree.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
use core::{boot, handle, install_agents, report_agent, App, Ports};
use kernel::{Request, Response, Status, Timestamp};

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

fn shipped() -> Vec<(String, String)> {
    let file = |name: &str, desc: &str| {
        (
            name.to_string(),
            format!("---\nname: {name}\ndescription: {desc}\ntools: []\n---\nbody"),
        )
    };
    vec![
        file("main", "the shipped lead"),
        file("summarizer", "condenses a history"),
    ]
}

fn booted() -> Rc<RefCell<App>> {
    let mut app = block_on(boot(Ports {
        model: Rc::new(ScriptedModel::with_replies(Vec::new())),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    }))
    .expect("boot succeeds");
    install_agents(&mut app, shipped());
    Rc::new(RefCell::new(app))
}

/// The board, asked the way a page whose SELECTED agent is `main` asks it.
/// `x-agent` rides on the request precisely to prove the board ignores it: a
/// projection of every agent's status cannot be scoped to one of them.
fn board(app: &Rc<RefCell<App>>) -> Response {
    handle(
        &mut app.borrow_mut(),
        Request::get("/board").with_header("x-agent", "main"),
    )
}

fn watching(res: &Response) -> bool {
    res.headers.iter().any(|(k, _)| k == "x-watch")
}

/// The finding itself. `summarizer` is never the selected agent here, and its
/// whole life still has to reach the board: not final while it is coming up,
/// not final while it is inside a turn, final the moment it settles — and the
/// failure has to REPLACE the working row, not sit behind it.
#[test]
fn a_turn_on_an_unselected_agent_is_visible_and_says_keep_asking() {
    let app = booted();
    report_agent(&mut app.borrow_mut(), "summarizer", Status::Starting, "");
    assert!(watching(&board(&app)), "a Worker coming up is not a final board");

    report_agent(&mut app.borrow_mut(), "summarizer", Status::Idle, "");
    assert!(!watching(&board(&app)), "an idle page must stop asking");

    report_agent(&mut app.borrow_mut(), "summarizer", Status::Working, "");
    let res = board(&app);
    assert!(
        watching(&res),
        "a turn on ANY agent leaves the board not final: {:?}",
        res.headers
    );
    assert!(res.body.contains("working"), "{}", res.body);

    report_agent(
        &mut app.borrow_mut(),
        "summarizer",
        Status::Failed,
        "the model endpoint refused",
    );
    let res = board(&app);
    assert!(!watching(&res), "a settled board must stop the clock");
    assert!(
        !res.body.contains("working"),
        "the failed turn still read as working: {}",
        res.body
    );
    assert!(res.body.contains("the model endpoint refused"), "{}", res.body);
}

/// `x-busy` is the sentence under the board ("an agent is working…"), `x-watch`
/// is the instruction to ask again. They are not the same question: a Worker
/// still starting is not busy, and the board is still not final.
#[test]
fn starting_is_not_busy_but_is_still_worth_watching() {
    let app = booted();
    report_agent(&mut app.borrow_mut(), "summarizer", Status::Starting, "");
    let res = board(&app);
    assert!(watching(&res));
    assert!(
        !res.headers.iter().any(|(k, _)| k == "x-busy"),
        "starting is not working: {:?}",
        res.headers
    );
}

/// Provenance at the point of use: the conversation itself says who wrote the
/// agent you are talking to, and what its space granted. A model-authored
/// agent with a `space:` is a real root shell, and the sentence used to live
/// only in a panel five thousand pixels below.
#[test]
fn the_conversation_says_who_wrote_this_agent_and_what_it_can_reach() {
    let app = booted();
    let file = "---\nname: prober\ndescription: pokes at things\nspace: research\n---\nBODY";
    core::report_authored(&mut app.borrow_mut(), "prober", file, "author");

    let chat = handle(
        &mut app.borrow_mut(),
        Request::get("/chat").with_header("x-agent", "prober"),
    )
    .body;
    assert!(
        chat.contains("Written by the author agent, in this browser"),
        "the model wrote this agent and the chat must say so: {chat}"
    );
    assert!(
        chat.contains("Its shell is a full one"),
        "a space grant is a root shell and the chat must say so: {chat}"
    );
    assert!(
        chat.contains(r#"data-origin="authored-by-agent""#),
        "the origin is also an attribute, so a skin can mark it: {chat}"
    );

    // A shipped agent says the other thing, in the same place.
    let chat = handle(
        &mut app.borrow_mut(),
        Request::get("/chat").with_header("x-agent", "main"),
    )
    .body;
    assert!(chat.contains("Shipped with this site"), "{chat}");
    assert!(chat.contains("Its file names no space, so it has no folder"), "{chat}");
}
