//! THE ENVIRONMENT TOOLS, on the host with no browser and no Linux (I3).
//!
//! `workspace.rs` proves the four original tools; this proves the six that turn
//! a one-shot shell into somewhere an agent can live: start something that
//! outlives the call, watch it, read it, stop it, ask what the machine is, and
//! find a file. Every one of them is `WorkspacePort::exec` underneath, so
//! `FakeShell` is the whole substrate — what the real container2wasm guest
//! does with the command is the browser's business.

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
const ALONE: &str = "---\nname: main\ndescription: the lead\ntools: []\n---\nbody";

fn booted(replies: &[&str], file: &str, shell: Rc<FakeShell>) -> Rc<RefCell<App>> {
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
    install_agents(&mut app, vec![("main".to_string(), file.to_string())]);
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

/// The increment, in one turn: the agent starts something that outlives the
/// call, is told where its output went, and is told the pid.
#[test]
fn an_agent_starts_a_process_and_is_told_where_to_find_it() {
    let shell = Rc::new(FakeShell::new().answering("mkdir -p", 0, "RUNNING 142\n"));
    let app = booted(
        &[
            r#"start_process({"name": "web", "command": "python3 -m http.server 8000"})"#,
            "It is up on 8000.",
        ],
        MAIN,
        Rc::clone(&shell),
    );
    ask(&app, "serve this folder");

    let (cwd, command) = shell.ran().into_iter().next().expect("one command ran");
    assert_eq!(cwd, "/root/spaces/research", "the cwd is still the GRANT's root");
    assert!(command.contains(".harness/proc/web"), "state lives in the workspace: {command}");
    assert!(command.contains("{ python3 -m http.server 8000 ; } >>"), "{command}");
    assert!(command.contains("&"), "detached: {command}");
    // "FINISHED" COMES FROM THE FILESYSTEM, never from the process table: the
    // engine this ships on reports every pid it has ever used as alive.
    assert!(command.contains("echo $e > \"$d/exit\""), "{command}");
    // …AND SO DOES "WHEN IT FINISHED", stamped before the exit status so a
    // finished record is never one with no length (R10-3).
    assert!(command.contains("date +%s > \"$d/ended\""), "{command}");
    assert_eq!(command.matches("kill -0").count(), 1, "only to ask WHICH BOOT: {command}");

    let trace = body(&app, "/tools");
    assert!(trace.contains("web is running (pid 142)"), "{trace}");
    assert!(trace.contains(".harness/proc/web/log"), "the log is named: {trace}");
    assert!(trace.contains("data-outcome=\"ok\""), "{trace}");
}

/// A TOOL THAT HALF-WORKED SAYS SO (`failed.rs`). A command that dies on a typo
/// must not be reported as a running process — the agent would supervise
/// nothing for the rest of the run — and the failure must reach the summaries
/// that carry the worst state they summarise.
#[test]
fn a_process_that_died_on_a_typo_is_a_failure_the_whole_page_carries() {
    let shell = Rc::new(
        FakeShell::new().answering("mkdir -p", 0, "GONE 127\nsh: pythn3: not found\n"),
    );
    let app = booted(
        &[
            r#"start_process({"name": "web", "command": "pythn3 -m http.server"})"#,
            "It did not start.",
        ],
        MAIN,
        Rc::clone(&shell),
    );
    ask(&app, "serve this folder");

    let trace = body(&app, "/tools");
    assert!(trace.contains("exited immediately with status 127"), "{trace}");
    assert!(trace.contains("pythn3: not found"), "the evidence travels: {trace}");
    assert!(trace.contains("data-outcome=\"failed\""), "{trace}");
    // …and the board's row for the turn carries it, which is the rule the
    // product had to learn twice: no summary claims a success its own log denies.
    let board = body(&app, "/board");
    assert!(board.contains("a tool call in that turn failed"), "{board}");
}

/// Watch it, read it, stop it. The three that make a started process
/// supervisable rather than merely started.
#[test]
fn the_agent_lists_reads_and_stops_what_it_started() {
    let shell = Rc::new(
        FakeShell::new()
            .answering("for p in", 0, "web\trunning\t142\t192\tpython3 -m http.server 8000\n")
            .answering("tail -n 40", 0, "running 142\n2\n--\nServing HTTP on 0.0.0.0\n")
            .answering("kill -9", 0, "STOPPED 142\n"),
    );
    let app = booted(
        &[
            "list_processes({})\nread_process({\"name\": \"web\"})\nstop_process({\"name\": \"web\"})",
            "It served, then I stopped it.",
        ],
        MAIN,
        Rc::clone(&shell),
    );
    ask(&app, "check on the server then stop it");

    let trace = body(&app, "/tools");
    // ONE TABLE, WITH COLUMNS WE CHOSE — never `ps aux` forwarded.
    assert!(trace.contains("name") && trace.contains("state"), "{trace}");
    assert!(trace.contains("3m12s"), "the age is a duration, not an epoch: {trace}");
    assert!(trace.contains("web is running (pid 142)"), "{trace}");
    assert!(trace.contains("Serving HTTP"), "the recent output: {trace}");
    assert!(trace.contains("web (pid 142) is stopped"), "{trace}");
    assert!(!trace.contains("data-outcome=\"failed\""), "none of the three failed: {trace}");
}

/// One tool with a legible output beats five shell guesses. Nothing raw is
/// forwarded: the kilobytes become the units a person would have said.
#[test]
fn observe_answers_what_the_machine_is_in_one_block() {
    let shell = Rc::new(FakeShell::new().answering(
        "/proc/meminfo",
        0,
        "kernel\tLinux 5.15.0 x86_64\nup\t251.44\ncwd\t/root/spaces/research\nhere\t7\n\
         started\t1\nmem\t219136\t524288\ndisk\t2097152\t4194304\n",
    ));
    let app = booted(&["observe({})", "It is a small Linux."], MAIN, Rc::clone(&shell));
    ask(&app, "what is this machine?");

    let trace = body(&app, "/tools");
    assert!(trace.contains("kernel   Linux 5.15.0 x86_64"), "{trace}");
    assert!(trace.contains("uptime   4m11s"), "{trace}");
    assert!(trace.contains("memory   214 MB free of 512 MB"), "{trace}");
    assert!(trace.contains("disk     2.0 GB free of 4.0 GB"), "{trace}");
    assert!(trace.contains("/root/spaces/research"), "{trace}");
}

/// `list_files` on a folder you do not know the shape of is not a search.
#[test]
fn find_files_searches_by_name_and_by_contents() {
    let shell = Rc::new(
        FakeShell::new().answering("find .", 0, "./notes/today.md:3:TODO ship the port\n"),
    );
    let app = booted(
        &[r#"find_files({"name": "*.md", "text": "TODO"})"#, "One TODO."],
        MAIN,
        Rc::clone(&shell),
    );
    ask(&app, "any TODOs left?");

    let command = &shell.ran()[0].1;
    assert!(command.contains("-name '*.md'"), "{command}");
    assert!(command.contains("grep -IHns -m1 -e 'TODO'"), "{command}");
    assert!(command.contains("-prune"), "its own records are not the answer: {command}");

    let trace = body(&app, "/tools");
    assert!(trace.contains("1 match(es)"), "{trace}");
    assert!(trace.contains("notes/today.md:3:TODO ship the port"), "{trace}");
}

/// THE SAME GATE (I6, ADR-006). An agent with no shared space has no workspace,
/// so it is never handed any of these — default deny, structurally.
#[test]
fn an_agent_with_no_space_gets_none_of_the_environment() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(
        &[
            r#"start_process({"name": "miner", "command": "while :; do :; done"})"#,
            "I cannot.",
        ],
        ALONE,
        Rc::clone(&shell),
    );
    ask(&app, "start something");

    assert!(shell.ran().is_empty(), "nothing ran: {:?}", shell.ran());
    let trace = body(&app, "/tools");
    assert!(trace.contains("Tool not found"), "{trace}");
}

/// I15: a browser with no workspace at all answers in words the model can act
/// on, and the turn still finishes.
#[test]
fn no_workspace_at_all_is_said_plainly_and_the_turn_survives() {
    let shell = Rc::new(FakeShell::unavailable("this page is not cross-origin isolated"));
    let app = booted(&["observe({})", "There is no machine here."], MAIN, shell);
    ask(&app, "what is this machine?");

    let trace = body(&app, "/tools");
    assert!(trace.contains("No folder is available here"), "{trace}");
    assert!(trace.contains("not cross-origin isolated"), "{trace}");
    assert!(body(&app, "/chat").contains("There is no machine here."));
}

/// THE PANE. A person watching an agent work sees what it has running without
/// asking it — through the agent's own tool, and attributed to the PANE rather
/// than to the agent, because the pane's own polling is not the agent's work.
#[test]
fn the_processes_pane_shows_what_is_running_and_does_not_bill_it_to_the_agent() {
    let shell = Rc::new(FakeShell::new().answering(
        "for p in",
        0,
        "web\trunning\t142\t192\tpython3 -m http.server 8000\n",
    ));
    let app = booted(&[], MAIN, Rc::clone(&shell));

    let asked = handle(&mut app.borrow_mut(), Request::post_form("/processes", &[]));
    assert_eq!(asked.status, 200);
    block_on(drive(Rc::clone(&app))).expect("the listing runs");

    let shown = handle(&mut app.borrow_mut(), Request::get("/processes"));
    let panel = shown.body;
    assert!(panel.contains("data-rows=\"1\""), "the core counts: {panel}");
    // THE ROWS LEAVE AS COLUMNS, not as a block of fixed-width text nobody can
    // read in a 254px rail (R10-1): the pane lays them out itself.
    let rows = shown
        .headers
        .iter()
        .find(|(k, _)| k == "x-procs")
        .map(|(_, v)| v.clone())
        .expect("the rows ride the header");
    let fields: Vec<&str> = rows.split('\t').collect();
    assert_eq!(fields[0], "web", "{rows}");
    assert_eq!(fields[1], "running", "{rows}");
    assert_eq!(fields[4], "python3 -m http.server 8000", "the command travels whole: {rows}");
    assert!(!panel.contains("term-run"), "no <pre> of the table any more: {panel}");

    // The agent called nothing, so its own log is empty; the call is the app's.
    let mine = body(&app, "/tools");
    assert!(mine.contains("No tool has been called yet."), "{mine}");
    let with_app = handle(
        &mut app.borrow_mut(),
        Request::get("/tools").with_header("x-app-activity", "1"),
    )
    .body;
    assert!(with_app.contains("this page ran"), "{with_app}");
    assert!(with_app.contains("list_processes"), "{with_app}");
}

/// …and an agent with no workspace gets the pane's own refusal, not a table.
#[test]
fn the_processes_pane_refuses_an_agent_with_no_workspace() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(&[], ALONE, Rc::clone(&shell));
    let panel = handle(&mut app.borrow_mut(), Request::get("/processes"));
    assert!(panel.body.contains("no folder"), "{}", panel.body);
    let refused = handle(&mut app.borrow_mut(), Request::post_form("/processes", &[]));
    assert_eq!(refused.status, 400, "a refusal is an error, not an empty table");
    assert!(shell.ran().is_empty());
}

/// THE PANE CAN STOP WHAT IT SHOWS (R10-6), and the press is the PERSON'S: the
/// button runs the agent's own `stop_process` through the same gate, so a trace
/// that called it the agent's would credit the model with a decision nobody let
/// it make. No new tool and no new route — the pane's own POST carries a name.
#[test]
fn the_pane_stops_a_process_through_the_agents_own_tool() {
    let shell = Rc::new(
        FakeShell::new()
            .answering("for p in", 0, "web\trunning\t142\t192\tsleep 900\n")
            .answering("kill $c", 0, "STOPPED 142\n"),
    );
    let app = booted(&[], MAIN, Rc::clone(&shell));

    handle(&mut app.borrow_mut(), Request::post_form("/processes", &[("stop", "web")]));
    block_on(drive(Rc::clone(&app))).expect("the stop runs");

    let ran = shell.ran();
    assert!(ran.iter().any(|(_, c)| c.contains("kill $c $pid")), "{ran:?}");
    let trace = handle(
        &mut app.borrow_mut(),
        Request::get("/tools").with_header("x-app-activity", "1"),
    )
    .body;
    assert!(trace.contains("stop_process"), "{trace}");
    assert!(trace.contains("you ran"), "the press is a person\u{2019}s: {trace}");
}

/// A WORKSPACE THAT LOST ITS RECORDS SAYS SO (R10-2). On container2wasm a reload
/// destroys `.harness/proc`, so the listing comes back empty — and the pane used
/// to answer "Nothing has been started" while the chat one click away still said
/// `web is running (pid 142)`. The log outlives the filesystem, so the pane
/// reports the loss and names what was lost.
#[test]
fn a_listing_with_nothing_in_it_still_says_what_was_started() {
    let shell = Rc::new(FakeShell::new().answering("mkdir -p", 0, "RUNNING 142\n"));
    let app = booted(
        &[
            r#"start_process({"name": "web", "command": "python3 -m http.server 8000"})"#,
            "It is up.",
        ],
        MAIN,
        Rc::clone(&shell),
    );
    ask(&app, "serve this folder");
    // …and now the machine is a fresh one: `.harness/proc` is not there, which
    // is what `list_script` reports by printing nothing at all.
    handle(&mut app.borrow_mut(), Request::post_form("/processes", &[]));
    block_on(drive(Rc::clone(&app))).expect("the listing runs");

    let panel = body(&app, "/processes");
    assert!(!panel.contains("data-none"), "something WAS started: {panel}");
    assert!(panel.contains("data-lost=\"1\""), "{panel}");
    assert!(panel.contains("web was started here"), "it names what went: {panel}");
}
