//! TWO APPS, ONE STORE — the cross-context claim, executed (I17).
//!
//! `crates/core/tests/conversations.rs:155` already proves "a conversation
//! survives a reload", and it proves it by handing both apps the SAME
//! `Rc<MemStore>`: one `HashMap`, one process, futures that are ready before
//! they are polled. Nothing in it could fail the way the real thing fails —
//! a transaction that has not committed when the second reader looks, a
//! `replace_prefix` that leaves a hole, a second connection to a database that
//! is still upgrading.
//!
//! Here each app gets its OWN `IdbStore::open` handle on one database name,
//! which is exactly the arrangement the page and a sub-agent's Worker are in
//! (`crates/adapters_web/src/lib.rs:96-99` opens `SPACES_DB` for that reason).
//! Only the store is real; the model, clock, rng and agents stay in-memory, so
//! a failure here is a failure of the store or of the log's I/O and of nothing
//! else.

use std::cell::RefCell;
use std::rc::Rc;

use adapters_test::{DenyAllNet, FakeShell, FixedClock, MemKv, ScriptedAgents, ScriptedModel, SeededRng};
use adapters_web::IdbStore;
use harness::{boot, drive, handle, install_agents, App, Ports};
use kernel::{Request, Timestamp};
use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

wasm_bindgen_test_configure!(run_in_browser);

fn agent_files() -> Vec<(String, String)> {
    vec![(
        "main".to_string(),
        "---\nname: main\ndescription: the lead\ntools: []\n---\nbody".to_string(),
    )]
}

/// One app on its own connection to `db`. A fresh `open` per app, never a
/// cloned handle: sharing the handle would be the `Rc<MemStore>` shortcut again,
/// one layer down.
async fn booted_on(db: &str, replies: &[&str]) -> Rc<RefCell<App>> {
    let store = Rc::new(IdbStore::open(db).await.expect("IdbStore::open"));
    let ports = Ports {
        model: Rc::new(ScriptedModel::with_replies(
            replies.iter().map(|r| ScriptedModel::text_reply(r)).collect(),
        )),
        store,
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new()),
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

fn chat(app: &Rc<RefCell<App>>) -> String {
    handle(&mut app.borrow_mut(), Request::get("/chat")).body
}

/// What one context wrote, another context READS — through IndexedDB, with no
/// shared object between them. The second app is booted after the first has
/// driven its turn, so if the log's writes were still in flight when `boot`
/// replayed, this is where it shows.
#[wasm_bindgen_test]
async fn a_second_app_on_the_same_database_reads_what_the_first_one_wrote() {
    let first = booted_on("contexts-one", &["Tin is $34,000/t."]).await;
    say(&first, "what does tin cost?").await;

    let second = booted_on("contexts-one", &[]).await;
    let theirs = chat(&second);
    assert!(theirs.contains("what does tin cost?"), "the question: {theirs}");
    assert!(theirs.contains("Tin is $34,000/t."), "and the answer: {theirs}");
}

/// …AND NEITHER CONTEXT'S WRITES REPLACE THE OTHER'S. Both apps number their
/// entries from their own replayed memory (`log::decisions::key`), so a second
/// app that had replayed nothing would restart the sequence and overwrite the
/// first one's keys — the exact corruption `Writership` exists to prevent, and
/// the reason this asserts on BOTH turns rather than on the last.
#[wasm_bindgen_test]
async fn turns_taken_in_two_contexts_both_survive_into_a_third() {
    let first = booted_on("contexts-two", &["The first answer."]).await;
    say(&first, "first question").await;

    let second = booted_on("contexts-two", &["The second answer."]).await;
    say(&second, "second question").await;

    let third = booted_on("contexts-two", &[]).await;
    let all = chat(&third);
    for expected in ["first question", "The first answer.", "second question", "The second answer."] {
        assert!(all.contains(expected), "missing {expected:?} from: {all}");
    }
    let first_at = all.find("first question").expect("first question");
    let second_at = all.find("second question").expect("second question");
    assert!(first_at < second_at, "and in the order they happened: {all}");
}
