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
//!
//! The last six are the WHOLE PATH, walked once end to end on the second real
//! faculty (`memory`): a config declares it, its block renders before every
//! model call, its tools are offered, the model calls one, the host installed
//! by `boot` runs it, the answer comes back as a successful call — and the line
//! is still there on the next turn and after a reboot on the same store. That
//! is the round's claim: a faculty declaring a tool NO TABLE IN THIS CRATE
//! CLAIMS actually works.

use std::cell::Cell;
use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{DenyAllNet, FixedClock, MemStore, ScriptedAgents, ScriptedModel, SeededRng};
use core::{
    boot, drive, handle, install_agents_as, install_sense, install_tool_host, App, Args, Ports,
    Sense, Sensing, ToolHost,
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
/// An empty `tools:` list is NOT an empty toolbox — it means "everything this
/// file's faculties and the built-ins offer" (`agent::subagent::resolve`), so
/// this is the file a faculty test wants unless it is testing the allowlist.
fn agent_file(space: &str, faculties: &str) -> Vec<(String, String)> {
    agent_file_with_tools(space, faculties, "[]")
}

/// The same file with an explicit `tools:` allowlist, which is the whole
/// allowlist: a non-empty list can only PICK FROM what the faculties offer.
fn agent_file_with_tools(space: &str, faculties: &str, tools: &str) -> Vec<(String, String)> {
    vec![(
        "main".to_string(),
        format!(
            "---\nname: main\ndescription: main does a thing\nspace: {space}\n\
             faculties: {faculties}\ntools: {tools}\n---\nbody"
        ),
    )]
}

fn booted(model: Rc<dyn ModelPort>, files: Vec<(String, String)>) -> Rc<RefCell<App>> {
    booted_on(model, files, Rc::new(MemStore::default()))
}

/// The same app on a store the test already holds — the only way to boot a
/// SECOND app on the first one's bytes, which is what "survives a reload"
/// means when there is no browser to reload.
fn booted_on(
    model: Rc<dyn ModelPort>,
    files: Vec<(String, String)>,
    store: Rc<MemStore>,
) -> Rc<RefCell<App>> {
    let ports = Ports {
        model,
        store: store as Rc<dyn kernel::StorePort>,
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
    fn run<'a>(&'a self, tool: &'a str, args: &'a Args) -> BoxFuture<'a, Result<String, String>> {
        self.calls.set(self.calls.get() + 1);
        let answer = match &self.answer {
            // `Args::raw` — the bytes the model sent. A host that echoes its
            // call must show what the transcript shows, which is why the reader
            // keeps the string as well as the parse.
            Ok(said) => Ok(format!("{said} — {tool}{}", args.raw())),
            Err(problem) => Err(problem.clone()),
        };
        Box::pin(std::future::ready(answer))
    }
}

/// An app whose model says exactly these things, in order — the only way to
/// reach the tool executor, which runs what a model asked for and nothing else.
fn scripted(replies: &[&str], files: Vec<(String, String)>) -> Rc<RefCell<App>> {
    scripted_on(replies, files, Rc::new(MemStore::default()))
}

/// The same, on a store the test holds.
fn scripted_on(
    replies: &[&str],
    files: Vec<(String, String)>,
    store: Rc<MemStore>,
) -> Rc<RefCell<App>> {
    let model = ScriptedModel::with_replies(
        replies.iter().map(|r| ScriptedModel::text_reply(r)).collect(),
    );
    booted_on(Rc::new(model) as Rc<dyn ModelPort>, files, store)
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
/// is the pure half, `agent::faculty::of` (`crates/agent/src/faculty/mod.rs:65`),
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
/// (`crates/agent/src/faculty/mod.rs:65`), so `Toolbox::check`
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

/// A model that answers from a script AND keeps every request body. The tests
/// below need both halves at once: the model has to CALL `keep`, and the test
/// has to read the prompt the NEXT call was handed.
struct Script {
    replies: RefCell<Vec<String>>,
    seen: RefCell<Vec<String>>,
}

impl Script {
    fn saying(replies: &[&str]) -> Rc<Script> {
        Rc::new(Script {
            replies: RefCell::new(replies.iter().rev().map(|r| r.to_string()).collect()),
            seen: RefCell::new(Vec::new()),
        })
    }
    fn last_prompt(&self) -> String {
        self.seen.borrow().last().cloned().unwrap_or_default()
    }
    fn prompts(&self) -> usize {
        self.seen.borrow().len()
    }
}

impl ModelPort for Script {
    fn call<'a>(
        &'a self,
        _endpoint: &'a kernel::EndpointName,
        body_json: &'a str,
    ) -> BoxFuture<'a, Result<kernel::ModelReply, kernel::ModelError>> {
        self.seen.borrow_mut().push(body_json.to_string());
        let text = self
            .replies
            .borrow_mut()
            .pop()
            .unwrap_or_else(|| "Nothing more.".to_string());
        Box::pin(std::future::ready(Ok(kernel::ModelReply {
            body_json: ScriptedModel::text_reply(&text),
            usage: None,
        })))
    }
}

/// Every line the store itself holds under memory's prefix, in key order —
/// the bytes, not the render. A test that only read the prompt could not tell
/// a kept line from a remembered one.
fn stored(store: &Rc<MemStore>) -> Vec<String> {
    let kv = kernel::StorePort::kv(store.as_ref());
    block_on(kv.list_prefix("memory/"))
        .expect("the store lists")
        .iter()
        .filter_map(|key| block_on(kv.get(key)).expect("the store reads"))
        .collect()
}

/// THE HEADLINE PROOF: a faculty's tool that NO TABLE IN `core` CLAIMS is run
/// by the host `boot` installed for it, and comes back as an ordinary
/// successful call.
///
/// `keep` has no arm in `tools::tool_entry` and no arm in `tools::run`
/// (`crates/core/src/tools.rs`), and it is not in `agent::builtin_tools` —
/// both asserted below. So the call reached `faculty::run_hosted`
/// (`crates/core/src/batch.rs`, the middle rung of `invoke`) or it reached
/// nothing at all, and "nothing" has a signature this test rules out: the
/// refusal sentence `Toolbox::check` and `tools::run` both write. What ran it is `memory::host::MemoryHost`, which
/// no test and no composition root installed — `boot` did, because the
/// capability is an injected port.
#[test]
fn a_faculty_tool_no_core_table_claims_is_run_by_its_installed_host() {
    let app = scripted(
        &[
            "keep({\"note\": \"the user prefers metric units\"})",
            "Noted.",
        ],
        agent_file("", "[memory]"),
    );
    ask(&app, "remember how I like units");

    let calls = invoked(&app);
    assert_eq!(calls.len(), 1, "one call, once: {calls:?}");
    assert_eq!(calls[0].0, "keep");
    assert!(calls[0].1, "a successful ToolInvoked: {calls:?}");
    assert!(
        calls[0].2.starts_with("Kept."),
        "the PURE half's own success sentence, unedited by the host: {calls:?}"
    );
    assert!(
        !calls[0].2.starts_with("Tool not found. Available: "),
        "no table in core refused it: {calls:?}"
    );
    assert!(
        agent::builtin_tools().get("keep").is_none(),
        "and `keep` is not a compiled-in tool — nothing in this crate could \
         have answered it but the installed host"
    );
    assert_eq!(core::answer(&app.borrow()).as_deref(), Some("Noted."));
}

/// THE BLOCK RENDERS BEFORE EVERY CALL. What the host wrote to the store on
/// turn one is inside the paper the model is handed on turn two, under the
/// faculty's own `## memory` heading — which is `refresh_all` running at the
/// top of every `drive` pass (`crates/core/src/runtime/mod.rs:59`) reading
/// `MemorySense`, and not anything the turn that kept it did.
#[test]
fn what_a_host_kept_is_in_the_next_prompt_the_model_is_given() {
    let model = Script::saying(&[
        "keep({\"note\": \"the user prefers metric units\"})",
        "Noted.",
        "I know.",
    ]);
    let app = booted_on(
        Rc::clone(&model) as Rc<dyn ModelPort>,
        agent_file("", "[memory]"),
        Rc::new(MemStore::default()),
    );
    ask(&app, "remember how I like units");
    let after_first_turn = model.prompts();
    ask(&app, "what do you know about me?");

    assert!(
        model.prompts() > after_first_turn,
        "the second turn really did call the model"
    );
    let prompt = model.last_prompt();
    assert!(prompt.contains("## memory"), "{prompt}");
    assert!(prompt.contains("the user prefers metric units"), "{prompt}");
    assert!(
        sensed(&app, "memory").contains("the user prefers metric units"),
        "and it got there through AgentState.senses, keyed by the block id"
    );
}

/// THE CLAIM THE TOOL DESCRIPTION MAKES TO THE MODEL — "it survives a reload"
/// — is true. A second `App` is booted on the SAME store and nothing else in
/// common: fresh model, fresh clock, fresh everything. The line is in its
/// prompt, because memory is the store and the store outlived the process.
#[test]
fn memory_survives_a_reboot_on_the_same_store() {
    let store = Rc::new(MemStore::default());
    let first = scripted_on(
        &[
            "keep({\"note\": \"the user prefers metric units\"})",
            "Noted.",
        ],
        agent_file("", "[memory]"),
        Rc::clone(&store),
    );
    ask(&first, "remember how I like units");
    assert_eq!(stored(&store).len(), 1, "one key, one line");

    let model = Script::saying(&["I still know."]);
    let second = booted_on(
        Rc::clone(&model) as Rc<dyn ModelPort>,
        agent_file("", "[memory]"),
        Rc::clone(&store),
    );
    ask(&second, "what do you know about me?");

    assert!(
        model
            .last_prompt()
            .contains("the user prefers metric units"),
        "the rebooted app read it back out of the store: {}",
        model.last_prompt()
    );
    assert!(sensed(&second, "memory").contains("the user prefers metric units"));
}

/// DISCARD IS A DELETION, in the prompt AND in the store. A line that vanished
/// from the block but stayed on disk would come back at the next reload, which
/// is the failure a person would find months later and never explain.
#[test]
fn discarding_removes_the_line_from_the_prompt_and_from_the_store() {
    let store = Rc::new(MemStore::default());
    let app = scripted_on(
        &[
            "keep({\"note\": \"the user prefers metric units\"})",
            "keep({\"note\": \"the deploy target is gh-pages\"})",
            "discard({\"note\": \"the user prefers metric units\"})",
            "Done.",
        ],
        agent_file("", "[memory]"),
        Rc::clone(&store),
    );
    ask(&app, "sort out what you know");

    let calls = invoked(&app);
    assert_eq!(calls.len(), 3, "{calls:?}");
    assert!(calls.iter().all(|c| c.1), "all three succeeded: {calls:?}");
    assert_eq!(
        stored(&store),
        vec!["the deploy target is gh-pages".to_string()],
        "one key left, and it is the one that was not discarded"
    );
    let block = sensed(&app, "memory");
    assert!(block.contains("the deploy target is gh-pages"), "{block}");
    assert!(!block.contains("metric units"), "{block}");

    let model = Script::saying(&["Still one thing."]);
    let after = booted_on(
        Rc::clone(&model) as Rc<dyn ModelPort>,
        agent_file("", "[memory]"),
        Rc::clone(&store),
    );
    ask(&after, "what do you know about me?");
    assert!(model
        .last_prompt()
        .contains("the deploy target is gh-pages"));
    assert!(!model.last_prompt().contains("metric units"));
}

/// DEFAULT DENY (I6, ADR-006). The host is installed in every app `boot`
/// builds, and it is still not a tool: `keep` is offered only to an agent whose
/// file DECLARES the faculty. This agent declares none, so `Toolbox::check`
/// (`crates/agent/src/toolbox.rs:76`) refuses the name before the executor, in
/// the words that say what there is instead — and nothing reaches the store.
///
/// It asks for `keep` in its `tools:` allowlist as loudly as a file can, which
/// is the sharper form of the same point: an allowlist PICKS FROM what the
/// faculties offer (`crates/agent/src/subagent.rs:68-72`) and can never add to
/// it. Declaring the faculty is the only way in.
#[test]
fn an_agent_that_does_not_declare_memory_cannot_call_keep() {
    let store = Rc::new(MemStore::default());
    let app = scripted_on(
        &["keep({\"note\": \"something private\"})", "I cannot."],
        agent_file_with_tools("", "[]", "[keep]"),
        Rc::clone(&store),
    );
    ask(&app, "remember something");

    let calls = invoked(&app);
    assert_eq!(calls.len(), 1, "{calls:?}");
    assert!(!calls[0].1, "refused: {calls:?}");
    assert!(
        calls[0].2.starts_with("Tool not found. Available: "),
        "refused in the words that name what there is: {calls:?}"
    );
    assert!(
        stored(&store).is_empty(),
        "installing a runner does not install a tool: nothing was written"
    );
}

/// THE CAP IS A CAP, AND IT DROPS THE RIGHT END. `MEMORY_LIMIT + 2` lines are
/// kept in one turn; the store and the block both hold exactly `MEMORY_LIMIT`,
/// ending with the newest and no longer holding the two oldest. The trim
/// deletes from the FRONT because `list_prefix` is sorted and the key is
/// time-then-counter — which is also the proof the counter works, since all
/// twenty-two of these puts share one millisecond on `FixedClock`.
#[test]
fn a_full_memory_drops_the_oldest_line_and_not_the_newest() {
    let store = Rc::new(MemStore::default());
    let mut replies: Vec<String> = (0..agent::MEMORY_LIMIT + 2)
        .map(|n| format!("keep({{\"note\": \"note-{n:02}\"}})"))
        .collect();
    replies.push("Done.".to_string());
    let script: Vec<&str> = replies.iter().map(String::as_str).collect();
    let app = scripted_on(&script, agent_file("", "[memory]"), Rc::clone(&store));
    ask(&app, "keep all of these");

    let lines = stored(&store);
    assert_eq!(
        lines.len(),
        agent::MEMORY_LIMIT,
        "twenty-two puts, twenty keys — every one of them distinct, or the \
         counter is not doing its job: {lines:?}"
    );
    assert_eq!(lines.first().map(String::as_str), Some("note-02"));
    assert_eq!(lines.last().map(String::as_str), Some("note-21"));

    let block = sensed(&app, "memory");
    assert!(block.contains("note-21"), "the newest is there: {block}");
    assert!(block.contains("note-02"), "{block}");
    assert!(!block.contains("note-00"), "the oldest fell off: {block}");
    assert!(!block.contains("note-01"), "and so did the next: {block}");
}
