//! INCREMENT 31 — THE LOOP YOU CAN SEE, AND CAN FIND.
//!
//! `agent::passes` walks the `stages:` list more than once per turn, and its own
//! doc says `PASS_SPENT` exists "so the passes are VISIBLE". The board did not
//! read it: 28 put the stage on the live row and left the lap out by name. And
//! of the eight shipped agents exactly one declares `passes:`, with no surface
//! saying which — `main` and `builder` printed the identical loop line.
//!
//! The negatives carry this file, as they did in 28. A lap count is what HAS
//! happened: it comes from a fact, it never comes from the `passes:` budget, it
//! is silent on the first lap and silent for an agent that cannot lap at all,
//! and it says `up to` because the machine may stop before the budget does.

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

/// 28's model: answers `replies`, then never answers again, so the turn is still
/// up when the row is read. Every lap worth asserting is a lap in progress.
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

/// An agent that can lap: three stages and a budget of four.
const LOOPER: &str = "---\nname: main\ndescription: the lead\nspace: research\n\
     tools: [exec]\nstages: [plan, work, verify]\npasses: 4\n---\nbody";

/// The same loop with no budget — `passes:` defaults to 1, which is every agent
/// this build ships except `builder`. It must never say `pass 1 of 1`.
const ONCE: &str = "---\nname: main\ndescription: the lead\nspace: research\n\
     tools: [exec]\nstages: [plan, work, verify]\n---\nbody";

/// A tool call, so the lap EARNS the next one: `passes::again` refuses a lap to
/// a pass that mutated nothing and ran nothing, which is the whole design.
const RAN: &str = r#"exec({"command": "echo hi"})"#;

/// The first lap of `[plan, work, verify]`: the brief, a command, the work's
/// own word, the check's.
const FIRST_LAP: [&str; 4] = [
    "OUTCOME — index.md exists.",
    RAN,
    "Wrote it.",
    "`ls` shows index.md.",
];

/// EVERY LATER LAP IS ONE SHORTER, because `passes::again` goes back to `work`
/// and never to the start: re-planning each lap is how a run drifts off the goal
/// it opened with.
const NEXT_LAP: [&str; 3] = [RAN, "Wrote it again.", "`ls` still shows it."];

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

fn say(app: &Rc<RefCell<App>>, message: &str) {
    handle(&mut app.borrow_mut(), Request::post_form("/chat", &[("message", message)]));
}

/// Accept the message and run until the model stops answering.
fn run(app: &Rc<RefCell<App>>, message: &str) {
    say(app, message);
    let mut turn = Box::pin(drive(Rc::clone(app)));
    let mut cx = Context::from_waker(Waker::noop());
    let _ = turn.as_mut().poll(&mut cx);
}

/// The line the board renders for `main`, whole.
fn line(app: &Rc<RefCell<App>>) -> String {
    let board = handle(&mut app.borrow_mut(), Request::get("/board")).body;
    let at = board.find("data-agent=\"main\"").expect("main has a row");
    let (_, rest) = board[at..].split_once("data-line=\"").expect("the row's line");
    rest.split_once('"').map(|(v, _)| v.to_string()).unwrap_or_default()
}

/// Replies enough to spend `n` laps and open the next one.
fn laps(n: usize) -> Vec<&'static str> {
    let mut said: Vec<&str> = FIRST_LAP.to_vec();
    for _ in 1..n {
        said.extend(NEXT_LAP);
    }
    said
}

/// THE LAP IS ON THE ROW, BESIDE THE STAGE. One whole lap of plan→work→verify
/// with a command in it, and the machine goes round again: the row a person is
/// looking at says which stage AND which lap, in that order.
#[test]
fn the_live_row_says_which_lap_the_turn_is_on() {
    let app = booted(LOOPER, AnswersThenHangs::with(&laps(1)));
    run(&app, "write index.md");

    let said = line(&app);
    assert!(
        said.contains("stage 2 of 3: work · pass 2 of up to 4 · in this turn for"),
        "the stage, then the lap, then the clock: {said}"
    );
}

/// …AND IT IS THE LAP THE FACTS COUNT. Two whole laps behind it, so the number
/// has somewhere wrong to be: reading the `passes:` budget would print 4, and
/// re-reading the first fact would print 2.
#[test]
fn the_lap_is_the_one_the_log_counted_not_the_budget() {
    let app = booted(LOOPER, AnswersThenHangs::with(&laps(2)));
    run(&app, "write index.md");

    let said = line(&app);
    assert!(said.contains("pass 3 of up to 4"), "two laps are spent: {said}");
    assert!(!said.contains("pass 2 of"), "and the row is not the first fact: {said}");
}

/// A LAP IS PRINTED BECAUSE ONE WAS SPENT. The agent's budget is 4, the turn is
/// live and in the work stage, and no `PASS_SPENT` fact exists yet: the row says
/// what 28 made it say and nothing more. `pass 1 of up to 4` would be the budget
/// reported as a state — R17-P0-2 in a new place.
#[test]
fn the_first_lap_says_nothing_because_none_has_been_spent() {
    let app = booted(LOOPER, AnswersThenHangs::with(&FIRST_LAP[..2]));
    run(&app, "write index.md");

    let said = line(&app);
    assert!(said.contains("stage 2 of 3: work"), "the turn is in its first lap: {said}");
    assert!(!said.contains("pass"), "and no lap has been spent: {said}");
}

/// AN AGENT THAT CANNOT LAP SAYS NOTHING ABOUT LAPS (I15). `passes:` defaults to
/// 1 — every shipped agent but `builder` — and a lap count for a loop that
/// cannot lap is noise, exactly as `stage 1 of 1` was.
#[test]
fn an_agent_whose_budget_is_one_never_mentions_a_pass() {
    let app = booted(ONCE, AnswersThenHangs::with(&FIRST_LAP[..2]));
    run(&app, "write index.md");

    let said = line(&app);
    assert!(said.contains("in this turn for"), "the turn is live: {said}");
    assert!(!said.contains("pass"), "one lap is not a lap worth counting: {said}");
}

/// A LAP DOES NOT SURVIVE ITS TURN. The person stops waiting and asks for
/// something else; the new turn has spent no lap, and the old count is history
/// rather than status — the rule 28 set for the stage, on the same facts.
#[test]
fn a_lap_does_not_carry_over_into_the_next_turn() {
    let app = booted(LOOPER, AnswersThenHangs::with(&laps(1)));
    run(&app, "write index.md");
    assert!(line(&app).contains("pass 2 of up to 4"), "the first turn lapped");

    say(&app, "and now write README.md");
    let said = line(&app);
    assert!(!said.contains("pass"), "a new turn has spent no lap: {said}");
}

/// …AND A FINISHED TURN LEAVES NONE BEHIND. The whole loop runs, the budget is
/// never reached because the last lap changed nothing, and the row is the idle
/// row it always was.
#[test]
fn a_turn_that_ended_leaves_no_lap_on_the_row() {
    // A QUIET LAP ENDS THE TURN. The second lap runs no command and changes
    // nothing, so `passes::again` refuses it a third — the mechanical condition,
    // and the reason the budget of 4 is never reached.
    let mut replies: Vec<&str> = laps(1);
    replies.extend(["Nothing left to do.", "`ls` shows it, unchanged."]);
    let app = booted(
        LOOPER,
        Rc::new(ScriptedModel::with_replies(
            replies.iter().map(|r| ScriptedModel::text_reply(r)).collect(),
        )),
    );
    say(&app, "write index.md");
    block_on(drive(Rc::clone(&app))).expect("the turn runs");

    let said = line(&app);
    assert!(said.contains("ready"), "the turn ended: {said}");
    assert!(!said.contains("pass 2 of"), "and left no lap on the row: {said}");
}

/// THE ROW PROMISES NOTHING. `passes:` is a ceiling and the continue condition
/// is mechanical — a lap that changes nothing ends the turn — so `pass 2 of 4`
/// beside a running turn would advertise two laps the machine may never take.
/// The row says `up to`, and nothing on it says the loop will go on.
#[test]
fn the_row_names_the_budget_as_a_ceiling_and_not_a_plan() {
    let app = booted(LOOPER, AnswersThenHangs::with(&laps(1)));
    run(&app, "write index.md");

    let said = line(&app);
    assert!(said.contains("pass 2 of up to 4"), "{said}");
    for promise in ["pass 2 of 4", "will", "remaining", "left"] {
        assert!(!said.contains(promise), "`{promise}` promises a lap: {said}");
    }
}

/// THE WORD IS DEFINED WHERE IT IS FIRST READ. The row prints `pass` beside
/// `stage`, two numbers a sentence apart, and the Agents view is the one place
/// this product explains what the stage words mean. Read off the source, so a
/// rewrite of either side fails here rather than in front of a reader (28's
/// rule, applied to the second number).
#[test]
fn a_pass_is_defined_on_the_agents_view_beside_the_stages() {
    let roster = include_str!("../../ui/src/roster.rs");
    let paragraph = roster.split("A turn can run in stages.").nth(1).expect("the stage paragraph");
    let app = booted(LOOPER, AnswersThenHangs::with(&laps(1)));
    run(&app, "write index.md");

    let clause = line(&app)
        .split(" · ")
        .find(|p| p.starts_with("pass "))
        .expect("the lap clause")
        .to_string();
    let word = clause.split(' ').next().expect("the lap's word");
    assert_eq!(word, "pass");
    assert!(paragraph.contains("a pass is another lap of"), "{paragraph}");
    // …and the definition is not a promise either: a lap is EARNED.
    assert!(paragraph.contains("last lap changed something"), "{paragraph}");
}

/// THE SHIPPED ROSTER SAYS WHICH AGENT KEEPS GOING. `main` and `builder` declare
/// the same three stages, so before this the loop line was byte-identical for
/// the agent that works a goal across laps and the agent that answers once —
/// the headline capability, on the catalogue page, invisible.
#[test]
fn the_card_says_which_shipped_agent_works_across_laps() {
    let app = booted(LOOPER, AnswersThenHangs::with(&[]));
    install_agents(
        &mut app.borrow_mut(),
        vec![
            ("main".to_string(), include_str!("../../../public/agents/main/agent.md").to_string()),
            (
                "builder".to_string(),
                include_str!("../../agent/tests/agents/builder.md").to_string(),
            ),
        ],
    );
    let page = handle(&mut app.borrow_mut(), Request::get("/agents")).body;
    let card = |who: &str| {
        let at = page.find(&format!("data-agent=\"{who}\"")).expect("a card");
        let rest = &page[at..];
        rest.find("<div class=\"agent-card\"").map_or(rest, |end| &rest[..end]).to_string()
    };

    assert!(card("builder").contains("up to 4 laps a turn"), "{}", card("builder"));
    // …AND `main` NO LONGER HAS A LIST TO PRINT (`crate::loopline`).
    // It declares the one stage that CHOOSES the list, so the card names what
    // it can choose rather than repeating the word `strategy` back.
    assert!(card("main").contains("Picks its loop per message"), "{}", card("main"));
    assert!(!card("main").contains("laps"), "an agent with one lap claims none: {}", card("main"));
}
