//! WHAT AN AGENT WRITES IS WHAT IS ON THE DISK, BYTE FOR BYTE.
//!
//! This is the regression the obvious design of the argument reader would have
//! shipped. One reader that always trims looks harmless — every other call site
//! on the invoke path wants a trimmed identifier — and it turns
//! `port.write(root, &path, contents)` in `crates/core/src/workspace/gate.rs`
//! into a filter that strips the trailing newline off EVERY FILE AN AGENT
//! WRITES. No test would have failed: nothing in this tree asserted the bytes
//! of a written file, only that a write happened. So the reader splits —
//! `Args::name` trims, `Args::text` does not — and this file is the check that
//! `contents` stays on the `text` side of it.
//!
//! POSITIVE CONTROL, RUN (I17). `Args::text` was changed to `Ok(said.trim())`
//! — the charter's original single-reader proposal, verbatim — and
//! `the_trailing_newline_of_a_written_file_survives_the_round_trip` failed on
//! the left/right of `"line one\n"` vs `"line one"`, `cargo test -p core
//! --test roundtrip` exiting 101. Restored, it passes. Without the split this
//! file is red, which is what makes it evidence rather than decoration.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
use core::{boot, drive, handle, install_agents, App, Ports};
use kernel::{Request, Timestamp, WorkspacePort};

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
const ROOT: &str = "/root/spaces/research";

/// The same harness `workspace.rs` uses: a booted app, a scripted model, and a
/// fake Linux the test holds so it can read the disk afterwards.
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
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", message)]),
    );
    block_on(drive(Rc::clone(app))).expect("the turn runs");
}

/// THE TEST THIS INCREMENT IS FOR. A model writes a file ending in a newline —
/// which is every well-formed text file — and the newline is still there, on
/// the disk and coming back out of `read_file`.
///
/// The read is taken through `WorkspacePort::read` rather than through the
/// tool's rendered output on purpose: `workspace::gate::said` trims what it
/// SHOWS, which is a formatting decision about a transcript and not about a
/// file. The claim here is about the bytes, so it is asserted where the bytes
/// are.
#[test]
fn the_trailing_newline_of_a_written_file_survives_the_round_trip() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(
        &[
            r#"write_file({"path": "notes.md", "contents": "line one\n"})"#,
            "Written.",
        ],
        Rc::clone(&shell),
    );
    ask(&app, "write the note");

    // THE WRITE. What reached the port is what the model wrote.
    assert_eq!(
        shell.files(),
        vec![(format!("{ROOT}/notes.md"), "line one\n".to_string())],
        "the trailing newline reached the disk"
    );
    // THE READ BACK, through the same tool's port call, byte-identical.
    let back = block_on(shell.read(ROOT, "notes.md")).expect("the file is there");
    assert_eq!(back.output, "line one\n", "and came back unchanged");
}

/// The machinery was ALIVE — the guard the last round's bar-raiser asked for.
/// The assertion above is about bytes that survive, but a turn where the model
/// never called the tool would leave an empty disk and a green test if the
/// vector comparison were ever weakened. So: the call is on the record, and it
/// succeeded.
#[test]
fn the_write_was_a_real_recorded_tool_call_and_not_a_turn_that_did_nothing() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(
        &[
            r#"write_file({"path": "notes.md", "contents": "line one\n"})"#,
            "Written.",
        ],
        Rc::clone(&shell),
    );
    ask(&app, "write the note");

    let calls: Vec<(String, bool)> = core::log_kinds(&app.borrow())
        .into_iter()
        .filter_map(|kind| match kind {
            kernel::EventKind::ToolInvoked { tool, ok, .. } => Some((tool.0, ok)),
            _ => None,
        })
        .collect();
    assert_eq!(
        calls,
        vec![("write_file".to_string(), true)],
        "one write_file call, and it succeeded: {calls:?}"
    );
}

/// A file whose whole content is whitespace is a file with whitespace in it.
/// `Args::text` returns it verbatim; a trimming reader would have written an
/// empty file and reported success, which is the same corruption a byte
/// quieter.
#[test]
fn a_file_written_with_nothing_but_spaces_holds_those_spaces() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(
        &[
            r#"write_file({"path": "pad.txt", "contents": "   "})"#,
            "Written.",
        ],
        Rc::clone(&shell),
    );
    ask(&app, "write the padding");

    assert_eq!(
        shell.files(),
        vec![(format!("{ROOT}/pad.txt"), "   ".to_string())],
        "three spaces, not an empty file"
    );
}

/// THE OTHER HALF OF THE SPLIT, in the same call. The PATH is an identifier and
/// IS trimmed — `agent::relative_path` has always trimmed it — so a model that
/// pads its path writes the file the model meant rather than one whose name
/// begins with a space. Same call, two arguments, two rules.
#[test]
fn the_path_is_trimmed_while_the_contents_beside_it_are_not() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(
        &[
            r#"write_file({"path": "  notes.md  ", "contents": " kept \n"})"#,
            "Written.",
        ],
        Rc::clone(&shell),
    );
    ask(&app, "write the note");

    assert_eq!(
        shell.files(),
        vec![(format!("{ROOT}/notes.md"), " kept \n".to_string())],
        "the path lost its padding and the contents kept theirs"
    );
}
