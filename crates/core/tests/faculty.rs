//! THE FACULTY PORT on the host (I3): what a host leaves in the prompt before
//! every model call, who is allowed to leave it, and who may RUN what the
//! faculty offers to call.
//!
//! The space used to be written into `AgentState.senses` by a hardcoded line
//! in `core`. The first four tests are the proof that it no longer is — that
//! the oldest faculty and one defined in a crate `core` has never heard of
//! arrive by the same mechanism, that a faculty with no host to sense it costs
//! nothing, and that what a sense reports is read again every pass rather than
//! remembered.
//!
//! The last four are the same proof for ACTION, which was the half left closed:
//! a host outside this crate runs a call and its answer lands as an ordinary
//! `ToolInvoked` fact, a failing host is a recorded failure rather than a lost
//! turn, a host cannot shadow a compiled-in tool, and a name no faculty
//! declares is still refused in words.

use std::cell::Cell;
use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{DenyAllNet, FixedClock, MemStore, ScriptedAgents, ScriptedModel, SeededRng};
use core::{
    boot, drive, handle, install_agents_as, install_sense, install_tool_host, App, Ports, Sense,
    Sensing, ToolHost,
};
use kernel::{BoxFuture, KvStore, ModelPort, Request, Timestamp};

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

/// A model that answers from a script and keeps every request body — the only
/// way to assert what actually reached the model.
#[derive(Debug, Default)]
struct Recorder {
    seen: RefCell<Vec<String>>,
}

impl Recorder {
    fn new() -> Rc<Recorder> {
        Rc::new(Recorder::default())
    }
    fn last_prompt(&self) -> String {
        self.seen.borrow().last().cloned().unwrap_or_default()
    }
}

impl ModelPort for Recorder {
    fn call<'a>(
        &'a self,
        _endpoint: &'a kernel::EndpointName,
        body_json: &'a str,
    ) -> BoxFuture<'a, Result<kernel::ModelReply, kernel::ModelError>> {
        self.seen.borrow_mut().push(body_json.to_string());
        Box::pin(std::future::ready(Ok(kernel::ModelReply {
            body_json: ScriptedModel::text_reply("noted"),
            usage: None,
        })))
    }
}

/// One agent file, with whatever `space:` and `faculties:` the test wants.
fn agent_file(space: &str, faculties: &str) -> Vec<(String, String)> {
    vec![(
        "main".to_string(),
        format!(
            "---\nname: main\ndescription: main does a thing\nspace: {space}\n\
             faculties: {faculties}\ntools: []\n---\nbody"
        ),
    )]
}

fn booted(model: Rc<dyn ModelPort>, files: Vec<(String, String)>) -> Rc<RefCell<App>> {
    let ports = Ports {
        model,
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(adapters_test::MemKv::new()) as Rc<dyn KvStore>,
        workspace: Rc::new(adapters_test::FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents_as(&mut app, files, "main");
    Rc::new(RefCell::new(app))
}

fn ask(app: &Rc<RefCell<App>>, message: &str) {
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", message)]),
    );
    block_on(drive(Rc::clone(app))).expect("the turn drives");
}

/// What one block of sensed state currently holds, as plain text.
fn sensed(app: &Rc<RefCell<App>>, block: &str) -> String {
    core::sensed(&app.borrow(), block)
        .iter()
        .filter_map(|p| match p {
            context::Part::Text { text } => Some(text.clone()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("")
}

/// THE REGRESSION GUARD FOR THE MIGRATION. The space block used to be written
/// by a hardcoded line in `space::shared::refresh`; it is now produced by
/// `SpaceSense` through the ordinary port, and the prompt must not know the
/// difference.
#[test]
fn the_space_block_still_reaches_the_prompt_through_the_faculty_port() {
    let model = Recorder::new();
    let app = booted(Rc::clone(&model) as Rc<dyn ModelPort>, agent_file("research", "[]"));
    ask(&app, "hello");

    let prompt = model.last_prompt();
    assert!(prompt.contains("space: research"), "{prompt}");
    assert!(
        sensed(&app, "space").contains("space: research"),
        "and it got there through AgentState.senses, keyed by the block id"
    );
}

/// I15: every capability may be absent. A file naming a faculty no host in
/// this build can sense declares it, gets no parts, and takes its turn — the
/// same silence `agent::faculty::of` gives an unknown name.
#[test]
fn a_faculty_with_no_installed_sense_does_not_break_the_turn() {
    let model = Recorder::new();
    let app = booted(
        Rc::clone(&model) as Rc<dyn ModelPort>,
        agent_file("", "[nothing_can_sense_this]"),
    );
    ask(&app, "hello");

    let spec = agent::parse_agent_file("main", &agent_file("", "[nothing_can_sense_this]")[0].1)
        .expect("the file parses");
    assert_eq!(
        agent::declared_faculties(&spec),
        vec!["nothing_can_sense_this".to_string()],
        "the file really does declare a faculty — the silence below is not a typo"
    );
    assert!(!model.last_prompt().is_empty(), "the turn still called the model");
    assert_eq!(core::answer(&app.borrow()).as_deref(), Some("noted"));
    assert!(sensed(&app, "nothing_can_sense_this").is_empty());
}

/// A sense living entirely OUTSIDE `core`, in the shape a browser one would
/// take: it reports what it can currently see, and it can see something
/// different every time it is asked.
struct FakePage {
    reads: Cell<usize>,
}

impl Sense for FakePage {
    fn faculty(&self) -> &'static str {
        "browser"
    }
    fn read<'a>(&'a self, of: &'a Sensing) -> BoxFuture<'a, Vec<(String, Vec<context::Part>)>> {
        let nth = self.reads.get() + 1;
        self.reads.set(nth);
        Box::pin(async move {
            vec![(
                "page".to_string(),
                context::text(format!("snapshot {nth} for {}", of.agent)),
            )]
        })
    }
}

/// THE CHROME-SHAPED PROOF.
///
/// `FakePage` is defined in this test file, in a crate `core` does not know
/// about, for a faculty name `core` never mentions. It is installed with
/// `install_sense` and nothing else, and its parts land in
/// `AgentState.senses` under its own block id before the model is called.
///
/// That is exactly the sentence the owner asked for: a chrome-use agent whose
/// tools navigate the page, and whose latest page snapshot is included by
/// default before every call, is now reachable by a `Sense` implemented in
/// `adapters_web` — with NO edit to this crate. What is left for that faculty
/// to exist is its PURE half (a `browser` arm in `agent::faculty::of`, which
/// declares the block's id, slot and stability), and the browser capability
/// itself, which is a user gate.
#[test]
fn a_sense_defined_outside_core_puts_fresh_state_in_the_prompt() {
    let model = Recorder::new();
    let app = booted(Rc::clone(&model) as Rc<dyn ModelPort>, agent_file("", "[browser]"));
    let page = Rc::new(FakePage { reads: Cell::new(0) });
    install_sense(&mut app.borrow_mut(), Rc::clone(&page) as Rc<dyn Sense>);
    ask(&app, "what is on the page?");

    assert!(page.reads.get() >= 1, "the port asked a sense core never named");
    assert_eq!(
        sensed(&app, "page"),
        format!("snapshot {} for main", page.reads.get()),
        "the outside sense wrote the block it named, and was told whose turn it is"
    );
}

/// FRESHNESS: read again every pass, never cached. A snapshot that is
/// remembered is a snapshot that is wrong, which is the same reason the clock
/// is not cached.
#[test]
fn a_sense_whose_value_changes_is_read_again_on_the_next_pass() {
    let model = Recorder::new();
    let app = booted(Rc::clone(&model) as Rc<dyn ModelPort>, agent_file("", "[browser]"));
    let page = Rc::new(FakePage { reads: Cell::new(0) });
    install_sense(&mut app.borrow_mut(), Rc::clone(&page) as Rc<dyn Sense>);

    ask(&app, "first look");
    let (first, after_one) = (sensed(&app, "page"), page.reads.get());
    ask(&app, "second look");
    let second = sensed(&app, "page");

    assert_eq!(first, format!("snapshot {after_one} for main"));
    assert_ne!(second, first, "the second turn saw the world as it is now");
    assert!(
        page.reads.get() > after_one,
        "the sense was asked again, not remembered"
    );
}

/// A TOOL HOST living entirely outside `core`, in the shape a browser one
/// would take: it claims one name, answers it from a script, and counts how
/// often it was asked. It reaches nothing real — the browser capability itself
/// is a user gate, and this fake exists only in this file.
struct FakeBrowser {
    claims: &'static str,
    answer: Result<String, String>,
    calls: Cell<usize>,
}

impl FakeBrowser {
    fn claiming(claims: &'static str, answer: Result<String, String>) -> Rc<FakeBrowser> {
        Rc::new(FakeBrowser {
            claims,
            answer,
            calls: Cell::new(0),
        })
    }
}

impl ToolHost for FakeBrowser {
    fn handles(&self, tool: &str) -> bool {
        tool == self.claims
    }
    fn run<'a>(
        &'a self,
        tool: &'a str,
        args_json: &'a str,
    ) -> BoxFuture<'a, Result<String, String>> {
        self.calls.set(self.calls.get() + 1);
        let answer = match &self.answer {
            Ok(said) => Ok(format!("{said} — {tool}{args_json}")),
            Err(problem) => Err(problem.clone()),
        };
        Box::pin(std::future::ready(answer))
    }
}

/// An app whose model says exactly these things, in order — the only way to
/// reach the tool executor, which runs what a model asked for and nothing else.
fn scripted(replies: &[&str], files: Vec<(String, String)>) -> Rc<RefCell<App>> {
    let model = ScriptedModel::with_replies(
        replies.iter().map(|r| ScriptedModel::text_reply(r)).collect(),
    );
    booted(Rc::new(model) as Rc<dyn ModelPort>, files)
}

/// Every call the log holds: the tool, whether it succeeded, what came back.
fn invoked(app: &Rc<RefCell<App>>) -> Vec<(String, bool, String)> {
    core::log_kinds(&app.borrow())
        .into_iter()
        .filter_map(|kind| match kind {
            kernel::EventKind::ToolInvoked {
                tool, ok, output, ..
            } => Some((tool.0, ok, output)),
            _ => None,
        })
        .collect()
}

/// BUILT-INS WIN. `now` is compiled into `core`, so a host claiming that name
/// is never asked and the clock still answers. A faculty widens what an agent
/// may do; it may not redefine what this build already does, which is why
/// `faculty::run_hosted` sits BETWEEN the built-in table and the local one.
#[test]
fn a_host_cannot_shadow_a_built_in_tool() {
    let app = scripted(&["now()", "It is early."], agent_file("", "[browser]"));
    let host = FakeBrowser::claiming("now", Ok("whatever the page says".into()));
    install_tool_host(&mut app.borrow_mut(), Rc::clone(&host) as Rc<dyn ToolHost>);
    ask(&app, "what time is it");

    let calls = invoked(&app);
    assert_eq!(calls.len(), 1, "one call, once: {calls:?}");
    assert!(
        calls[0].1 && calls[0].2.contains("ms since the Unix epoch"),
        "the compiled-in clock answered, not the host: {calls:?}"
    );
    assert_eq!(host.calls.get(), 0, "the host was never even asked");
}

/// A NAME NO FACULTY DECLARES IS STILL REFUSED IN WORDS, and no host gets to
/// answer for it. Installing a runner does not install a tool: the DECLARATION
/// is the pure half, `agent::faculty::of` (`crates/agent/src/faculty/mod.rs:45`),
/// and a call whose name is in no toolbox is refused by
/// `Toolbox::check` (`crates/agent/src/toolbox.rs:76`) before the executor —
/// and by `tools::run` (`crates/core/src/tools.rs:134`) if one ever reaches it
/// — in the same sentence, which is what lets the model correct itself.
#[test]
fn a_tool_no_faculty_declares_is_refused_before_any_host_is_asked() {
    let app = scripted(
        &["navigate({\"url\": \"https://example.com\"})", "I cannot."],
        agent_file("", "[browser]"),
    );
    let host = FakeBrowser::claiming("navigate", Ok("opened".into()));
    install_tool_host(&mut app.borrow_mut(), Rc::clone(&host) as Rc<dyn ToolHost>);
    ask(&app, "open the page");

    let calls = invoked(&app);
    assert_eq!(calls.len(), 1, "{calls:?}");
    assert!(
        !calls[0].1 && calls[0].2.starts_with("Tool not found. Available: "),
        "refused in the words that name what there is: {calls:?}"
    );
    assert_eq!(
        host.calls.get(),
        0,
        "a host runs what a faculty declared; it cannot declare one itself"
    );
}

/// THE ACTION HALF OF THE CHROME REQUIREMENT: a tool RUN by a host defined
/// outside `core`, and the twin of the perception proof above.
///
/// `FakeBrowser` lives in this test file, in a crate `core` has never heard
/// of, and `install_tool_host` is the only wiring it gets. Before this,
/// `tools::tool_entry` (`crates/core/src/tools.rs:107`) was a closed `match` in
/// the pure core and every call it did not answer fell through to a refusal —
/// so a browser faculty would have had its page snapshot rendered and its
/// `navigate` listed in the affordances, and then been refused on every call,
/// forever, with no fix short of editing this crate.
///
/// It runs `remember` rather than `navigate` because a name has to be DECLARED
/// before it can be called at all, and declaring is the PURE half: the `browser`
/// faculty has no arm in `agent::faculty::of`
/// (`crates/agent/src/faculty/mod.rs:45`), so `Toolbox::check`
/// (`crates/agent/src/toolbox.rs:76`) refuses `navigate` before the executor
/// ever sees it. `remember` IS declared — by the space faculty this agent names
/// — and the built-in handler DECLINES it for an agent with no space
/// (`crates/core/src/space/shared.rs:87`), which lands the call on exactly the
/// fallthrough a browser tool would take, and is the one a test can reach until
/// that arm exists.
#[test]
fn a_tool_run_by_a_host_outside_core_comes_back_as_a_successful_call() {
    let app = scripted(
        &["remember({\"key\": \"a\"})", "Noted."],
        agent_file("", "[space]"),
    );
    let host = FakeBrowser::claiming("remember", Ok("the host ran it".into()));
    install_tool_host(&mut app.borrow_mut(), Rc::clone(&host) as Rc<dyn ToolHost>);
    ask(&app, "remember it");

    let calls = invoked(&app);
    assert_eq!(host.calls.get(), 1, "the host was asked, once");
    assert_eq!(calls.len(), 1, "{calls:?}");
    assert!(calls[0].1, "a successful ToolInvoked, not a refusal: {calls:?}");
    assert!(
        calls[0].2.starts_with("the host ran it — remember{"),
        "the host's own answer, with the call it was handed: {calls:?}"
    );
    assert_eq!(core::answer(&app.borrow()).as_deref(), Some("Noted."));
}

/// NOTHING HERE RAISES. A host that fails says so IN THE RESULT, which is what
/// lets the model correct itself on the next pass (`crates/core/src/tools.rs:116-118`)
/// — the same discipline every compiled-in tool follows. A lost turn would
/// leave the model with no idea why the world did not move.
#[test]
fn a_host_that_fails_is_a_recorded_failed_call_and_not_a_lost_turn() {
    let app = scripted(
        &["remember({\"key\": \"a\"})", "I could not."],
        agent_file("", "[space]"),
    );
    let host = FakeBrowser::claiming("remember", Err("no page is open".into()));
    install_tool_host(&mut app.borrow_mut(), Rc::clone(&host) as Rc<dyn ToolHost>);
    ask(&app, "remember it");

    let calls = invoked(&app);
    assert_eq!(calls.len(), 1, "{calls:?}");
    assert!(!calls[0].1, "recorded as failed: {calls:?}");
    assert_eq!(calls[0].2, "no page is open", "in the host's own words");
    assert_eq!(
        core::answer(&app.borrow()).as_deref(),
        Some("I could not."),
        "and the turn went on to its next pass"
    );
    assert!(core::last_failure(&app.borrow()).is_none(), "nothing raised");
}
