//! INCREMENT 28 — THE PHASE, ON THE FACE OF THE CARD.
//!
//! The board could say a turn was up and how long it had been up, and nothing
//! about what part of it was running. `agent::stages` has emitted a fact per
//! stage since 20 and `core::fold` has read those facts since — to decide the
//! turn was not over. Nobody read WHICH one.
//!
//! Every assertion here is about a line a person reads, and the ones that
//! matter most are the negatives: a stage word is only ever printed because a
//! `STAGE_ENTERED` fact says so. Inferred from the `stages:` list it would be a
//! plausible sentence about a turn that had not got there yet, which is R17-P0-2
//! in a new place — a surface reporting the plan as the state.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
use core::{boot, drive, handle, install_agents, App, Ports};
use kernel::{ModelPort, ModelReply, Request, Timestamp};

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

/// A model that answers `replies` and then never answers again, so the turn is
/// still up when the board is read. The hang is the whole point: a finished
/// turn has no current stage, and every state worth asserting here is mid-turn.
struct AnswersThenHangs {
    replies: RefCell<Vec<String>>,
}

impl AnswersThenHangs {
    fn with(replies: &[&str]) -> Rc<Self> {
        Rc::new(Self {
            replies: RefCell::new(replies.iter().map(|r| (*r).to_string()).collect()),
        })
    }
}

impl ModelPort for AnswersThenHangs {
    fn call<'a>(
        &'a self,
        _endpoint: &'a kernel::EndpointName,
        _body_json: &'a str,
    ) -> kernel::BoxFuture<'a, Result<ModelReply, kernel::ModelError>> {
        let mut left = self.replies.borrow_mut();
        let next = match left.is_empty() {
            true => None,
            false => Some(left.remove(0)),
        };
        drop(left);
        match next {
            None => Box::pin(std::future::pending()),
            Some(text) => Box::pin(std::future::ready(Ok(ModelReply {
                body_json: ScriptedModel::text_reply(&text),
                usage: None,
            }))),
        }
    }
}

/// All four stages, so `stage N of 4` has something to be wrong about.
const STAGED: &str = "---\nname: main\ndescription: the lead\nspace: research\n\
     tools: [exec]\nstages: [plan, work, verify, critique]\n---\nbody";

/// The same agent with no stage machine at all — the compatibility case, and
/// the one I15 is about: it must say nothing about stages, not `stage 1 of 1`.
const PLAIN: &str = "---\nname: main\ndescription: the lead\nspace: research\n\
     tools: [exec]\n---\nbody";

fn booted(agent: &str, model: Rc<dyn ModelPort>) -> Rc<RefCell<App>> {
    let ports = Ports {
        model,
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new().answering("echo", 0, "hi")),
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents(&mut app, vec![("main".to_string(), agent.to_string())]);
    Rc::new(RefCell::new(app))
}

/// Accept an utterance without pumping it: the turn is queued, so the row is
/// live, and not one stage fact exists yet.
fn say(app: &Rc<RefCell<App>>, message: &str) {
    handle(&mut app.borrow_mut(), Request::post_form("/chat", &[("message", message)]));
}

/// Accept it and run until the model stops answering.
fn run(app: &Rc<RefCell<App>>, message: &str) {
    say(app, message);
    let mut turn = Box::pin(drive(Rc::clone(app)));
    let mut cx = Context::from_waker(Waker::noop());
    let _ = turn.as_mut().poll(&mut cx);
}

fn line(app: &Rc<RefCell<App>>) -> String {
    let board = handle(&mut app.borrow_mut(), Request::get("/board")).body;
    let at = board.find("data-agent=\"main\"").expect("main has a row");
    let (_, rest) = board[at..].split_once("data-line=\"").expect("the row's line");
    rest.split_once('"').map(|(v, _)| v.to_string()).unwrap_or_default()
}

/// WHICH STAGE, THEN HOW LONG, THEN WHAT IT RAN. One reply to the plan stage
/// moves the cursor to `work`, and the call that opens work never answers — so
/// this is a row a person would be looking at while the agent works.
#[test]
fn the_live_row_says_which_stage_of_how_many() {
    let app = booted(STAGED, AnswersThenHangs::with(&["OUTCOME — the file exists."]));
    run(&app, "write index.md");

    let said = line(&app);
    assert!(
        said.contains("stage 2 of 4: work · in this turn for"),
        "the stage comes first, then the clock: {said}"
    );
}

/// …AND IT IS THE STAGE THE LOG NAMES, NOT THE ONE THE FILE PLANS. The turn is
/// accepted and live, the file declares four stages, and no `STAGE_ENTERED`
/// fact exists yet: the row says what it said before and adds nothing. No
/// `plan`, no `stage 1 of 4`, no "starting…".
#[test]
fn a_stage_is_never_printed_before_a_fact_says_so() {
    let app = booted(STAGED, AnswersThenHangs::with(&[]));
    say(&app, "write index.md");

    let said = line(&app);
    assert!(said.contains("working"), "the row is live: {said}");
    assert!(!said.contains("stage"), "nothing has entered a stage yet: {said}");
    assert!(!said.contains("plan"), "the declared list is not a status: {said}");
}

/// …AND A STAGE DOES NOT OUTLIVE ITS TURN. One turn walks into `work`, the
/// person stops waiting, and a second utterance opens a new turn over the top:
/// the stage from the turn before is history, and history is not the live line.
#[test]
fn a_stage_does_not_carry_over_into_the_next_turn() {
    let app = booted(STAGED, AnswersThenHangs::with(&["OUTCOME — the file exists."]));
    run(&app, "write index.md");
    assert!(line(&app).contains("stage 2 of 4"), "the first turn is in work");

    say(&app, "and now write README.md");
    let said = line(&app);
    assert!(!said.contains("stage"), "a new turn has entered no stage: {said}");
    assert!(!said.contains("work ·"), "and carries none over: {said}");
}

/// AN AGENT WITH NO STAGE MACHINE SAYS NOTHING ABOUT STAGES (I15). It is mid-
/// turn, the clock is on the row, and there is no `stage 1 of 1` — a turn that
/// has one part is not a turn with a part worth naming.
#[test]
fn an_agent_that_declares_no_stages_says_nothing_about_them() {
    let app = booted(PLAIN, AnswersThenHangs::with(&[]));
    run(&app, "write index.md");

    let said = line(&app);
    assert!(said.contains("in this turn for"), "the turn is live: {said}");
    assert!(!said.contains("stage"), "no stage machine, no stage word: {said}");
}

/// A FINISHED TURN HAS NO CURRENT STAGE. The four stages run to the end and the
/// agent answers; the row is the idle row it always was, with no `critique`
/// left on it.
#[test]
fn a_turn_that_ended_leaves_no_stage_on_the_row() {
    let app = booted(
        STAGED,
        Rc::new(ScriptedModel::with_replies(
            ["OUTCOME — done.", "Wrote it.", "`ls` shows index.md.", "Nothing missing."]
                .iter()
                .map(|r| ScriptedModel::text_reply(r))
                .collect(),
        )),
    );
    say(&app, "write index.md");
    block_on(drive(Rc::clone(&app))).expect("the turn runs");

    let said = line(&app);
    assert!(said.contains("ready"), "the turn ended: {said}");
    assert!(!said.contains("stage"), "and left no stage behind: {said}");
}

/// THE ROW'S WORD IS THE WORD THE PRODUCT ALREADY DEFINED. `crates/ui`'s roster
/// card is the one place plan/work/verify/critique are explained in ordinary
/// language; a row that invented `executing` would be a fifth vocabulary for a
/// reader to learn. Read off the source so a rewrite of either side is caught
/// here rather than on the page (`critic27.rs`'s rule, applied to a stage name).
#[test]
fn the_stage_word_is_the_one_the_roster_defines() {
    let roster = include_str!("../../ui/src/board/roster.rs");
    let paragraph = roster.split("A turn can run in stages.").nth(1).expect("the stage paragraph");
    let app = booted(STAGED, AnswersThenHangs::with(&["OUTCOME — the file exists."]));
    run(&app, "write index.md");

    // The stage NAME follows the count inside one clause — `stage 2 of 4: work`
    // — because the row opens with a status word and `working · … · work` read
    // as one word stuttering. Whatever that name is, the Agents view has to
    // define it: this asserts the two sides use the same vocabulary, so a
    // rename on either one fails here rather than in front of a reader.
    let said = line(&app);
    let clause = said
        .split(" · ")
        .find(|p| p.starts_with("stage "))
        .expect("the count clause");
    let word = clause.rsplit(": ").next().expect("the stage name");
    assert_eq!(word, "work");
    assert!(paragraph.contains(&format!("{word} ")), "`{word}` is defined on the Agents card");
}
