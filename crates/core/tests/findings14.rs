//! R14-P0-2: WE DETECTED THE CORRUPTION AND WROTE IT ANYWAY.
//!
//! Measured in a browser against the local model, using the product's OWN
//! suggested prompt — *"Write a file called notes.md in the workspace with
//! three bullet points about what you can do, then tell me what you wrote"*.
//! What landed on disk was 179 bytes, md5 `e3868595e6e6e512fcf771815fec03e1`:
//!
//! ```text
//! "- I can perform research on various topics.\n- I can manage files and run shell commands in a Linux workspace.\n- I can coordinate with other agents to complete complex tasks."})
//! ```
//!
//! One line. Literal `\n`. A leading `"` and a trailing `"})` — the raw
//! un-parsed tool-argument fragment R13 had already learnt to recognise. The
//! chat said `calling write_file — Tool trace cannot vouch for 1 of them`, and
//! then the write went through, was counted a clean call, and the model's
//! success claim was passed to the person unqualified.
//!
//! R13 concluded that refusing on a heuristic would be worse than writing what
//! the model asked for. That is refuted by the bytes: they are garbage either
//! way, and a refusal the model can SEE and retry is strictly better than a
//! corrupt file plus a false success. `Toolbox::check` — the one gate every
//! model-issued call passes through, `exec` and sub-agents included — now
//! refuses on the same predicate, and the tool result carries the repair.

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

/// The 179 bytes, as the model wrote the call that produced them.
const SWALLOWED_WRITE: &str = r#"write_file({"path": "notes.md", "contents": "\"- I can perform research on various topics.\\n- I can manage files and run shell commands in a Linux workspace.\\n- I can coordinate with other agents to complete complex tasks.\"})"})"#;

/// What the same model got right in the same session, byte for byte.
const GOOD_WRITE: &str =
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

/// THE WHOLE DEFECT, END TO END, REVERSED. Nothing reaches the disk, the row
/// is a FAILURE rather than a qualified `ok`, and the refusal the model reads
/// says what was wrong with the arguments — so the second attempt lands the
/// bytes the person asked for. This is the loop working, not a wall.
#[test]
fn a_write_that_swallowed_its_own_terminator_is_refused_and_the_retry_lands() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(
        &[SWALLOWED_WRITE, GOOD_WRITE, "I wrote notes.md."],
        Rc::clone(&shell),
    );
    ask(&app, "Write a file called notes.md in the workspace with three bullet points");

    // The corrupt bytes are not on disk; the retry's are, exactly.
    let files = shell.files();
    assert_eq!(files.len(), 1, "only the good write landed: {files:?}");
    let (path, contents) = &files[0];
    assert_eq!(path, "/root/spaces/research/notes.md");
    assert_eq!(contents, "- research\n- files and shell\n", "byte for byte");
    assert!(!contents.contains("\"})"), "no un-parsed fragment reached the file");

    let trace = body(&app, "/tools");
    // The refused row is a failure, in the trace's own vocabulary.
    assert!(trace.contains("data-outcome=\"failed\""), "the refusal is a failure: {trace}");
    assert!(
        !trace.contains("ok, but the arguments end with"),
        "a call that never ran is not a qualified ok: {trace}"
    );
    // …and the refusal names the fault AND the repair, in the same words the
    // model was handed (`ToolResult::line`).
    assert!(trace.contains("Nothing ran: an argument ends with"), "{trace}");
    assert!(trace.contains("escaped one level too many"), "{trace}");
    assert!(trace.contains("write_file({&quot;path&quot;"), "the usage line rides along: {trace}");
    // The good write is plain `ok`; the predicate did not widen.
    assert!(trace.contains("data-outcome=\"ok\""), "the well-formed write is ok: {trace}");
}

/// `exec` carries the same signature (`$ "wc -l primes.txt"})` on record), so
/// it is refused on the same predicate — and an ordinary command with a quote
/// in it is NOT, which is the whole reason the predicate was never widened.
#[test]
fn exec_is_refused_on_the_same_signature_and_ordinary_quoting_still_runs() {
    let shell = Rc::new(FakeShell::new().answering("echo", 0, "hi\"})"));
    let app = booted(
        &[
            r#"exec({"command": "\"wc -l primes.txt\"})"})"#,
            r#"exec({"command": "echo 'hi\"})'"})"#,
            "Done.",
        ],
        Rc::clone(&shell),
    );
    ask(&app, "count the lines");

    let ran = shell.ran();
    assert_eq!(ran.len(), 1, "the swallowed command never reached the shell: {ran:?}");
    assert!(ran[0].1.starts_with("echo"), "only the legitimate one ran: {ran:?}");

    // IN COMMANDS, WHICH IS WHERE THE SHELL LIVES (R15-P1-4).
    let trace = body(&app, "/terminal");
    assert!(trace.contains("data-outcome=\"failed\""), "the refused exec failed: {trace}");
    assert!(trace.contains("Nothing ran: an argument ends with"), "{trace}");
    // A command whose OUTPUT happens to end in `"})` is nobody's business here:
    // the predicate reads the arguments the model wrote, never the result.
    assert!(trace.contains("data-outcome=\"ok\""), "the echo is plain ok: {trace}");
}
