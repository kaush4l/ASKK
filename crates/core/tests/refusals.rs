//! A CALL THAT DID NOT HAPPEN MUST NOT READ AS ONE THAT DID. Four measured
//! defects, all of the same family: the system knew a call was refused and
//! reported it as run, or filled in a value nobody wrote and ran something
//! else.
//!
//! 1. `write_file` with no `contents` wrote an EMPTY FILE over the existing one
//!    and said `wrote <path>` with `ok=true` — the only executor call site in
//!    the tree that discarded an `ArgError` on a content field.
//! 2. `list_files` and `read_file` with no `path` resolved `""` to `"."` and
//!    succeeded against the workspace root: a call that named nothing succeeded
//!    against something else.
//! 3. The space's and memory's refusals — *"Nothing recorded: a fact needs a
//!    key."* — came back `ok=true`, so the Tool trace, the pane a person opens
//!    to find out what went wrong, coloured them GREEN.
//! 4. `exec` output was unbounded from the guest into the model's window.
//!
//! Everything here reads the LOG's own `ToolInvoked` facts rather than a
//! rendered pane: `ok` is the flag every projection colours by, so it is the
//! flag to assert on (I8).

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
use core::{boot, drive, handle, install_agents_as, log_kinds, App, Ports};
use kernel::{EventKind, Request, Timestamp};

fn block_on<F: Future>(fut: F) -> F::Output {
    let mut fut = pin!(fut);
    let mut cx = Context::from_waker(Waker::noop());
    for _ in 0..100_000 {
        if let Poll::Ready(v) = fut.as_mut().poll(&mut cx) {
            return v;
        }
    }
    panic!("future not ready under in-memory ports");
}

/// One agent with a space — so it has the workspace tools and the space's own
/// three — and the memory faculty, so `keep` and `discard` are hosted too.
const MAIN: &str = "---\nname: main\ndescription: the lead\ntools: []\nspace: research\n\
                    faculties: [memory]\n---\nbody";

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
    install_agents_as(&mut app, vec![("main".to_string(), MAIN.to_string())], "main");
    Rc::new(RefCell::new(app))
}

fn ask(app: &Rc<RefCell<App>>, message: &str) {
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", message)]),
    );
    block_on(drive(Rc::clone(app))).expect("the turn drives");
}

/// Every tool call the log recorded, in order: `(tool, ok, output)`.
fn calls(app: &Rc<RefCell<App>>) -> Vec<(String, bool, String)> {
    log_kinds(&app.borrow())
        .into_iter()
        .filter_map(|k| match k {
            EventKind::ToolInvoked { tool, ok, output, .. } => Some((tool.0, ok, output)),
            _ => None,
        })
        .collect()
}

// ---------------------------------------------------------------- defect 1

/// THE DESTRUCTIVE ONE. A `write_file` whose `contents` key is absent is a call
/// the model did not finish writing; running it emptied a file that had
/// something in it and reported success.
#[test]
fn a_write_with_no_contents_refuses_and_leaves_the_file_as_it_was() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(
        &[
            r#"write_file({"path": "notes.md", "contents": "a whole day of work\n"})"#,
            r#"write_file({"path": "notes.md"})"#,
            "I left it alone.",
        ],
        Rc::clone(&shell),
    );
    ask(&app, "write the note, then write it again badly");

    assert_eq!(
        shell.files(),
        vec![(
            "/root/spaces/research/notes.md".to_string(),
            "a whole day of work\n".to_string()
        )],
        "the second call must not have touched the file"
    );
    let calls = calls(&app);
    assert_eq!(calls.len(), 2, "both calls are recorded facts: {calls:?}");
    assert!(!calls[1].1, "a refused write is NOT ok: {calls:?}");
    assert!(
        calls[1].2.contains("contents"),
        "the refusal names the argument that was missing: {calls:?}"
    );
    assert!(
        calls[1].2.contains("write_file("),
        "and it shows the call shape, the way exec's own refusal does: {calls:?}"
    );
    assert!(
        !calls[1].2.contains("wrote "),
        "and it never claims to have written: {calls:?}"
    );
}

/// `Missing` and `NotText` are different mistakes: one key was never written,
/// the other was written as something that is not text. A model that wrote
/// `contents: 42` needs to be told what it wrote, not that it wrote nothing.
#[test]
fn contents_that_are_not_text_are_refused_in_words_that_name_the_type() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(
        &[r#"write_file({"path": "n.md", "contents": 42})"#, "I see."],
        Rc::clone(&shell),
    );
    ask(&app, "write a number");

    assert!(shell.files().is_empty(), "nothing was written: {:?}", shell.files());
    let calls = calls(&app);
    assert!(!calls[0].1, "refused: {calls:?}");
    assert!(calls[0].2.contains("number"), "what it wrote instead: {calls:?}");
}

/// THE RULING, AND IT IS DELIBERATE: an EXPLICIT empty string is a legitimate
/// call. Emptying a file on purpose is a thing an agent does; the defect was
/// never *"an empty write"*, it was *an empty write nobody asked for*.
#[test]
fn an_explicit_empty_string_still_truncates_the_file() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(
        &[
            r#"write_file({"path": "log.txt", "contents": "noise\n"})"#,
            r#"write_file({"path": "log.txt", "contents": ""})"#,
            "Emptied.",
        ],
        Rc::clone(&shell),
    );
    ask(&app, "write it then empty it");

    assert_eq!(
        shell.files(),
        vec![("/root/spaces/research/log.txt".to_string(), String::new())],
        "the file is there and it is empty"
    );
    let calls = calls(&app);
    assert!(calls[1].1, "asking for it is not a mistake: {calls:?}");
}

// ---------------------------------------------------------------- defect 2

/// A call that named no path succeeded against the workspace ROOT: `list_files`
/// listed the folder, and `read_file` came back with the shell's own
/// `Is a directory`, which names nothing the model can act on.
#[test]
fn a_file_tool_that_names_no_path_is_refused_rather_than_aimed_at_the_folder() {
    let shell = Rc::new(FakeShell::holding(&[(
        "/root/spaces/research/secret.md",
        "the whole workspace",
    )]));
    let app = booted(
        &[
            r#"list_files({})"#,
            r#"read_file({})"#,
            "I will name a path.",
        ],
        Rc::clone(&shell),
    );
    ask(&app, "look around");

    let calls = calls(&app);
    assert_eq!(calls.len(), 2, "{calls:?}");
    for (tool, ok, output) in &calls {
        assert!(!ok, "{tool} named no path and must not read as run: {output}");
        assert!(output.contains("path"), "the refusal names the argument: {output}");
        assert!(
            output.contains(tool.as_str()),
            "and shows this tool's own call shape: {output}"
        );
    }
    assert!(
        !calls[0].2.contains("secret.md"),
        "the listing of the root never happened: {calls:?}"
    );
    assert!(
        !calls[1].2.contains("Is a directory"),
        "and the model is not handed the shell's own confusion: {calls:?}"
    );
}

/// …and naming `.` on purpose is still the workspace itself, which is what the
/// tool's description tells the model to do. The refusal above is about a call
/// that said NOTHING, not about the root being off limits.
#[test]
fn naming_the_workspace_itself_still_works() {
    let shell = Rc::new(FakeShell::holding(&[(
        "/root/spaces/research/notes.md",
        "hello",
    )]));
    let app = booted(&[r#"list_files({"path": "."})"#, "Seen."], Rc::clone(&shell));
    ask(&app, "list the workspace");

    let calls = calls(&app);
    assert!(calls[0].1, "an explicit '.' is a real call: {calls:?}");
    assert!(calls[0].2.contains("notes.md"), "{calls:?}");
}

// ---------------------------------------------------------------- defect 3

/// The space's three refusals are PROSE the model can act on and were reported
/// `ok=true` — a green row in the trace over a sentence beginning *"Nothing
/// recorded"*. The words were right; the flag every projection colours by was
/// wrong.
#[test]
fn a_space_refusal_is_recorded_as_a_call_that_failed() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(
        &[
            r#"remember({"value": "8873"})"#,
            r#"post_note({"note": "   "})"#,
            r#"forget({"key": "port"})"#,
            "None of that worked.",
        ],
        shell,
    );
    ask(&app, "record nothing three ways");

    let calls = calls(&app);
    assert_eq!(calls.len(), 3, "{calls:?}");
    assert!(!calls[0].1, "no key, nothing recorded: {calls:?}");
    assert!(calls[0].2.starts_with("Nothing recorded"), "prose unchanged: {calls:?}");
    assert!(!calls[1].1, "empty note, nothing posted: {calls:?}");
    assert!(calls[1].2.starts_with("Nothing posted"), "prose unchanged: {calls:?}");
    assert!(!calls[2].1, "no such fact, nothing forgotten: {calls:?}");
    assert!(calls[2].2.starts_with("No fact called"), "prose unchanged: {calls:?}");
}

/// A space call that DID change the space is still a success — the point is the
/// distinction, not painting the pane red.
#[test]
fn a_space_write_that_lands_is_still_ok() {
    let app = booted(
        &[r#"remember({"key": "port", "value": "8873"})"#, "Recorded."],
        Rc::new(FakeShell::new()),
    );
    ask(&app, "record the port");

    let calls = calls(&app);
    assert!(calls[0].1, "{calls:?}");
    assert!(calls[0].2.starts_with("Recorded in the research space"), "{calls:?}");
}

/// Memory has the same shape and the same defect: `keep` of an empty note and
/// `discard` of a line nobody holds both wrote `Ok` and read as green.
#[test]
fn a_memory_refusal_is_recorded_as_a_call_that_failed() {
    let app = booted(
        &[
            r#"keep({"note": "  "})"#,
            r#"discard({"note": "something nobody kept"})"#,
            "Neither worked.",
        ],
        Rc::new(FakeShell::new()),
    );
    ask(&app, "keep nothing and drop nothing");

    let calls = calls(&app);
    assert_eq!(calls.len(), 2, "{calls:?}");
    assert!(!calls[0].1, "an empty note is not kept: {calls:?}");
    assert!(calls[0].2.starts_with("Nothing kept"), "prose unchanged: {calls:?}");
    assert!(!calls[1].1, "nothing was discarded: {calls:?}");
    assert!(calls[1].2.starts_with("Nothing called that"), "prose unchanged: {calls:?}");
}

/// …and a line that really is kept is still a success.
#[test]
fn a_memory_write_that_lands_is_still_ok() {
    let app = booted(
        &[r#"keep({"note": "the user prefers metric units"})"#, "Kept."],
        Rc::new(FakeShell::new()),
    );
    ask(&app, "remember how I like units");

    let calls = calls(&app);
    assert!(calls[0].1, "{calls:?}");
    assert!(calls[0].2.starts_with("Kept."), "{calls:?}");
}

// ---------------------------------------------------------------- defect 4

/// `find / -type f` blows the context window. The cap keeps the HEAD and the
/// TAIL and says, in the middle, in words the model reads, exactly how much was
/// dropped and that the harness dropped it — a silent truncation would be a
/// worse bug than the one it fixes.
#[test]
fn output_past_the_ceiling_keeps_both_ends_and_says_what_it_cut() {
    let huge: String = (0..4_000).map(|n| format!("line-{n:06}\n")).collect();
    let shell = Rc::new(FakeShell::new().answering("find /", 0, &huge));
    let app = booted(&[r#"exec({"command": "find / -type f"})"#, "Too much."], shell);
    ask(&app, "find everything");

    let calls = calls(&app);
    assert!(calls[0].1, "the command itself succeeded: {}", calls[0].2);
    let said = &calls[0].2;
    assert!(said.len() < huge.len() / 2, "it was cut: {} bytes", said.len());
    assert!(said.starts_with("line-000000"), "the head survives: {said:.60}");
    assert!(said.trim_end().ends_with("line-003999"), "the tail survives too");
    assert!(
        said.contains("line-000000") && said.contains("line-003999"),
        "both ends are readable"
    );
    // The notice is the HARNESS speaking, and says so — otherwise the model
    // reads the cut as something the command printed.
    assert!(said.contains("THE HARNESS CUT"), "whose sentence this is: {said:.400}");
    assert!(
        said.contains(&format!("{}", huge.trim_end().len())),
        "the true size is named: {said:.400}"
    );
}

/// Output that fits is untouched, byte for byte — the cap must not become a
/// trimmer that edits ordinary answers.
#[test]
fn output_under_the_ceiling_is_untouched() {
    let shell = Rc::new(FakeShell::new().answering("uname", 0, "Linux harness 6.6.0"));
    let app = booted(&[r#"exec({"command": "uname -a"})"#, "Linux."], shell);
    ask(&app, "what kernel");

    let calls = calls(&app);
    assert_eq!(calls[0].2, "Linux harness 6.6.0", "{calls:?}");
}
