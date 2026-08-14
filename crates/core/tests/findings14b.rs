//! Round 14's two PANE-DISAGREEMENT findings, through the seam on the host (I3).
//!
//! Both are one shape, the shape thirteen rounds keep finding: a projection
//! reading the append-only log without a boundary its neighbour already
//! applies. P0-3 is the tool trace reading `filelist::missing` — a
//! FILE-LISTING predicate — over any tool's output, so a shell line inside a
//! failed `exec` handed the row a folder's empty state. P1-3 is the Files pane
//! gating its refresh on the AGENT's status stamp, which a person typing a
//! command never moves, and then asserting a fact about a disk it can only
//! have observed.

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

/// The measured line, and what the workspace measured said back to it.
const LINE: &str = "pwd; ls -la; wc -l primes.txt; md5sum primes.txt; head -3 primes.txt";
const SAID: &str = "/root/spaces/research\ntotal 0\nwc: primes.txt: No such file or directory\n\
                    md5sum: primes.txt: No such file or directory (exit status 1)";

fn booted(shell: FakeShell) -> Rc<RefCell<App>> {
    let mut app = block_on(boot(Ports {
        model: Rc::new(ScriptedModel::with_replies(Vec::new())),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(shell),
        agents: Rc::new(ScriptedAgents::none()),
    }))
    .expect("boot succeeds");
    install_agents(&mut app, vec![("main".to_string(), MAIN.to_string())]);
    Rc::new(RefCell::new(app))
}

fn get(app: &Rc<RefCell<App>>, path: &str, header: (&str, &str)) -> String {
    handle(&mut app.borrow_mut(), Request::get(path).with_header(header.0, header.1)).body
}

fn header(app: &Rc<RefCell<App>>, path: &str, at: &str, name: &str) -> String {
    handle(&mut app.borrow_mut(), Request::get(path).with_header("x-at", at))
        .headers
        .iter()
        .find(|(k, _)| k == name)
        .map(|(_, v)| v.clone())
        .unwrap_or_default()
}

fn typed(app: &Rc<RefCell<App>>, command: &str) {
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/terminal", &[("command", command)]),
    );
    block_on(drive(Rc::clone(app))).expect("the command runs");
}

/// R14-P0-3. One entry, one timestamp, two panes: Commands said `— failed, on
/// an earlier page's Linux` with the true stdout and `(exit status 1)`, and the
/// Tool trace said `— not there yet` over the invented sentence *"There is no .
/// folder yet — nothing has written to it."* Nobody asked about `.`; `path_of`
/// defaults to it for arguments that name no path, and `missing` was a
/// substring test that any tool's output could satisfy.
#[test]
fn a_failed_command_never_wears_a_folders_empty_state() {
    let app = booted(FakeShell::new().answering("primes.txt", 1, SAID));
    typed(&app, LINE);

    // IN THE ONE PANE THAT HOLDS THE SHELL (R15-P1-4). The finding was that
    // two panes disagreed about one command; the answer this round gives is
    // that only one of them shows it — so the word this asserts is the word
    // that is left, and the trace is checked for saying nothing about it.
    let commands = get(&app, "/terminal", ("x-agent", "main"));
    assert!(
        !commands.contains("not there yet"),
        "a command is not a folder: {commands}"
    );
    assert!(
        !commands.contains("There is no")
            && !commands.contains("was not there when this listing ran"),
        "the file-listing empty state does not leak onto a command: {commands}"
    );
    assert!(commands.contains("— failed"), "a failed command reads as failed: {commands}");
    assert!(commands.contains("No such file or directory"), "the true output: {commands}");
    let trace = get(&app, "/tools", ("x-agent", "main"));
    assert!(!trace.contains("primes.txt"), "the shell is not doubled here: {trace}");

    // The listing this predicate is FOR still gets it: `ls` on a folder that is
    // not there is the most ordinary state an empty workspace has (R5-11).
    let shelf = booted(FakeShell::new().answering("artifacts", 1, "ls: artifacts: No such file or directory"));
    handle(
        &mut shelf.borrow_mut(),
        Request::post_form("/files", &[("path", "artifacts"), ("kind", "folder")]),
    );
    block_on(drive(Rc::clone(&shelf))).expect("the listing runs");
    // …with the app's own activity shown: a pane's listing is the app talking
    // to itself, and the trace hides those by default (R7-1).
    let listing = handle(
        &mut shelf.borrow_mut(),
        Request::get("/tools").with_header("x-agent", "main").with_header("x-app-activity", "1"),
    )
    .body;
    assert!(
        listing.contains("not there yet"),
        "a folder that is not there is still not a failure: {listing}"
    );
}

/// R14-P1-5. One order for both traces: log order, oldest first, and the same
/// order for a command a PERSON typed as for one the agent chose. The
/// remaining half of that finding is a scroll position and not application
/// logic (I5) — `ui::terminal` now shows the newest row on every change, the
/// rule the tool trace already followed — but the ORDER is a projection's, and
/// this is where it is pinned.
#[test]
fn both_traces_hold_one_order_and_the_person_gets_no_exception() {
    let app = booted(FakeShell::new());
    typed(&app, "echo first");
    typed(&app, "echo second");
    typed(&app, "echo third");

    let order = |pane: &str| -> Vec<usize> {
        ["first", "second", "third"]
            .iter()
            .map(|word| pane.find(word).unwrap_or_else(|| panic!("{word} missing from {pane}")))
            .collect()
    };
    let commands = order(&get(&app, "/terminal", ("x-agent", "main")));
    assert!(commands[0] < commands[1] && commands[1] < commands[2], "oldest first: {commands:?}");
    // …AND THE TRACE HOLDS NONE OF THEM, BUT SAYS HOW MANY (R15-P1-4). The
    // second half of this finding was that two panes ordered the same rows;
    // there is one pane now, and the other one names the count and the door.
    let res = handle(
        &mut app.borrow_mut(),
        Request::get("/tools").with_header("x-agent", "main"),
    );
    assert!(!res.body.contains("echo first"), "the shell is not doubled: {}", res.body);
    let shell_calls = res
        .headers
        .iter()
        .find(|(k, _)| k == "x-shell-calls")
        .map(|(_, v)| v.clone())
        .unwrap_or_default();
    assert_eq!(shell_calls, "3", "…and it says how many it left out: {res:?}");
}

/// R14-P1-3, first fault. `echo hello-persist > probe.txt` typed into the
/// Commands box ran, printed `ok`, and appeared in that pane's own `ls -la` —
/// and the Files pane 400px below said the folder was empty, because the only
/// thing that made it ask for a new listing was the AGENT's status stamp, which
/// a person's command does not move. The log is what both panes project, so
/// `x-workspace-at` is what this one follows.
#[test]
fn a_command_a_person_typed_makes_the_files_pane_stale() {
    let app = booted(FakeShell::new());
    let before: usize = header(&app, "/files", ".", "x-workspace-at").parse().unwrap_or(0);

    typed(&app, "echo hello-persist > probe.txt");
    let after: usize = header(&app, "/files", ".", "x-workspace-at").parse().unwrap_or(0);
    assert!(after > before, "a typed command moves the workspace: {before} -> {after}");

    // …and the pane's OWN listing does not, or every refresh would ask for
    // another one for ever.
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/files", &[("path", "."), ("kind", "folder")]),
    );
    block_on(drive(Rc::clone(&app))).expect("the listing runs");
    let listed: usize = header(&app, "/files", ".", "x-workspace-at").parse().unwrap_or(0);
    assert_eq!(listed, after, "listing a folder does not change it");
}

/// R14-P1-3, second fault. The pane can know what its last `ls` printed and
/// nothing else; it was asserting what is on the disk. `vouch`'s house style —
/// `— ok, and it printed nothing` — says what was observed and stops.
#[test]
fn an_empty_folder_says_what_the_listing_saw_and_not_what_exists() {
    let app = booted(FakeShell::new());
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/files", &[("path", "."), ("kind", "folder")]),
    );
    block_on(drive(Rc::clone(&app))).expect("the listing runs");

    let pane = get(&app, "/files", ("x-at", "."));
    assert!(
        !pane.contains("nothing has written to it"),
        "a projection of the log cannot know that: {pane}"
    );
    assert!(
        pane.contains("when this listing ran"),
        "it says what it observed: {pane}"
    );
}
