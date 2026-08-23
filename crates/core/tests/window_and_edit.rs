//! **THE ENVIRONMENT STOPS LOSING WORK, DRIVEN END TO END** (roadmap increment
//! 3). Two capabilities, and each is asserted against what the PORT was really
//! asked to do rather than against the sentence describing it (I16/I17).
//!
//! - A WINDOWED READ. `read_file` with `offset`/`limit` must reach the guest as
//!   a real byte range, cut with applets `agent::environment::BINARIES`
//!   declares, with the file's size measured by `wc -c` instead of by shipping
//!   the file. A window sliced in Rust after a whole-file `cat` would satisfy
//!   any assertion about the ANSWER and none about the cost, which is the
//!   entire point on a file too big for the 180 s watchdog to transfer.
//! - A CHECKED EDIT. `write_file` was the only way to change a file, so
//!   altering one line meant re-emitting every other line from the model's
//!   memory — and this guest keeps nothing across a reload
//!   (`agent::GUEST_DURABLE`), so a line the model dropped is gone. The rule is
//!   that the named text occurs EXACTLY ONCE, and the failure mode being pinned
//!   here is the dangerous one: an ambiguous edit must write NOTHING.

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

/// **THE WINDOW IS CUT IN THE GUEST, NOT IN RUST.** The assertion is on the
/// COMMAND the port was handed, because that is the only thing that
/// distinguishes a real window from a `cat` sliced afterwards — and the
/// difference between them is the whole capability.
#[test]
fn a_windowed_read_reaches_the_guest_as_a_real_byte_range() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(
        &[
            r#"read_file({"path": "build.log", "offset": 4000, "limit": 800})"#,
            "That is the middle of the log.",
        ],
        Rc::clone(&shell),
    );
    ask(&app, "read the middle of build.log");

    let ran = shell.ran().iter().map(|(_, c)| c.clone()).collect::<Vec<_>>().join("\n");
    // `tail` counts from ONE, so byte 4000 is `+4001`. Off by one here is a
    // window that silently starts in the wrong place.
    assert!(ran.contains("tail -c +4001 -- 'build.log'"), "no real range was cut: {ran}");
    assert!(ran.contains("head -c 800"), "the limit never reached the guest: {ran}");
    // THE SIZE IS MEASURED, NOT READ. `wc -c` is the difference between a
    // window that costs 800 bytes and one that costs the whole file.
    assert!(ran.contains("wc -c < 'build.log'"), "the size was not measured: {ran}");
    assert!(!ran.contains("cat -- 'build.log'"), "the whole file was shipped anyway: {ran}");
    // …and the model is told what it is holding, generated beside the number
    // that only the guest has.
    assert!(ran.contains("up to 800 bytes starting at byte 4000"), "unstated window: {ran}");
    // …and the sentence NAMES ITSELF, because every other byte in that field is
    // something the guest printed and `[WINDOW: …]` is a line a file could hold.
    assert!(ran.contains("THE HARNESS READ A WINDOW"), "the window is unattributed: {ran}");
    // EVERY APPLET IN THE COMMAND IS DECLARED (I16). `dd` and `sed -n` — which
    // the plan for this increment named — are in neither this guest nor this
    // command, and that is checked rather than remembered.
    for name in ["tail", "head", "wc", "tr", "printf"] {
        assert!(agent::GUEST_BINARIES.contains(&name), "the window uses undeclared `{name}`");
    }
}

/// …AND A READ THAT ASKS FOR NO WINDOW IS THE COMMAND THIS PORT ALWAYS RAN.
/// One reader: the window is a request, not a second door, and a `read_file`
/// that names no range must not start paying for one.
#[test]
fn a_read_with_no_window_asked_for_still_goes_through_the_adapters_own_read() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(
        &[
            r#"write_file({"path": "notes.md", "contents": "hi there"})"#,
            r#"read_file({"path": "notes.md"})"#,
            "Read it.",
        ],
        Rc::clone(&shell),
    );
    ask(&app, "read notes.md");

    // THE BYTES, NOT A COMMAND. `WorkspacePort::read` is overridable and
    // `FakeShell` overrides it; routing every `read_file` through `read_range`
    // walked past that override and the files pane started displaying
    // `ran: cat -- 'hello.txt'` where the file's contents belong
    // (`crates/core/tests/files.rs:120` is where that landed). This is the
    // assertion that keeps `read` in play when no window was asked for.
    let trace = body(&app, "/tools");
    assert!(trace.contains("hi there"), "the adapter's own read was bypassed: {trace}");
    let ran = shell.ran().iter().map(|(_, c)| c.clone()).collect::<Vec<_>>().join("\n");
    assert!(!ran.contains("wc -c"), "an unasked-for window was performed: {ran}");
    assert!(!ran.contains("WINDOW"), "an unasked-for window was announced: {ran}");
}

/// **AN AMBIGUOUS EDIT WRITES NOTHING.** The file is seeded through the
/// product's own `write_file` so no test invents a path rule, then an
/// `edit_file` names text that is in it TWICE.
///
/// What is pinned is that the bytes on the fake disk are UNCHANGED. A
/// replace-the-first-hit implementation would leave a plausible file behind and
/// report success, and the agent would have no way to learn it had edited the
/// wrong line — which is the silent-corruption failure this rule exists for.
#[test]
fn an_edit_that_names_two_places_changes_nothing_and_says_which_two() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(
        &[
            r#"write_file({"path": "app.py", "contents": "log(x)\nrun()\nlog(x)\n"})"#,
            r#"edit_file({"path": "app.py", "find": "log(x)", "replace": "quiet(x)"})"#,
            "I could not tell which one you meant.",
        ],
        Rc::clone(&shell),
    );
    ask(&app, "silence the logging in app.py");

    let files = shell.files();
    let (_, on_disk) = files.iter().find(|(p, _)| p.ends_with("app.py")).expect("the seed landed");
    assert_eq!(on_disk, "log(x)\nrun()\nlog(x)\n", "an ambiguous edit wrote to the file");

    let trace = body(&app, "/tools");
    assert!(trace.contains("app.py is unchanged"), "the refusal never reached a surface: {trace}");
    assert!(trace.contains("2 times"), "the refusal does not say how many: {trace}");
}

/// …AND AN UNAMBIGUOUS ONE LANDS, leaving every other byte exactly as it was.
/// Without this the rule above is satisfiable by a tool that never edits
/// anything (T59): the two tests are each other's control.
#[test]
fn an_edit_that_names_one_place_changes_that_place_and_nothing_else() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(
        &[
            r#"write_file({"path": "app.py", "contents": "log(x)\nrun()\nkeep()\n"})"#,
            r#"edit_file({"path": "app.py", "find": "run()", "replace": "run(fast=True)"})"#,
            "Done.",
        ],
        Rc::clone(&shell),
    );
    ask(&app, "make run fast in app.py");

    let files = shell.files();
    let (_, on_disk) = files.iter().find(|(p, _)| p.ends_with("app.py")).expect("the seed landed");
    assert_eq!(on_disk, "log(x)\nrun(fast=True)\nkeep()\n", "the edit was not surgical");
    let trace = body(&app, "/tools");
    assert!(trace.contains("at line 2"), "a landed edit says where it landed: {trace}");
}
