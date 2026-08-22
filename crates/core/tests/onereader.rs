//! ONE READING OF ONE ARGUMENT, on both sides of the log (I3, I8).
//!
//! The executor and the projection are handed the same bytes — the JSON a model
//! wrote — and each has to get one field out of it. `context::Args` ended the
//! sixteen hand-rolled readings on the INVOKE path; five survived on the
//! PROJECTION path, and two of them disagreed with the executor about what the
//! argument said. This file is the gate for that: every test here is a fact the
//! executor and the pane must agree on, written so that a reader that re-decides
//! trimming on its own turns it red.
//!
//! The disagreement it was written for, measured before the fix:
//! `start_process({"name": " web "})` created `.harness/proc/web` — the executor
//! reads the name through `agent::process_name`, which trims — while the
//! Processes pane, reading the same fact with a hand-rolled `v.get("name")`,
//! named the process `" web "`. Two answers to one question, and the pane's Stop
//! button pointed at a directory that never existed.

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
const ROOT: &str = "/root/spaces/research";

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

fn body(app: &Rc<RefCell<App>>, path: &str) -> String {
    handle(&mut app.borrow_mut(), Request::get(path)).body
}

fn with_app(app: &Rc<RefCell<App>>, path: &str) -> String {
    handle(
        &mut app.borrow_mut(),
        Request::get(path).with_header("x-app-activity", "1"),
    )
    .body
}

/// THE LIVE DIVERGENCE. A process name with space around it is ONE process, and
/// the pane must name it the way the workspace does — a row naming
/// `" web "` while `.harness/proc/web` is what exists is a row whose Stop button
/// can never reach the thing it points at.
///
/// Observed red before the fix (`crates/core/src/proc/rows.rs:42` read
/// `v.get("name")` with no trim):
/// `the pane names what the workspace made: … data-lost="1" … " web  was
/// started here, and nothing is left of them."`
#[test]
fn a_padded_process_name_is_one_process_in_the_pane_and_on_disk() {
    let shell = Rc::new(FakeShell::new().answering("mkdir -p", 0, "RUNNING 142\n"));
    let app = booted(
        &[
            r#"start_process({"name": " web ", "command": "sleep 900"})"#,
            "It is up.",
        ],
        Rc::clone(&shell),
    );
    ask(&app, "serve this folder");

    // What the EXECUTOR made: `agent::process_name` trims, so the directory is
    // `web` and there is no other candidate.
    let (_, command) = shell.ran().into_iter().next().expect("one command ran");
    assert!(command.contains("d='.harness/proc/web'"), "the directory is trimmed: {command}");

    // …and what the PANE says. The listing comes back empty (this engine loses
    // `.harness/proc` on a reload), so the pane names what was started — which
    // is where the two readings meet.
    handle(&mut app.borrow_mut(), Request::post_form("/processes", &[]));
    block_on(drive(Rc::clone(&app))).expect("the listing runs");
    let panel = body(&app, "/processes");
    assert!(panel.contains("data-lost=\"1\""), "one process was started: {panel}");
    assert!(
        panel.contains("web was started here"),
        "the pane names what the workspace made: {panel}"
    );
}

/// THE PRESS AND THE CALL ARE ONE GESTURE. A person pressing Stop on a row is
/// matched to the `stop_process` that follows it BY NAME
/// (`trace/requested_by.rs`), and the two sides of that match must read the name
/// the same way. This is the positive control for that fix: trim the call's name
/// without trimming the queued press and the trace files a person's press under
/// the agent — observed red as `assertion failed: trace.contains("you ran")`.
#[test]
fn a_stop_pressed_on_a_padded_name_is_still_the_persons() {
    let shell = Rc::new(
        FakeShell::new()
            .answering("for p in", 0, "web\trunning\t142\t192\tsleep 900\n")
            .answering("kill $c", 0, "STOPPED 142\n"),
    );
    let app = booted(&[], Rc::clone(&shell));

    handle(&mut app.borrow_mut(), Request::post_form("/processes", &[("stop", " web ")]));
    block_on(drive(Rc::clone(&app))).expect("the stop runs");

    let ran = shell.ran();
    assert!(
        ran.iter().any(|(_, c)| c.contains("d='.harness/proc/web'")),
        "the workspace stopped the trimmed name: {ran:?}"
    );
    let trace = with_app(&app, "/tools");
    assert!(trace.contains("stop_process"), "{trace}");
    assert!(trace.contains("you ran"), "the press is a person's: {trace}");
}

/// A PADDED PATH IS THE SAME FOLDER. The gate reads `path` through
/// `agent::relative_path`, which trims; a pane that re-decides reads a listing
/// of `" notes "` — a folder no call ever made — and then hides it from the
/// pane scoped to `notes`, because `x-at` matches on that string.
///
/// Observed red before the fix (`crates/core/src/files/listing.rs:13`):
/// `the pane is on the folder the workspace listed: … data-path=" notes "`.
#[test]
fn a_padded_path_is_the_folder_the_workspace_listed() {
    let shell = Rc::new(FakeShell::holding(&[(&format!("{ROOT}/notes/today.md"), "hello")]));
    let app = booted(&[r#"list_files({"path": " notes "})"#, "One file."], Rc::clone(&shell));
    ask(&app, "what is in notes");

    let pane = body(&app, "/files");
    assert!(pane.contains("data-path=\"notes\""), "the pane is on the folder the workspace listed: {pane}");
    // …and the pane SCOPED to that folder still sees it: `x-at` is compared
    // against this same reading, so a padded one made the listing invisible.
    let scoped = handle(
        &mut app.borrow_mut(),
        Request::get("/files").with_header("x-at", "notes"),
    )
    .body;
    assert!(scoped.contains("data-entries"), "the scoped pane sees the listing: {scoped}");
}

/// A TYPED COMMAND IS ONE ROW, AND IT IS THE PERSON'S. `exec`'s `command` is
/// read as a NAME by the gate (blank is refused, and a shell does not care about
/// the space around it), so the scrollback and the trace must read it that way
/// too — one reading, one row, one owner. The control here is the same shape as
/// the stop's: trim one side of the match and the person's own command comes
/// back attributed to `main`.
#[test]
fn a_padded_typed_command_is_one_row_and_the_persons() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(&[], Rc::clone(&shell));

    handle(
        &mut app.borrow_mut(),
        Request::post_form("/terminal", &[("command", "  ls -l  ")]),
    );
    block_on(drive(Rc::clone(&app))).expect("the command runs");

    let ran = shell.ran();
    assert_eq!(ran.len(), 1, "{ran:?}");
    assert_eq!(ran[0].1, "ls -l", "the workspace was given the trimmed command");

    // The scrollback is where an `exec` lands: one row, and it is the person's.
    let scrollback = body(&app, "/terminal");
    assert_eq!(scrollback.matches("term-command").count(), 1, "one row: {scrollback}");
    assert!(scrollback.contains("you ran"), "the command is the person's: {scrollback}");
    assert!(scrollback.contains(">ls -l<"), "the row shows what ran: {scrollback}");
}

/// WHAT STOPS THE SIXTH ONE. Four sites agreeing is not a property; it is a
/// coincidence with a good record, and the record is what this test replaces.
///
/// The shape every divergent reader had was the same one:
/// `serde_json::from_str::<serde_json::Value>(args)` — a TOOL CALL'S ARGUMENTS
/// parsed into an untyped `Value` so that one key could be pulled out of it by
/// hand. That shape is what re-decides, silently, what a missing key and a
/// blank value mean, and it is what `context::Args` exists to end. So the rule
/// is about the shape rather than about a list of key names: names travel in
/// event payloads too (`failure::from_worker` reads an `agent` key that has
/// nothing to do with a tool), and a gate that fired on those would be turned
/// off within a week.
///
/// ONE EXEMPTION, and it is exempt for a reason a reader can check rather than
/// because it was there first: `trace/row/args.rs` renders EVERY key of an
/// arbitrary call for a person to read, so it names no argument at all — which
/// the second half of this test asserts. A site that reads every key cannot
/// disagree with the executor about one; a site that names one can.
///
/// THE CEILING, WRITTEN DOWN RATHER THAN LEFT TO LOOK GUARDED (I17). This reads
/// text, not syntax: it catches the shape every one of the five had — a
/// parameter called `args`/`args_json` parsed into a `Value` — and it would miss
/// the same defect written through a differently named binding. What would
/// settle it is a lint over the parsed crate rather than over its bytes, and
/// this tree has no such pass. Measured against `3033672`, the commit before the
/// fix, this rule found exactly five sites: the four converted here and the
/// display one exempted above.
#[test]
fn nothing_reads_a_tool_calls_arguments_by_hand_any_more() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crates/")
        .to_path_buf();
    let mut found: Vec<String> = Vec::new();
    for crate_name in ["core", "agent"] {
        for (path, text) in sources(&root.join(crate_name).join("src")) {
            for (n, line) in text.lines().enumerate() {
                if line.trim_start().starts_with("//") {
                    continue; // a comment about the defect is not the defect
                }
                if line.contains("serde_json::Value>(args") || line.contains("Value>(args") {
                    found.push(format!("{path}:{}", n + 1));
                }
            }
        }
    }
    assert_eq!(
        found.len(),
        1,
        "a tool call's arguments are read through context::Args, never by hand: {found:?}"
    );
    assert!(found[0].contains("trace/row/args.rs"), "the one exemption is the display one: {found:?}");

    // …and the exemption stays generic. The moment it names an argument it is
    // a sixth reader of that argument, whatever file it lives in.
    let display = std::fs::read_to_string(root.join("core/src/trace/row/args.rs")).expect("read");
    for line in display.lines().filter(|l| !l.trim_start().starts_with("//")) {
        assert!(
            !line.contains("get(\""),
            "the display reader names no argument: {line}"
        );
    }
}

/// Every `.rs` file under one source tree, as `(path, contents)`.
fn sources(dir: &std::path::Path) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else { return out };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            out.extend(sources(&path));
        } else if path.extension().is_some_and(|e| e == "rs") {
            let text = std::fs::read_to_string(&path).unwrap_or_default();
            out.push((path.display().to_string(), text));
        }
    }
    out
}

/// AND THE PANE DOES NOT GUESS EITHER. The gate refuses a file tool that names
/// no path — *"no path given, and this tool will not guess one"*
/// (`crates/core/src/workspace/gate/files.rs:41`) — so a projection still
/// answering `"."` for that call would put the workspace root on screen as the
/// folder that was listed, for a listing that never ran. One decider, and it is
/// the gate.
#[test]
fn a_call_that_named_no_path_puts_no_folder_on_the_pane() {
    let shell = Rc::new(FakeShell::holding(&[(&format!("{ROOT}/secret.md"), "the workspace")]));
    let app = booted(&[r#"list_files({})"#, "I will name a path."], Rc::clone(&shell));
    ask(&app, "look around");

    let pane = body(&app, "/files");
    assert!(!pane.contains("data-path=\".\""), "no folder was listed: {pane}");
    assert!(!pane.contains("secret.md"), "and nothing of the root is on screen: {pane}");
}
