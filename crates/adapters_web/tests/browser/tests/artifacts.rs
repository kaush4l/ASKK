//! **ONE SHELF ACROSS TWO CONTEXTS, EXECUTED (I17).** Agent A records an
//! artifact; agent B — a different app, on its own connection to the same
//! `harness-spaces` database — reads the name and the description in its next
//! PROMPT, in its `## artifacts` section, without ever opening the file.
//!
//! **WHY THIS IS TWO APPS AND NOT TWO `Worker`s, stated rather than glossed.**
//! The criterion asked for two real Workers. A Worker running the agent loop is
//! booted by `AgentWorkers` from the shipped worker bundle, which this suite
//! does not build; what a Worker actually CONTRIBUTES to this claim is a
//! separate JS context with no shared memory, holding its own `IdbStore::open`
//! handle on one database name (`crates/adapters_web/src/worker/world.rs:40`).
//! `contexts.rs:10-16` beside this made exactly that argument for the log, and
//! the arrangement is the same one: each app opens the database itself, never a
//! cloned handle, so a write that had not committed when the second reader
//! looked is a failure this test can see. What it does NOT prove is that the
//! Worker's message plumbing works, and that is `crashed_peer.rs`'s subject.
//!
//! **AND B'S WORKSPACE REFUSES**, which is the other half of the ruling. A
//! sub-agent's Worker is handed a `C2wWorkspace` that answers *"the workspace
//! runs in the page, not in an agent's Worker"* (`c2w.js:72`). B is given a
//! workspace in exactly that state, so if the shelf had needed the file to be
//! readable in the reading thread, B's block would be empty here.

use std::cell::RefCell;
use std::rc::Rc;

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, ScriptedAgents, ScriptedModel, SeededRng,
};
use adapters_web::IdbStore;
use harness::{boot, drive, handle, install_agents, App, Ports};
use kernel::{BoxFuture, EndpointName, ModelError, ModelPort, ModelReply, Request, Timestamp};
use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

wasm_bindgen_test_configure!(run_in_browser);

/// A model that answers from a script and KEEPS every request body — the only
/// way to assert what actually reached the model, which is what "B's next
/// prompt renders it" has to mean. The same shape `crates/core/tests/
/// faculty.rs:53-79` uses on the host.
#[derive(Default)]
struct Recorder {
    replies: RefCell<Vec<String>>,
    seen: RefCell<Vec<String>>,
}

impl Recorder {
    fn with(replies: &[&str]) -> Rc<Recorder> {
        Rc::new(Recorder {
            replies: RefCell::new(replies.iter().map(|r| (*r).to_string()).collect()),
            seen: RefCell::new(Vec::new()),
        })
    }
    fn last_prompt(&self) -> String {
        self.seen.borrow().last().cloned().unwrap_or_default()
    }
}

impl ModelPort for Recorder {
    fn call<'a>(
        &'a self,
        _endpoint: &'a EndpointName,
        body_json: &'a str,
    ) -> BoxFuture<'a, Result<ModelReply, ModelError>> {
        self.seen.borrow_mut().push(body_json.to_string());
        // ONE BORROW, ENDED BEFORE THE ARM. `match self.replies.borrow_mut()
        // .is_empty()` holds the guard across the arm that borrows again, which
        // is `RefCell already borrowed` — the same trap `core` documents around
        // every await.
        let next = {
            let mut queue = self.replies.borrow_mut();
            match queue.is_empty() {
                true => "nothing more to do".to_string(),
                false => queue.remove(0),
            }
        };
        Box::pin(std::future::ready(Ok(ModelReply {
            body_json: ScriptedModel::text_reply(&next),
            usage: None,
        })))
    }
}

const ROOT: &str = "/root/spaces/research";

fn agent_files() -> Vec<(String, String)> {
    vec![(
        "main".to_string(),
        "---\nname: main\ndescription: the lead\nspace: research\nfaculties: [artifacts]\n\
         tools: []\n---\nbody"
            .to_string(),
    )]
}

/// One app on its OWN connection to `spaces_db`. A fresh `open` per app, never a
/// cloned handle: sharing the handle would be the one-process shortcut this
/// whole file exists to avoid.
async fn booted_on(
    spaces_db: &str,
    model: Rc<Recorder>,
    workspace: Rc<FakeShell>,
) -> Rc<RefCell<App>> {
    let spaces = IdbStore::open(spaces_db).await.expect("IdbStore::open");
    let ports = Ports {
        model,
        // The agent's OWN log stays in memory: this test is about the SPACES
        // database and nothing else, and `contexts.rs` already owns the log's
        // cross-context claim.
        store: Rc::new(adapters_test::MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(spaces) as Rc<dyn kernel::KvStore>,
        workspace,
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = boot(ports).await.expect("boot succeeds");
    install_agents(&mut app, agent_files());
    Rc::new(RefCell::new(app))
}

async fn say(app: &Rc<RefCell<App>>, message: &str) {
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", message)]),
    );
    drive(Rc::clone(app)).await.expect("the turn drives");
}

/// A workspace in the state a sub-agent's Worker's really is in.
fn a_worker_workspace() -> Rc<FakeShell> {
    Rc::new(FakeShell::unavailable(
        "the workspace runs in the page, not in an agent's Worker",
    ))
}

const RECORD: &str = r#"record_artifact({"name": "out/survey.md", "description": "what the tin survey found", "kind": "report", "audience": "the lead"})"#;

/// **THE CROSS-THREAD CLAIM.** A records with a workspace that can see the file;
/// B, on its own handle on the same database and with a workspace that refuses,
/// reads the name AND the description in its next prompt's `## artifacts`.
#[wasm_bindgen_test]
async fn what_one_context_recorded_the_next_ones_prompt_names_and_describes() {
    let held = Rc::new(FakeShell::holding(&[(&format!("{ROOT}/out/survey.md"), "tin: $34,000/t")]));
    let a = booted_on("shelf-one", Recorder::with(&[RECORD, "recorded"]), held).await;
    say(&a, "survey the tin market and write it up").await;

    let watching = Recorder::with(&["understood"]);
    let b = booted_on("shelf-one", Rc::clone(&watching), a_worker_workspace()).await;
    say(&b, "what has this group produced?").await;

    let prompt = watching.last_prompt();
    let at = prompt
        .find("## artifacts")
        .unwrap_or_else(|| panic!("no artifacts block in: {prompt}"));
    let block = &prompt[at..];
    assert!(block.contains("out/survey.md"), "the name: {block}");
    assert!(block.contains("what the tin survey found"), "and the description: {block}");
    // …and the size A measured travelled with it, because A's port could look.
    assert!(block.contains("14 bytes"), "the size A's workspace confirmed: {block}");
}

/// **THE OTHER HALF OF THE RULING, EXECUTED.** A records from a thread whose
/// workspace REFUSES — the sub-agent's Worker exactly. The record still crosses;
/// what does not cross is a size nobody measured, and the block says so.
///
/// Without the gate this increment chose, `record_artifact` here would either
/// have refused (no shelf at all from a Worker) or claimed a number it never
/// read. Both are visible in this one assertion.
#[wasm_bindgen_test]
async fn a_context_with_no_workspace_still_records_and_claims_no_size() {
    let a = booted_on("shelf-two", Recorder::with(&[RECORD, "recorded"]), a_worker_workspace()).await;
    say(&a, "write it up").await;

    let watching = Recorder::with(&["understood"]);
    let b = booted_on("shelf-two", Rc::clone(&watching), a_worker_workspace()).await;
    say(&b, "what has this group produced?").await;

    let prompt = watching.last_prompt();
    let at = prompt
        .find("## artifacts")
        .unwrap_or_else(|| panic!("no artifacts block in: {prompt}"));
    let block = &prompt[at..];
    assert!(block.contains("out/survey.md"), "it crossed anyway: {block}");
    assert!(block.contains("what the tin survey found"), "described: {block}");
    assert!(block.contains("unconfirmed"), "and honest about the size: {block}");
    assert!(!block.contains(" bytes"), "no number is claimed: {block}");
}

/// AND THE SHELF IS THE SPACE'S, NOT THE PAGE'S. An app on a DIFFERENT spaces
/// database sees nothing — which is what says the block above came out of the
/// store rather than out of anything this process happened to be holding.
#[wasm_bindgen_test]
async fn a_context_on_another_spaces_database_sees_no_shelf_at_all() {
    let held = Rc::new(FakeShell::holding(&[(&format!("{ROOT}/out/survey.md"), "tin")]));
    let a = booted_on("shelf-three", Recorder::with(&[RECORD, "recorded"]), held).await;
    say(&a, "write it up").await;

    let watching = Recorder::with(&["understood"]);
    // A MemKv, which is a store nobody wrote to — the negative control.
    let elsewhere = {
        let ports = Ports {
            model: Rc::clone(&watching) as Rc<dyn ModelPort>,
            store: Rc::new(adapters_test::MemStore::default()),
            net: Rc::new(DenyAllNet),
            clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
            rng: Rc::new(SeededRng::seeded(7)),
            spaces: Rc::new(MemKv::new()) as Rc<dyn kernel::KvStore>,
            workspace: a_worker_workspace(),
            agents: Rc::new(ScriptedAgents::none()),
        };
        let mut app = boot(ports).await.expect("boot succeeds");
        install_agents(&mut app, agent_files());
        Rc::new(RefCell::new(app))
    };
    say(&elsewhere, "what has this group produced?").await;
    assert!(
        !watching.last_prompt().contains("out/survey.md"),
        "a shelf it never shared: {}",
        watching.last_prompt()
    );
}
