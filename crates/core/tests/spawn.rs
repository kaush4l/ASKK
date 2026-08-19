//! `spawn_agent`, COMPOSED and verified end to end on the host (I3): one agent
//! hands a goal to a second agent that really runs a turn of its own loop, and
//! everything an operator would read about it is asserted as a FACT in a log
//! (I8) before it is asserted as HTML.
//!
//! The `AgentPort` here is NOT `adapters_test::ScriptedAgents`. That fake
//! answers a canned string with no second agent existing anywhere, which cannot
//! prove a workflow: it proves the caller's half. `LocalAgents` below is the
//! honest thing — the callee is the same program, run somewhere else (ADR-008).

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{DenyAllNet, FixedClock, MemStore, ScriptedAgents, ScriptedModel, SeededRng};
use core::{
    agent_names, answer, boot, drive, handle, install_agents_as, last_failure, log_kinds, App,
    Ports,
};
use kernel::{AgentPort, BoxFuture, DelegateError, EventKind, Request, Status, Timestamp};

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

/// The `AgentPort` a WORKER implements, on the host. Each named agent is a real
/// `core::App` with its own log, its own agent file and its own model script;
/// `delegate` appends the goal as a `UserMessage` through the same seam a
/// person's message uses and DRIVES that app's own loop, then hands back what
/// it answered — which is exactly what `crates/adapters_web/src/workers.rs`
/// does across `postMessage`, minus the message passing. Nothing here stands in
/// for the callee: the callee is the same program, run somewhere else
/// (ADR-008).
#[derive(Default)]
struct LocalAgents {
    apps: RefCell<Vec<(String, Rc<RefCell<App>>)>>,
}

impl LocalAgents {
    fn new() -> Rc<LocalAgents> {
        Rc::new(LocalAgents::default())
    }

    /// Start a Worker for one agent — what the composition root does when
    /// `roster::reconcile` reports a name that was not loaded before.
    fn start(&self, name: &str, app: &Rc<RefCell<App>>) {
        self.apps
            .borrow_mut()
            .push((name.to_string(), Rc::clone(app)));
    }

    fn app(&self, name: &str) -> Option<Rc<RefCell<App>>> {
        self.apps
            .borrow()
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, a)| Rc::clone(a))
    }
}

impl AgentPort for LocalAgents {
    fn delegate<'a>(
        &'a self,
        agent: &'a str,
        goal: &'a str,
    ) -> BoxFuture<'a, Result<String, DelegateError>> {
        // The Rc is cloned OUT of the borrow before anything runs: this future
        // is immediately ready, but a `RefCell` guard alive across the callee's
        // own `borrow_mut` would panic just the same.
        let callee = self.app(agent);
        let (agent, goal) = (agent.to_string(), goal.to_string());
        Box::pin(async move {
            // A name with no Worker is not loaded — `workers.rs`'s own answer
            // when `self.live` has no handle for the name.
            let Some(callee) = callee else {
                return Err(DelegateError::Unknown { agent });
            };
            handle(
                &mut callee.borrow_mut(),
                Request::post_form("/chat", &[("message", &goal)]),
            );
            // A callee whose own turn RAISED is the case this exists to carry;
            // its `drive` returns Err and its failure is its own words.
            let _ = block_on(drive(Rc::clone(&callee)));
            let said = answer(&callee.borrow());
            said.ok_or_else(|| DelegateError::Failed {
                message: last_failure(&callee.borrow())
                    .unwrap_or_else(|| format!("{agent} produced no answer")),
                agent,
            })
        })
    }
}

/// `main` may spawn and may author; `researcher` is a plain sub-agent with the
/// built-in toolbox. `spawn_agent` names its callee in an argument, so `main`
/// does NOT need `researcher` in its `tools:` line.
fn agent_files() -> Vec<(String, String)> {
    let file = |name: &str, desc: &str, tools: &str| {
        (
            name.to_string(),
            format!("---\nname: {name}\ndescription: {desc}\ntools: {tools}\n---\nbody"),
        )
    };
    vec![
        file(
            "main",
            "the lead",
            "[now, spawn_agent, write_agent, list_agents]",
        ),
        file("researcher", "finds things out", "[now]"),
    ]
}

fn ports(replies: &[&str], agents: Rc<dyn AgentPort>) -> Ports {
    Ports {
        model: Rc::new(ScriptedModel::with_replies(
            replies
                .iter()
                .map(|r| ScriptedModel::text_reply(r))
                .collect(),
        )),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(adapters_test::MemKv::new()),
        workspace: Rc::new(adapters_test::FakeShell::new()),
        agents,
    }
}

/// One agent's whole app: its own log, its own model script, its own identity.
fn app_for(who: &str, replies: &[&str], agents: Rc<dyn AgentPort>) -> Rc<RefCell<App>> {
    let mut app = block_on(boot(ports(replies, agents))).expect("boot succeeds");
    install_agents_as(&mut app, agent_files(), who);
    Rc::new(RefCell::new(app))
}

/// A caller wired to a roster of real callees. The callees are built FIRST —
/// each with its own `AgentPort` that knows nobody — then the caller is booted
/// with the port that holds them.
fn wired(lead: &[&str], callees: Vec<(&str, Vec<&str>)>) -> (Rc<RefCell<App>>, Rc<LocalAgents>) {
    let roster = LocalAgents::new();
    for (name, replies) in callees {
        let app = app_for(name, &replies, Rc::new(ScriptedAgents::none()));
        roster.start(name, &app);
    }
    let caller = app_for("main", lead, Rc::clone(&roster) as Rc<dyn AgentPort>);
    (caller, roster)
}

fn ask(app: &Rc<RefCell<App>>, message: &str) {
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", message)]),
    );
    let _ = block_on(drive(Rc::clone(app)));
}

fn user_messages(app: &Rc<RefCell<App>>) -> Vec<(String, String, String)> {
    log_kinds(&app.borrow())
        .into_iter()
        .filter_map(|k| match k {
            EventKind::UserMessage { text, agent, from } => Some((text, agent, from)),
            _ => None,
        })
        .collect()
}

fn model_replies(app: &Rc<RefCell<App>>) -> Vec<String> {
    log_kinds(&app.borrow())
        .into_iter()
        .filter_map(|k| match k {
            EventKind::ModelReplied { text, .. } => Some(text),
            _ => None,
        })
        .collect()
}

fn tool_calls(app: &Rc<RefCell<App>>) -> Vec<(String, String, bool, String)> {
    log_kinds(&app.borrow())
        .into_iter()
        .filter_map(|k| match k {
            EventKind::ToolInvoked {
                tool,
                args,
                ok,
                output,
            } => Some((tool.0, args, ok, output)),
            _ => None,
        })
        .collect()
}

fn statuses(app: &Rc<RefCell<App>>, who: &str) -> Vec<Status> {
    log_kinds(&app.borrow())
        .into_iter()
        .filter_map(|k| match k {
            EventKind::AgentStatus { agent, status, .. } if agent == who => Some(status),
            _ => None,
        })
        .collect()
}

fn get(app: &Rc<RefCell<App>>, path: &str) -> String {
    handle(&mut app.borrow_mut(), Request::get(path)).body
}

fn get_as(app: &Rc<RefCell<App>>, path: &str, who: &str) -> String {
    handle(
        &mut app.borrow_mut(),
        Request::get(path).with_header("x-agent", who),
    )
    .body
}

const GOAL: &str = "find the melting point of gallium and say it in one line";
const FOUND: &str = "Gallium melts at 29.76 degrees Celsius.";

// ─── PART 1: a second agent that actually runs ───────────────────────────────

/// THE WORKFLOW, COMPOSED. `main` calls `spawn_agent`, `researcher` takes a
/// whole turn of its OWN loop against its OWN model, and both halves are facts:
/// the goal is a `UserMessage` in the callee's log, the answer is a
/// `ModelReplied` in the callee's log, and the caller's log holds both the
/// attribution (`from: main`) and the tool envelope the model read next.
#[test]
fn one_agent_hands_a_goal_to_another_and_the_second_agent_really_runs() {
    let (caller, roster) = wired(
        &[
            &format!(r#"spawn_agent({{"agent": "researcher", "goal": "{GOAL}"}})"#),
            "The researcher says gallium melts at 29.76 degrees Celsius.",
        ],
        vec![("researcher", vec![FOUND])],
    );
    ask(&caller, "ask the researcher about gallium");

    // The CALLEE's own log: it was asked, and it answered, in its own history.
    let callee = roster
        .app("researcher")
        .expect("the researcher has a Worker");
    assert!(
        user_messages(&callee).iter().any(|(text, ..)| text == GOAL),
        "the goal is a UserMessage in the callee's OWN log: {:?}",
        user_messages(&callee)
    );
    assert!(
        model_replies(&callee).iter().any(|t| t == FOUND),
        "the callee's own model replied in its own log: {:?}",
        model_replies(&callee)
    );

    // The CALLER's log: who was asked, by whom, and what came back.
    assert!(
        user_messages(&caller)
            .iter()
            .any(|(text, agent, from)| text == GOAL && agent == "researcher" && from == "main"),
        "the caller records the attribution: {:?}",
        user_messages(&caller)
    );
    assert!(
        tool_calls(&caller).iter().any(|(tool, args, ok, output)| {
            tool == "researcher" && args == GOAL && *ok && output == FOUND
        }),
        "the envelope the model read next: {:?}",
        tool_calls(&caller)
    );
    assert!(
        get(&caller, "/chat").contains("29.76"),
        "the caller answered the person out of what came back"
    );
}

/// The board's two transitions as FACTS, in the caller's log — the board is a
/// fold of exactly these, so what a person watched and what happened cannot
/// differ. Same assertion style as
/// `crates/core/tests/delegation.rs::the_sub_agent_goes_working_then_idle_and_the_log_records_both`.
#[test]
fn the_board_shows_the_spawned_agent_working_then_idle() {
    let (caller, _) = wired(
        &[
            r#"spawn_agent({"agent": "researcher", "goal": "go"})"#,
            "done",
        ],
        vec![("researcher", vec!["found it"])],
    );
    ask(&caller, "delegate");

    assert_eq!(
        statuses(&caller, "researcher"),
        [Status::Working, Status::Idle],
        "working while it ran, idle after — its caller already has the answer"
    );
    assert_eq!(
        statuses(&caller, "main"),
        [Status::Working, Status::Waiting],
        "the entry agent waits on the person"
    );
    let board = get(&caller, "/board");
    assert!(board.contains(r#"data-agent="researcher""#), "{board}");
    assert!(
        !board.contains(r#"data-status="working""#),
        "nobody is left working"
    );
}

/// A SPAWNED AGENT WHOSE OWN TURN FAILS. Found true, and asserted below: the
/// caller is handed `ok: false` carrying the CALLEE's own words, the board row
/// is `Failed` carrying them, and the caller's turn does NOT die — it reads the
/// refusal and answers the person.
///
/// FINDING, and the one part of the brief that is not true: `core::last_failure`
/// on the CALLER is `None`. `batch.rs::refused` records the callee's failure as
/// a `core.agent_error` fact, and `last_failure` folds `core.error` — the
/// caller's OWN turn — so a caller reading `last_failure` learns nothing about
/// a sub-agent that failed. That is arguably right (the caller's turn did not
/// fail) but it means the failure of a delegated run is only reachable through
/// the tool envelope and the board row, never through the caller's failure card.
#[test]
fn a_spawned_agent_whose_turn_fails_comes_back_named_and_the_caller_is_told_why() {
    // No replies queued for the callee: its model is exhausted, which is a
    // transport failure — the same shape as an unreachable endpoint.
    // Three replies, because a turn in which a tool call FAILED is nudged to
    // verify before it may end (`core.verify_nudged`) — one more model call.
    let (caller, _) = wired(
        &[
            r#"spawn_agent({"agent": "researcher", "goal": "go"})"#,
            "The researcher could not reach its endpoint, so I have no answer.",
            "I checked: the researcher could not reach its endpoint.",
        ],
        vec![("researcher", vec![])],
    );
    ask(&caller, "delegate");

    let calls = tool_calls(&caller);
    let (_, _, ok, output) = calls
        .iter()
        .find(|(tool, ..)| tool == "researcher")
        .expect("the delegation is in the caller's log");
    assert!(!ok, "the caller is told the call failed: {calls:?}");
    assert!(
        output.contains("researcher failed") && output.contains("endpoint"),
        "…in the callee's OWN words, named: {output}"
    );

    assert_eq!(
        statuses(&caller, "researcher"),
        [Status::Working, Status::Failed],
        "the callee's own row went Working then Failed"
    );
    let board = get(&caller, "/board");
    assert!(
        board.contains(r#"data-agent="researcher" data-status="failed""#),
        "the CALLEE's row is the failed one: {board}"
    );
    assert!(
        board.contains("endpoint"),
        "the row carries the reason: {board}"
    );

    // The caller's turn survived and produced an answer.
    assert!(
        answer(&caller.borrow()).is_some_and(|a| a.contains("could not reach")),
        "the caller still answered the person"
    );
    assert_eq!(
        last_failure(&caller.borrow()),
        None,
        "FINDING: the caller's own failure card knows nothing about the callee"
    );
}

/// A name nobody has: the model is told exactly that, and can correct itself.
#[test]
fn spawn_agent_is_refused_for_an_agent_that_does_not_exist() {
    let (caller, _) = wired(
        &[
            r#"spawn_agent({"agent": "nobody", "goal": "go"})"#,
            "There is no such agent.",
            "I checked: there is no agent called nobody.",
        ],
        vec![("researcher", vec!["unused"])],
    );
    ask(&caller, "delegate to a ghost");

    let calls = tool_calls(&caller);
    let (_, _, ok, output) = calls
        .iter()
        .find(|(tool, ..)| tool == "nobody")
        .expect("the refused delegation is still a recorded envelope");
    assert!(!ok, "{calls:?}");
    assert!(
        output.contains("No agent called 'nobody' is loaded in this browser."),
        "the exact refusal the model is given: {output}"
    );
}

// ─── PART 2: authoring and starting take two turns ───────────────────────────

const WRITE: &str = r#"write_agent({"name": "helper", "description": "helps", "prompt": "You help.", "tools": "", "space": ""})"#;
const SPAWN_HELPER: &str = r#"spawn_agent({"agent": "helper", "goal": "help me"})"#;

/// AUTHOR-THEN-START IS TWO TURNS, and the refusal now says so. `write_agent`
/// only appends the `AUTHORED` fact (`agents/roster.rs::write_agent`);
/// `roster::reconcile` returns early while `app.agent.task` is `Some` and is
/// called only once `drive`'s loop drains, so the agent is genuinely not
/// callable until the turn ends. The old message — "No agent called 'helper' is
/// loaded in this browser." — asserted the one thing that would stop a model
/// waiting and asking again.
#[test]
fn write_then_spawn_in_one_turn_is_refused_in_words_that_name_the_turn_boundary() {
    let (caller, _) = wired(
        &[
            &format!("{WRITE}\n{SPAWN_HELPER}"),
            "I have written helper; I will ask it next turn.",
            // `write_agent` is MUTATING, so the turn is asked to check itself
            // before it may end — twice (`crates/agent/src/verify.rs`,
            // `MAX_NUDGES`), which is two more model calls.
            "I checked: helper exists but is not callable until next turn.",
            "Checked again; nothing more to do this turn.",
        ],
        vec![("researcher", vec!["unused"])],
    );
    ask(&caller, "write a helper and set it working");

    let calls = tool_calls(&caller);
    let (_, _, ok, output) = calls
        .iter()
        .find(|(tool, ..)| tool == "helper")
        .expect("the refused spawn is a recorded envelope");
    assert!(!ok, "{calls:?}");
    assert!(
        output.contains("written in this turn") && output.contains("next turn"),
        "the refusal names the turn boundary: {output}"
    );
    assert!(
        !output.contains("is loaded in this browser"),
        "…and does NOT say the agent does not exist: {output}"
    );
    // THE ASSERTION IS ON THE FACTS, and it has to be. An earlier form of this
    // test checked only that no `Failed` status was written and that the
    // RENDERED board showed one `starting` row — and it was green while
    // `run_on` was still appending a `Working` fact for a name the roster had
    // never had. `Board::forget` had tidied the projection; the fact stayed in
    // the log, and `agents::install::replayed` counts a `Working` fact as a
    // TURN, so `helper` came back on the next load reporting a turn it never
    // took. A refused spawn must leave the log exactly as it found it.
    assert_eq!(
        statuses(&caller, "helper"),
        Vec::<Status>::new(),
        "a refused spawn writes NO status fact at all — not Working, not Failed"
    );
    // The row `helper` DOES end up on the board — but as `starting`, put there
    // by `roster::reconcile` at the turn boundary, which is the truth.
    let board = get(&caller, "/board");
    assert!(
        board.contains(r#"data-agent="helper" data-status="starting""#),
        "the only helper row is the one reconcile registered: {board}"
    );
}

/// …AND THE NEXT TURN IT WORKS. The turn boundary is where `reconcile` runs, so
/// `helper` is installed and reachable by name on the second turn.
///
/// HONESTY ABOUT WHAT THIS PROVES: `LocalAgents` is the composition root's
/// Worker table, and a freshly authored agent has no Worker until the root
/// starts one — in the browser that is `AgentWorkers::start`, here it is
/// `LocalAgents::start`. So the test does what the page does: it reads the new
/// name out of `core::agent_names`, builds that agent's app from the SAME agent
/// files the caller is running (`core::agent_files`), starts it, and only then
/// asks again. Without that step the second turn would refuse too — which is a
/// real property of the design, not a gap in the test: installing an agent and
/// giving it a Worker are two different things.
#[test]
fn and_the_next_turn_it_works() {
    let (caller, roster) = wired(
        &[
            // Turn one: write it, try to start it, be refused, then answer —
            // plus the two verify nudges `write_agent` earns (see above).
            &format!("{WRITE}\n{SPAWN_HELPER}"),
            "Written. I will ask it next turn.",
            "I checked: helper is not callable until next turn.",
            "Checked again; nothing more to do this turn.",
            // Turn two.
            SPAWN_HELPER,
            "helper says: on it.",
        ],
        vec![("researcher", vec!["unused"])],
    );
    ask(&caller, "write a helper and set it working");

    // The turn has ended, so `reconcile` has run: the agent is INSTALLED.
    assert!(
        agent_names(&caller.borrow()).iter().any(|n| n == "helper"),
        "installed at the turn boundary: {:?}",
        agent_names(&caller.borrow())
    );

    // The composition root starts a Worker for the name that just appeared.
    let files = core::agent_files(&caller.borrow());
    let mut helper =
        block_on(boot(ports(&["on it."], Rc::new(ScriptedAgents::none())))).expect("boot succeeds");
    install_agents_as(&mut helper, files, "helper");
    roster.start("helper", &Rc::new(RefCell::new(helper)));

    ask(&caller, "now ask the helper");
    assert!(
        tool_calls(&caller)
            .iter()
            .any(|(tool, _, ok, output)| tool == "helper" && *ok && output == "on it."),
        "the authored agent ran on the second turn: {:?}",
        tool_calls(&caller)
    );
}

// ─── PART 3: what an operator can actually see ───────────────────────────────

/// WHAT AN OPERATOR LOOKS AT — through the seam (I4), as the page does.
///
/// FINDINGS, all asserted below rather than fixed:
///
/// 1. `GET /tools` with `x-agent: main` DOES carry both the goal (as the call's
///    `args`) and the answer (as its `output`): `trace::row` renders both. This
///    is the one place a workflow is legible end to end.
/// 2. `GET /tools` with `x-agent: researcher` shows the callee NOTHING. That
///    pane reads `core.agent_activity` reports (`trace/from_worker.rs::reported`),
///    which only a real Worker sends back over `postMessage`; the delegated turn
///    itself is not one, so the callee's pane says "researcher has not called a
///    tool yet" even though it just took a whole turn. An operator looking at the
///    agent that DID the work sees an empty log — the delegation lands only in
///    the caller's pane.
/// 3. `GET /board` says the STATUS and the turn count and nothing about the
///    goal: the row for `researcher` carries neither the goal it was given nor
///    the answer it produced. The board answers "is it running", never "what is
///    it doing".
#[test]
fn what_an_operator_can_see_of_a_spawned_run() {
    let (caller, _) = wired(
        &[
            &format!(r#"spawn_agent({{"agent": "researcher", "goal": "{GOAL}"}})"#),
            "Gallium melts at 29.76 C.",
        ],
        vec![("researcher", vec![FOUND])],
    );
    ask(&caller, "ask the researcher about gallium");

    // 1. The caller's own trace: the goal AND the answer.
    let mine = get_as(&caller, "/tools", "main");
    assert!(mine.contains("researcher"), "the callee is named: {mine}");
    assert!(
        mine.contains("gallium"),
        "the GOAL is in the caller's trace: {mine}"
    );
    assert!(
        mine.contains("29.76"),
        "the ANSWER is in the caller's trace: {mine}"
    );

    // 2. The callee's own trace: empty. A delegated turn is not an activity report.
    let theirs = get_as(&caller, "/tools", "researcher");
    assert!(
        theirs.contains("has not called a tool yet"),
        "FINDING: the agent that did the work has an empty pane: {theirs}"
    );
    assert!(
        !theirs.contains("29.76"),
        "FINDING: its answer is not in its own pane either: {theirs}"
    );

    // 3. The board: status and turns, never the goal.
    let board = get(&caller, "/board");
    assert!(board.contains(r#"data-agent="researcher""#), "{board}");
    assert!(board.contains("1 turn"), "the row counts the turn: {board}");
    assert!(
        !board.contains("gallium"),
        "FINDING: no goal on the row: {board}"
    );
    assert!(
        !board.contains("29.76"),
        "FINDING: no answer on the row: {board}"
    );
}
