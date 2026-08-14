//! Round 16's four naming findings, as the projection now words them (I3).
//!
//! Three of the four are one rule each: `Worker` is an implementation noun and
//! is not printed for a reader; the board's count is a LIFETIME total and says
//! so; `engine` names the Linux in Settings and nothing else a reader sees.
//!
//! The fourth is a correction. The round-15 pass collapsed `shared space` into
//! `workspace` because the two named one directory. The round-16 critic read
//! the same word as two mechanisms — a shared store the three space tools
//! write to, and a folder — and the code agrees with the critic: the facts and
//! notes live in one IndexedDB database every Worker opens
//! (`adapters_web::worker`), while the folder is CheerpX in the page and a
//! sub-agent's `exec` is refused outright. So the noun stays one and the
//! sentences stop claiming the folder is the shared thing.

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

const MAIN: &str = "---\nname: main\ndescription: the lead\nspace: research\ntools: []\n---\nbody";
const PEER: &str = "---\nname: researcher\ndescription: reads\nspace: research\ntools: []\n\
                    engine: react\n---\nbody";

fn booted() -> Rc<RefCell<App>> {
    let mut app = block_on(boot(Ports {
        model: Rc::new(ScriptedModel::with_replies(vec!["one".into(), "two".into()])),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    }))
    .expect("boot succeeds");
    install_agents(
        &mut app,
        vec![
            ("main".to_string(), MAIN.to_string()),
            ("researcher".to_string(), PEER.to_string()),
        ],
    );
    Rc::new(RefCell::new(app))
}

fn get(app: &Rc<RefCell<App>>, path: &str, who: &str) -> String {
    handle(&mut app.borrow_mut(), Request::get(path).with_header("x-agent", who)).body
}

/// R16-2. `Worker` was printed in seven sentences, capitalised like a proper
/// noun and defined in none of them, and nothing a reader does depends on it:
/// every one of those sentences was about an agent running on its own. The
/// panels a reader meets first are the ones measured here.
#[test]
fn no_panel_prints_the_word_worker_at_a_reader() {
    let app = booted();
    for (path, who) in [
        ("/terminal", "main"),
        ("/terminal", "researcher"),
        ("/trace", "researcher"),
        ("/space", "main"),
        ("/logs", "researcher"),
    ] {
        let said = get(&app, path, who);
        assert!(!said.contains("Worker"), "{path} for {who} still says Worker: {said}");
    }
}

/// R16-3. The count is every turn the agent has ever taken, replayed out of
/// its log — the critic read `working · 2 turns` beside a running task as "this
/// task has taken 2". The words say which it is; the live clause beside it
/// ("in this turn for Ns") is the per-task one, and they no longer collide.
#[test]
fn the_board_says_its_turn_count_is_a_lifetime_total() {
    let app = booted();
    let board = get(&app, "/board", "main");
    assert!(board.contains("no turns yet"), "an agent that has not worked: {board}");
    say(&app, "main");
    let board = get(&app, "/board", "main");
    assert!(board.contains("1 turn in all"), "one turn, and it says in all: {board}");
    say(&app, "main");
    let board = get(&app, "/board", "main");
    assert!(board.contains("2 turns in all"), "and two: {board}");
}

/// One whole turn: the count rises when the agent ENTERS Working, which the
/// async half does, so the request alone leaves the board on "no turns yet".
fn say(app: &Rc<RefCell<App>>, who: &str) {
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", "hello")]).with_header("x-agent", who),
    );
    block_on(drive(Rc::clone(app))).expect("the turn drives");
}

/// R16-4. `engine` means the Linux in Settings — CheerpX or container2wasm —
/// and the agent card's fallback for an unrecognised `engine:` value was the
/// only other place a reader met the word. The YAML key is untouched: files
/// depend on it.
///
/// AMENDED (increment 19): there is no unrecognised value left to gloss.
/// `How it works: wanderer` printed the file's own word as though it named
/// something the machine would do, over a key that selected nothing — so the
/// value is now refused where `compact_at: lots` is, and the third arm is gone.
/// The word `engine` is still nowhere on the card, which is what R16-4 asked.
#[test]
fn the_agent_card_does_not_call_the_agent_loop_an_engine() {
    let app = booted();
    let cards = get(&app, "/agents", "main");
    assert!(!cards.contains("Engine: "), "engine is the Linux's word: {cards}");
    assert!(!cards.contains("How it works:"), "no value is glossed as a fact now: {cards}");
    assert!(
        agent::parse_agent_file("w", "---\nname: w\ndescription: d\nengine: wanderer\n---\nb")
            .is_err(),
        "and an engine this build cannot run does not load at all"
    );
}

/// R16-1, the correction. A workspace is one noun for one place, and what the
/// agents naming it actually SHARE is the facts and notes — the folder is this
/// page's own Linux, which a sub-agent cannot reach at all. The note under the
/// scrollback used to promise "the same folder as every other agent whose file
/// names it", which is the one claim the runtime does not keep.
#[test]
fn the_workspace_note_shares_the_facts_and_notes_not_the_folder() {
    let app = booted();
    let said = get(&app, "/terminal", "main");
    assert!(
        !said.contains("same folder as every other agent"),
        "the folder is not the shared thing: {said}"
    );
    assert!(
        said.contains("shares is its facts and notes"),
        "…and the sentence says what is: {said}"
    );
    let panel = get(&app, "/space", "main");
    assert!(
        panel.contains("the facts and notes below; the folder is this page&#39;s own")
            || panel.contains("the facts and notes below; the folder is this page's own"),
        "the workspace panel draws the same line: {panel}"
    );
}
