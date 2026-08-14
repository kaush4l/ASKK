//! THE VERIFY GATE, ON THE THREE SURFACES THAT FOLD AN ENDING.
//!
//! `crates/agent/tests/verify.rs` pins the machine — held, nudged, landed. This
//! pins what a person is shown, which is the half eighteen rounds of critique
//! kept finding wrong: the board row, and the conversation.
//!
//! THE WORD `verified` DOES NOT APPEAR IN ANY OF IT, and this file asserts that
//! directly. A green command is evidence about a command, never proof about a
//! change, and a badge claiming otherwise would be the worst regression
//! available here.

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

const MAIN: &str = "---\nname: main\ndescription: the lead\ntools: []\nspace: research\n---\nbody";

fn booted(replies: &[&str]) -> Rc<RefCell<App>> {
    let ports = Ports {
        model: Rc::new(ScriptedModel::with_replies(
            replies.iter().map(|r| ScriptedModel::text_reply(r)).collect(),
        )),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents(&mut app, vec![("main".to_string(), MAIN.to_string())]);
    Rc::new(RefCell::new(app))
}

fn ask(app: &Rc<RefCell<App>>, message: &str) {
    handle(&mut app.borrow_mut(), Request::post_form("/chat", &[("message", message)]));
    block_on(drive(Rc::clone(app))).expect("the turn runs");
}

fn body(app: &Rc<RefCell<App>>, path: &str) -> String {
    handle(&mut app.borrow_mut(), Request::get(path)).body
}

const WRITE: &str = r#"write_file({"path": "notes.md", "content": "hello"})"#;
const CAT: &str = r#"exec({"command": "cat notes.md"})"#;

/// A file written, an answer given, and nothing run in between. The turn is
/// asked twice, the answer still lands, and BOTH surfaces say the same thing
/// about it — in the words of what was observed.
#[test]
fn a_write_nobody_read_back_ends_answered_unchecked() {
    let app = booted(&[WRITE, "Done — I wrote notes.md.", "Done.", "Done."]);
    ask(&app, "write notes.md");

    let chat = body(&app, "/chat");
    assert!(
        chat.contains("It changed a file and nothing had run since"),
        "the round the machine added is visible as the machine's: {chat}"
    );
    assert!(
        chat.contains("no command ran afterwards, so nothing here can say whether it worked"),
        "and the ending says what is not known: {chat}"
    );

    let board = body(&app, "/board");
    assert!(board.contains("answered, unchecked"), "the row's word: {board}");
    assert!(
        board.contains("cannot say whether it worked"),
        "and what to do about it: {board}"
    );

    // THE BAN, ASSERTED. Not "verified", not "unverified", not "proven".
    for page in [chat, board] {
        for banned in ["verified", "unverified", "proven"] {
            assert!(!page.to_lowercase().contains(banned), "'{banned}' is on a surface: {page}");
        }
    }
}

/// The same work with a `cat` after the write. No nudge, no second ending, and
/// the row keeps the status word it has always had.
#[test]
fn a_write_read_back_answers_with_no_nudge_at_all() {
    let app = booted(&[WRITE, CAT, "Done — notes.md holds `hello`."]);
    ask(&app, "write notes.md and check it");

    let chat = body(&app, "/chat");
    assert!(!chat.contains("nothing had run since"), "no nudge: {chat}");
    let board = body(&app, "/board");
    assert!(!board.contains("unchecked"), "and no ending word: {board}");
}
