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
    agent_names, answer, boot, drive, handle, install_agents_as, last_failure,
    last_failure_payload, log_kinds, App, Ports,
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
            // THE PAYLOAD, NOT THE SENTENCE. `adapters_web/src/worker/mod.rs`
            // rejects with `last_failure_payload` — the TYPED `core.error` —
            // so everything downstream (`from_worker::told`, `detail_of`,
            // `told_kind`) takes its typed branch in the browser. A fake
            // sending `last_failure`'s rendered sentence instead put this
            // whole suite on the other branch, green over a path no browser
            // takes.
            said.ok_or_else(|| DelegateError::Failed {
                message: last_failure_payload(&callee.borrow())
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

/// ONE agent's row out of the board fragment — up to the next row's start, so
/// an assertion about `researcher` cannot be satisfied by `main`'s card below it.
fn one_row<'a>(board: &'a str, who: &str) -> &'a str {
    let start = board
        .find(&format!(r#"data-agent="{who}""#))
        .unwrap_or_else(|| panic!("{who} has a row: {board}"));
    let rest = &board[start..];
    match rest[1..].find(r#"<div class="agent-row"#) {
        Some(end) => &rest[..end + 1],
        None => rest,
    }
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
/// THE FINDING THIS TEST RECORDED, AND WHAT T4 DID ABOUT IT. `core::last_failure`
/// on the CALLER is still `None`, and that is still right: `last_failure` folds
/// `core.error`, the caller's OWN turn, and the caller's turn did not fail.
/// What was missing is that a delegated failure had NO fold at all — it was
/// reachable only through the tool envelope and the board row. It has one now,
/// over `core.agent_error`, and it is asserted below THROUGH THE PANE A PERSON
/// OPENS rather than through a reading exported beside it: a second public
/// entry point briefly existed with no caller in the product, so this test was
/// the only thing that could report the fold as shipped. Assert the surface.
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
        "the caller's own failure card still says nothing: the caller did not fail"
    );
    // …and the delegated failure has its own reading, attributed, on the one
    // surface an operator opens to watch that run.
    let trace = get_as(&caller, "/tools", "researcher");
    assert!(
        trace.contains("endpoint"),
        "the sub-agent's trace ends with why it stopped: {trace}"
    );
}

/// A DELEGATED RUN, READ END TO END (T4). The five things an operator watching
/// one needs — the goal it was given, that it is working, the tools it called,
/// its answer, and (in the test above) the reason when it failed — asserted as
/// facts in a log and then as the projections a person actually looks at.
///
/// The Worker's report is made by hand here because `LocalAgents` is the port,
/// not the transport: `web/agent-worker.js` calls `activity()` after every
/// turn and the composition root feeds it to `report_activity`. Those two calls
/// are exactly what is written out below, so the assertion is over the real
/// producer (`core::activity_since`) and the real consumer.
#[test]
fn a_delegated_run_is_readable_from_the_goal_to_the_answer() {
    let (caller, roster) = wired(
        &[
            &format!(r#"spawn_agent({{"agent": "researcher", "goal": "{GOAL}"}})"#),
            "The researcher says gallium melts at 29.76 degrees Celsius.",
        ],
        vec![("researcher", vec!["now({})", FOUND])],
    );
    ask(&caller, "ask the researcher about gallium");
    let callee = roster
        .app("researcher")
        .expect("the researcher has a Worker");

    // 1. THE GOAL, on the callee's own row, off the caller's own log — the
    //    `UserMessage` carrying `from: main` and nothing new recorded for it.
    let board = get(&caller, "/board");
    let row = one_row(&board, "researcher");
    assert!(row.contains("asked to: find the melting point"), "{row}");
    // 2. …AND WHAT IT ANSWERED, on the same row, now that the turn has ended.
    assert!(row.contains("answered: Gallium melts"), "{row}");

    // 3. THE TOOLS IT CALLED — and the two ends of the run — in the trace, via
    //    the report its Worker makes about itself.
    let (reported, _) = core::activity_since(&callee.borrow(), 0);
    core::report_activity(&mut caller.borrow_mut(), "researcher", &reported);
    let trace = get_as(&caller, "/tools", "researcher");
    assert!(
        trace.contains("was asked to: find the melting point"),
        "{trace}"
    );
    assert!(
        trace.contains(r#"data-calls="1""#) && trace.contains("now"),
        "the one tool it called is in the trace: {trace}"
    );
    assert!(trace.contains(&format!("answered: {FOUND}")), "{trace}");
    // Whole, not clipped: the trace is where the full text is read.
    assert!(
        trace.contains(GOAL),
        "the trace carries the goal in full: {trace}"
    );

    // 4. NOTHING IS ATTRIBUTED TO THE PAGE'S OWN AGENT. `main` was never given
    //    a goal by anybody — a person typed to it — so its row says no such
    //    thing (I15: no goal fact, no clause).
    let mine = one_row(&board, "main");
    assert!(
        !mine.contains("asked to:"),
        "a person typing is not a delegation: {mine}"
    );
}

/// THE SAME RUN, LAUNCHED BY A PERSON (S3). Everything above drives the board
/// through `spawn_agent` — a MODEL delegating — and that is not how the defect
/// was reported. A person presses an agent's card on the Dashboard, which is a
/// `POST /chat` addressed to that agent through the one seam (I4), and it never
/// touches `batch::delegate`: `runtime/requests.rs::ran_elsewhere` sees a
/// message for somebody else and calls `batch::run_on` straight.
///
/// The goal fact is there either way — `chat/pane.rs::submit` wrote it, with
/// `from` EMPTY because a person typed it and the callee's own transcript must
/// say "You" rather than invent an agent that asked. What was missing was the
/// fold's test for it, so this drives the person's route end to end and reads
/// the row a person reads.
#[test]
fn a_run_a_person_launched_carries_its_goal_and_its_answer_on_the_board() {
    let (caller, _) = wired(&[], vec![("researcher", vec![FOUND])]);
    handle(
        &mut caller.borrow_mut(),
        Request::post_form("/chat", &[("message", GOAL)]).with_header("x-agent", "researcher"),
    );
    let _ = block_on(drive(Rc::clone(&caller)));

    // The FACT first (I8): the person's goal, addressed to the callee, said by
    // nobody — which is exactly what makes it a person's and not a delegation.
    assert!(
        user_messages(&caller).contains(&(
            GOAL.to_string(),
            "researcher".to_string(),
            String::new()
        )),
        "the person's goal is a fact in this log: {:?}",
        user_messages(&caller)
    );

    let board = get(&caller, "/board");
    let row = one_row(&board, "researcher");
    assert!(
        row.contains("asked to: find the melting point"),
        "the row says what the person asked it to do: {row}"
    );
    assert!(
        row.contains("answered: Gallium melts"),
        "…and what it came back with, the turn having ended: {row}"
    );

    // And the page's own agent is still not reporting an errand: nobody sent
    // `main` anywhere, and a person's conversation is not a goal handed over.
    let mine = one_row(&board, "main");
    assert!(
        !mine.contains("asked to:"),
        "a person's own chat is not an errand: {mine}"
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
/// THIS TEST USED TO RECORD THREE FINDINGS AS FACTS. T4 fixed two of them and
/// it now asserts the fixed state; the diff of this test is the increment.
///
/// 1. UNCHANGED. `GET /tools` with `x-agent: main` carries both the goal (as
///    the call's `args`) and the answer (as its `output`): `trace::row` renders
///    both. The CALLER's pane was always legible end to end.
/// 2. FIXED. `GET /tools` with `x-agent: researcher` used to show the callee
///    NOTHING — that pane reads `core.agent_activity`, and the goal and the
///    answer were never in one. `log::store::activity_since` now reports both,
///    so the pane of the agent that DID the work says what it was asked and
///    what it said. It still needs the report to have been made: a caller that
///    has adopted no report of a run still has an empty pane for it, which is
///    the honest reading and is asserted below.
/// 3. FIXED. `GET /board` said the status and the turn count and nothing about
///    the goal. `board::errand` folds the caller's own log — the goal it wrote
///    and the answer it received — so the row now answers "what is it doing",
///    not only "is it running".
#[test]
fn what_an_operator_can_see_of_a_spawned_run() {
    let (caller, roster) = wired(
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

    // 2. The callee's own trace, BEFORE its Worker has reported anything: still
    //    empty, and saying so is right — nothing was reported, so there is
    //    nothing to project (I8, I15).
    let theirs = get_as(&caller, "/tools", "researcher");
    assert!(
        theirs.contains("has not called a tool yet"),
        "no report adopted yet, so the pane says so: {theirs}"
    );
    // …and once its Worker HAS reported, the same pane holds both ends of the
    // run. This is the `activity()` + `report_activity` pair the composition
    // root runs after every delegated turn.
    let (reported, _) = core::activity_since(
        &roster
            .app("researcher")
            .expect("the researcher has a Worker")
            .borrow(),
        0,
    );
    core::report_activity(&mut caller.borrow_mut(), "researcher", &reported);
    let theirs = get_as(&caller, "/tools", "researcher");
    assert!(
        theirs.contains(&format!("was asked to: {GOAL}")),
        "the goal is in the pane of the agent that did the work: {theirs}"
    );
    assert!(
        theirs.contains("29.76"),
        "…and so is what it answered: {theirs}"
    );

    // 3. The board: status, turns, AND what it was asked.
    let board = get(&caller, "/board");
    assert!(board.contains(r#"data-agent="researcher""#), "{board}");
    assert!(board.contains("1 turn"), "the row counts the turn: {board}");
    assert!(
        board.contains("asked to: find the melting point of gallium"),
        "the goal is on the row: {board}"
    );
    assert!(
        board.contains("answered: Gallium melts at 29.76"),
        "…and so is the answer: {board}"
    );
}
