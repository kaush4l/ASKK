//! R16-P1-1 AND R16-P1-2: WHAT THE SUMMARIES SAY ABOUT FACTS THEY ALREADY HOLD.
//!
//! Measured in a browser against the local model on the app's OWN first example
//! prompt — *"Write a file called notes.md…"*. The model wrote the call with its
//! own closing text swallowed, `Toolbox::check` refused it (R14-P0-2), the model
//! read the refusal and wrote the call again, and the retry landed the file.
//! That is the loop working exactly as designed.
//!
//! Three surfaces called it a failure anyway:
//!
//! - Dashboard: `main finished "…" …and a tool call in that turn failed`
//! - the board: `main ready · 1 turn — a tool call in that turn failed`
//! - Chat: `main is calling write_file — 1 call failed`
//!
//! …over a reply saying the file was written, and a file that was there. The
//! Tool trace, one click away, already labelled the second call `ok, and this is
//! the retry after the refused call` — off `vouch::Retries`. The fact was in the
//! app; three summaries did not read it, and only the detail view retracted the
//! alarm, which teaches a reader that the agent lies when it does not.
//!
//! And the ONE warning that was right — `Tool trace cannot vouch for 2 of them;
//! anything below is the model's own words`, over a reply claiming a word count
//! across three files having created one — was unreadable: two of what, why can
//! it not, and do what about it.

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

/// The call the model really wrote, with its own `"})` inside the argument.
const SWALLOWED: &str = r#"write_file({"path": "notes.md", "contents": "\"- I can perform research.\\n- I can run shell commands.\"})"})"#;
/// …and the one it wrote after reading the refusal.
const RETRY: &str =
    "write_file({\"path\": \"notes.md\", \"contents\": \"- research\\n- files and shell\\n\"})";

fn booted(replies: &[&str], shell: Rc<FakeShell>) -> Rc<RefCell<App>> {
    let ports = Ports {
        model: Rc::new(ScriptedModel::with_replies(
            replies.iter().map(|r| ScriptedModel::text_reply(r)).collect(),
        )),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: shell,
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

/// R16-P1-1. All three surfaces, on the turn that recovered.
#[test]
fn a_refusal_the_model_retried_is_reported_as_a_recovery_on_every_surface() {
    let app = booted(
        &[SWALLOWED, RETRY, "I wrote notes.md."],
        Rc::new(FakeShell::new()),
    );
    ask(&app, "Write a file called notes.md in the workspace with three bullet points");

    // The trace is unchanged and still holds both halves: a red refusal, and
    // the retry marked as the call that cleared it.
    let trace = body(&app, "/tools");
    assert!(trace.contains("data-outcome=\"failed\""), "the refusal is still shown: {trace}");
    assert!(trace.contains("the retry after the refused call"), "{trace}");

    // THE THREE SUMMARIES. Same clause on each, because there is one clause
    // (`failed::note`): the board row wears it, the Dashboard card renders the
    // row's own `data-line`, and Chat's announcement reads the same function.
    const SAID: &str = "a tool call was refused and the retry after it worked";
    for (view, page) in [("board", body(&app, "/board")), ("chat", body(&app, "/chat"))] {
        assert!(page.contains(SAID), "{view} says what happened: {page}");
        assert!(!page.contains("call failed"), "{view} does not cry failure: {page}");
        assert!(!page.contains("calls in that turn failed"), "{view}: {page}");
    }
    // The Dashboard's launch card is `runstatus.rs` rendering the row's own
    // `data-line` verbatim, so this is the string it puts on screen.
    let board = body(&app, "/board");
    let line = board.split("data-line=\"").nth(1).and_then(|r| r.split('"').next());
    assert!(line.unwrap_or_default().contains(SAID), "the card's line: {board}");

    // …AND THE TENSE (R16-P1-1). `main is calling write_file` on a turn that
    // is over. The announcement is written only after the run has ended.
    let chat = body(&app, "/chat");
    assert!(chat.contains("main called write_file"), "{chat}");
    assert!(!chat.contains("is calling"), "no present continuous on a finished run: {chat}");
}

/// R16-P1-2. The doubt says what it saw, why it cannot stand behind it, and the
/// one thing the reader can do — and it does NOT say the calls are absent from
/// the trace, which is not what `vouch::doubt` checks.
#[test]
fn the_warning_that_was_right_says_which_calls_and_why_and_what_to_do() {
    let shell = Rc::new(FakeShell::new().answering("wc", 0, ""));
    let app = booted(
        &[
            r#"exec({"command": "wc -w one.md two.md three.md"})"#,
            "The total word count across the three files is 14 words.",
        ],
        shell,
    );
    ask(&app, "how many words in the three files");

    let chat = body(&app, "/chat");
    assert!(!chat.contains("cannot vouch for"), "the undecodable line is gone: {chat}");
    assert!(chat.contains("1 call came back ok, but its own record does not back it"), "{chat}");
    assert!(chat.contains("a command printed"), "…and why: {chat}");
    assert!(
        chat.contains("Check the Tool trace before you trust the answer below"),
        "…and what to do about it: {chat}"
    );
    // It never promises the call is missing from the trace: it is there.
    assert!(!chat.contains("not in the Tool trace"), "{chat}");
    assert!(!chat.contains("may not have happened"), "{chat}");
    let trace = body(&app, "/terminal");
    assert!(trace.contains("ok, and it printed nothing"), "the row is still there: {trace}");
}
