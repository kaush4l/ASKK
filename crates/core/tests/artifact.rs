//! THE SHELF, HOSTED, ON THE HOST (I3): the registry key it writes, the reader
//! it is built on, and the three answers a workspace can give a record.
//!
//! The CROSS-THREAD half of this increment is not here and cannot be — a host
//! `MemKv` shared by two apps is one `HashMap` in one process, which is the
//! shortcut `crates/adapters_web/tests/browser/tests/contexts.rs:1-16` was
//! written against. It is executed in the browser suite
//! (`tests/browser/tests/artifacts.rs`), which is gate check 5.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng};
use core::{boot, drive, handle, install_agents_as, App, Ports};
use kernel::{EventKind, KvStore, Request, Timestamp};

fn block_on<F: Future>(fut: F) -> F::Output {
    let mut fut = pin!(fut);
    let mut cx = Context::from_waker(Waker::noop());
    for _ in 0..1_000_000 {
        if let Poll::Ready(v) = fut.as_mut().poll(&mut cx) {
            return v;
        }
    }
    panic!("future not ready under in-memory ports");
}

const ROOT: &str = "/root/spaces/research";

fn agent_file() -> Vec<(String, String)> {
    vec![(
        "main".to_string(),
        "---\nname: main\ndescription: d\nspace: research\nfaculties: [artifacts]\n\
         tools: []\n---\nbody"
            .to_string(),
    )]
}

/// One app whose SPACES store and workspace the test holds, so it can read the
/// registry key back and see which command reached the shell.
fn booted(
    spaces: Rc<MemKv>,
    shell: Rc<FakeShell>,
    replies: &[&str],
) -> Rc<RefCell<App>> {
    let ports = Ports {
        model: Rc::new(ScriptedModel::with_replies(
            replies.iter().map(|r| ScriptedModel::text_reply(r)).collect(),
        )),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: spaces as Rc<dyn KvStore>,
        workspace: shell,
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents_as(&mut app, agent_file(), "main");
    Rc::new(RefCell::new(app))
}

fn ask(app: &Rc<RefCell<App>>, message: &str) {
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", message)]),
    );
    block_on(drive(Rc::clone(app))).expect("the turn drives");
}

/// Every tool result this turn recorded — the words the model actually got.
fn tool_outputs(app: &Rc<RefCell<App>>) -> String {
    core::log_kinds(&app.borrow())
        .iter()
        .filter_map(|k| match k {
            EventKind::ToolInvoked { output, .. } => Some(output.clone()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// What the shelf block currently says, through the ordinary sense.
fn block(app: &Rc<RefCell<App>>) -> String {
    core::sensed(&app.borrow(), agent::ARTIFACTS_FACULTY)
        .iter()
        .filter_map(|p| match p {
            context::Part::Text { text } => Some(text.clone()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("")
}

const RECORD: &str = r#"record_artifact({"name": "out/report.md", "description": "the survey", "kind": "report"})"#;

/// **ONE KEY PER ARTIFACT, AT `space/<space>/a/<name>`.** The registry layout
/// the increment named, asserted against the store rather than against a
/// helper that could agree with the writer and with nothing else.
#[test]
fn recording_writes_one_key_under_the_spaces_own_prefix() {
    let spaces = Rc::new(MemKv::new());
    let shell = Rc::new(FakeShell::holding(&[(&format!("{ROOT}/out/report.md"), "0123456789")]));
    let app = booted(Rc::clone(&spaces), shell, &[RECORD, "done"]);
    ask(&app, "write it up");

    let keys = block_on(spaces.list_prefix("space/research/a/")).expect("the prefix reads");
    assert_eq!(keys, ["space/research/a/out/report.md"], "one key, named for the artifact");
    let json = block_on(spaces.get(&keys[0])).expect("it reads").expect("it is there");
    let artifact: agent::Artifact = serde_json::from_str(&json).expect("a record, not a blob");
    assert_eq!(artifact.uri, "artifact://research/out/report.md");
    assert_eq!(artifact.by, "main", "the process, never an argument");
    assert_eq!(artifact.bytes, Some(10), "the port read it and counted it");
    // …and the space's own keys are untouched: `a/` sits beside `f/` and `n/`.
    assert!(block_on(spaces.list_prefix("space/research/f/")).unwrap().is_empty());
    assert!(block(&app).contains("out/report.md"), "and it reaches the prompt: {}", block(&app));
}

/// **THE EXISTENCE CHECK, WHEN THE PORT ANSWERS AND SAYS NO.** Recording a file
/// that is not there would put a name on everybody's shelf that nobody can
/// open, so it is refused in words — and nothing is written.
#[test]
fn a_file_the_workspace_says_is_not_there_is_refused_and_not_recorded() {
    let spaces = Rc::new(MemKv::new());
    let app = booted(Rc::clone(&spaces), Rc::new(FakeShell::new()), &[RECORD, "ok"]);
    ask(&app, "write it up");

    assert!(block_on(spaces.list_prefix("space/research/a/")).unwrap().is_empty());
    let said = tool_outputs(&app);
    assert!(said.contains("there is no 'out/report.md'"), "{said}");
    assert!(said.contains("Write the file first"), "and it names the fix: {said}");
}

/// **THE CROSS-THREAD RULING, AT THE HOST.** A workspace that will not answer
/// at all — which is every sub-agent's Worker
/// (`crates/adapters_web/src/worker/world.rs:52-58`) — does NOT block the
/// record. The artifact is shelved and its size is left unclaimed.
#[test]
fn a_workspace_that_refuses_records_the_artifact_with_no_size_claimed() {
    let spaces = Rc::new(MemKv::new());
    let shell = Rc::new(FakeShell::unavailable("the workspace runs in the page"));
    let app = booted(Rc::clone(&spaces), shell, &[RECORD, "ok"]);
    ask(&app, "write it up");

    let keys = block_on(spaces.list_prefix("space/research/a/")).expect("the prefix reads");
    assert_eq!(keys.len(), 1, "it is on the shelf: {keys:?}");
    let json = block_on(spaces.get(&keys[0])).unwrap().unwrap();
    let artifact: agent::Artifact = serde_json::from_str(&json).unwrap();
    assert_eq!(artifact.bytes, None, "nothing here measured it");
    let shown = block(&app);
    assert!(shown.contains("unconfirmed"), "and the prompt says so: {shown}");
    assert!(!shown.contains("bytes"), "rather than claiming a number: {shown}");
}

/// **`read_artifact` IS BUILT ON `WorkspacePort::read_range` AND NOTHING ELSE.**
///
/// `FakeShell` overrides `read` and does NOT override `read_range`, so a call
/// that went through `read` would leave `ran` empty. This asserts the COMMAND
/// that reached the shell, which is the only place the difference is visible.
///
/// POSITIVE CONTROL (run, then reverted): change `read` in
/// `crates/core/src/space/artifact/host.rs` to `at.port.read(&at.root, &path)`
/// and this goes red on an empty `ran`.
#[test]
fn reading_an_artifact_goes_through_read_range_with_the_window_asked_for() {
    let spaces = Rc::new(MemKv::new());
    let shell = Rc::new(FakeShell::holding(&[(&format!("{ROOT}/out/report.md"), "0123456789")]));
    let app = booted(
        Rc::clone(&spaces),
        Rc::clone(&shell),
        &[
            RECORD,
            r#"read_artifact({"name": "out/report.md", "offset": 4, "limit": 3})"#,
            "ok",
        ],
    );
    ask(&app, "write it up, then read it back");

    let ran: Vec<String> = shell.ran().iter().map(|(_, c)| c.clone()).collect();
    let windowed = ran
        .iter()
        .find(|c| c.contains("tail -c +5"))
        .unwrap_or_else(|| panic!("no windowed read reached the shell: {ran:?}"));
    assert!(windowed.contains("head -c 3"), "the limit the model asked for: {windowed}");
    assert!(windowed.contains("'out/report.md'"), "the resolved path, quoted: {windowed}");
    assert_eq!(
        shell.ran()[0].0,
        ROOT,
        "and it ran in the space's folder, which the grant decides and not the model"
    );
}

/// A NAME THAT IS NOT ON THE SHELF IS REFUSED IN WORDS THAT NAME WHAT IS —
/// `Memory::discard`'s discipline, because the model's next move after a miss
/// is to guess the wording.
#[test]
fn reading_a_name_the_shelf_does_not_hold_says_what_it_does_hold() {
    let spaces = Rc::new(MemKv::new());
    let shell = Rc::new(FakeShell::holding(&[(&format!("{ROOT}/out/report.md"), "x")]));
    let app = booted(
        Rc::clone(&spaces),
        shell,
        &[RECORD, r#"read_artifact({"name": "out/nothing.md"})"#, "ok"],
    );
    ask(&app, "write it up, then read the wrong one");

    let said = tool_outputs(&app);
    assert!(said.contains("Nothing on the research shelf is called 'out/nothing.md'"), "{said}");
    assert!(said.contains("out/report.md"), "and it names what IS there: {said}");
}

/// A PATH THAT WOULD LEAVE THE SPACE IS REFUSED BY THE ONE PATH RULE, not by a
/// second one written here (`agent::relative_path`).
#[test]
fn an_artifact_name_that_walks_out_of_the_workspace_is_refused() {
    let spaces = Rc::new(MemKv::new());
    let app = booted(
        Rc::clone(&spaces),
        Rc::new(FakeShell::new()),
        &[r#"record_artifact({"name": "../secrets", "description": "no"})"#, "ok"],
    );
    ask(&app, "try it");
    assert!(block_on(spaces.list_prefix("space/research/a/")).unwrap().is_empty());
    let said = tool_outputs(&app);
    assert!(said.contains("walks out of the workspace"), "{said}");
}
