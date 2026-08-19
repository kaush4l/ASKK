//! One line of tool calls, executed. `runtime/` owns *when* an effect runs;
//! this file owns the one effect that fans out, and it is where the Python's
//! layout rule becomes true in both halves: calls on ONE line are independent
//! and run AT THE SAME TIME — each in the callee's own Worker, making "at the
//! same time" real rather than a comment — and a NEW line runs after everything
//! above it. Results append in the order the model WROTE them, never the order
//! they finished: the transcript must be reproducible.

use std::cell::RefCell;
use std::rc::Rc;

use agent::Effect;
use futures::future::join_all;
use kernel::{DelegateError, EventKind, Status, ToolId};

use crate::app::App;

/// One turn on another agent's Worker, recorded in THAT agent's own history
/// (increment 07) and on its row: Working before, then Waiting if a PERSON
/// asked it (they now wait on it) or Idle if the lead did (its caller already
/// has the answer), Failed WITH THE MESSAGE if its turn raised — the Python
/// `ThreadedAgent.invoke`. One function for both callers: a delegated turn
/// belongs to the sub-agent, not to whoever asked.
pub(crate) async fn run_on(
    app: &Rc<RefCell<App>>,
    agent: &str,
    goal: &str,
    asked_by_person: bool,
) -> Result<String, String> {
    let port = {
        let mut a = app.borrow_mut();
        // ONLY FOR A NAME THE ROSTER HAS. `set_status` APPENDS a fact and a
        // fact outlives the projection: `Working` for an unloaded name put a
        // turn in the LOG that never happened, which `install::replayed` counts.
        if a.agents.iter().any(|s| s.name == agent) {
            a.set_status(agent, Status::Working, "");
        }
        Rc::clone(&a.ports.agents)
    };
    let outcome = port.delegate(agent, goal).await;
    let mut a = app.borrow_mut();
    match outcome {
        Ok(answer) => {
            a.append(EventKind::ModelReplied {
                text: answer.clone(),
                agent: agent.to_string(),
            });
            let next = match asked_by_person {
                true => Status::Waiting,
                false => Status::Idle,
            };
            a.set_status(agent, next, "");
            Ok(answer)
        }
        Err(e) => Err(refused(&mut a, agent, e)),
    }
}

/// A delegated turn that raised, recorded and said. The RECORD keeps the typed
/// payload the Worker sent, so the card can carry its disclosure; the BOARD
/// gets the sentence, a status row being one line a person reads at a glance.
/// ONE NAME IS NOT A FAILURE: an agent AUTHORED this turn is not loaded yet
/// BECAUSE the turn has not ended (`agents/roster.rs::reconcile` defers while
/// `app.agent.task` is `Some`), so "no agent called 'X'" asserts the one thing
/// stopping the model from asking again — and NO ROW AND NO FACT either.
fn refused(a: &mut App, agent: &str, e: DelegateError) -> String {
    let later = "was written in this turn; it is installed when this turn ends, so ask \
                 again on your next turn.";
    let gone = |n: &str| format!("No agent called '{n}' is loaded in this browser.");
    let (message, on_board) = match e {
        DelegateError::Unknown { agent: n } => match authored_this_turn(a, &n) {
            true => (format!("'{n}' {later}"), false),
            false => (gone(&n), true),
        },
        // Its OWN words, carried across the `postMessage` boundary so a
        // sub-agent's failure names its cause the way the lead's does.
        DelegateError::Failed { message, .. } => (message, true),
    };
    let said = crate::failure::from_worker::told(&message, agent);
    if on_board {
        a.set_status(agent, Status::Failed, &said);
    }
    a.append(EventKind::Custom {
        kind: "core.agent_error".into(),
        payload_json: crate::failure::from_worker::agent_error(agent, &message),
    });
    said
}

/// Written by `write_agent` in the turn now running: the log's FOLD holds it,
/// `app.authored` does not (`reconcile` refreshes that only at a turn boundary)
/// — the difference between the two IS "authored this turn".
fn authored_this_turn(a: &App, name: &str) -> bool {
    let holds = |set: &[crate::agents::authored::Authored]| set.iter().any(|(n, ..)| n == name);
    holds(&crate::agents::authored::set(&a.log)) && !holds(&a.authored)
}

/// A delegation as the LEAD sees it: the tool envelope the model reads next.
async fn delegate(app: &Rc<RefCell<App>>, agent: String, goal: String) -> EventKind {
    let asked_by = app.borrow().me().to_string();
    app.borrow_mut().append(EventKind::UserMessage {
        text: goal.clone(),
        agent: agent.clone(),
        from: asked_by,
    });
    let (ok, output) = match run_on(app, &agent, &goal, false).await {
        Ok(answer) => (true, answer),
        Err(message) => (false, format!("{agent} failed: {message}")),
    };
    EventKind::ToolInvoked {
        tool: ToolId(agent),
        args: goal,
        ok,
        output,
    }
}

/// Execute the effects of one `pump`, respecting the layout rule. Anything not
/// a delegation is instantaneous local work in written order; a RUN of
/// delegations sharing a batch index is awaited together.
pub(crate) async fn run_effects(app: &Rc<RefCell<App>>, effects: Vec<Effect>) {
    let mut rest = effects.as_slice();
    while let Some(first) = rest.first() {
        let Effect::Delegate { batch, .. } = first else {
            single(app, first.clone()).await;
            rest = &rest[1..];
            continue;
        };
        let line = *batch;
        let take = rest
            .iter()
            .take_while(|e| matches!(e, Effect::Delegate { batch, .. } if *batch == line))
            .count();
        let (group, tail) = rest.split_at(take);
        let calls = group.iter().map(|e| match e {
            Effect::Delegate { agent, goal, .. } => delegate(app, agent.clone(), goal.clone()),
            _ => unreachable!("group is delegations only"),
        });
        for kind in join_all(calls).await {
            let mut a = app.borrow_mut();
            let appended = a.append(kind);
            a.pending.push(appended);
        }
        rest = tail;
    }
}

/// One non-delegating effect: a local tool against the app, or a port call. A
/// tool call's envelope is the fact that comes back (I8), refusal included; one
/// table decides which half of the executor runs it.
async fn single(app: &Rc<RefCell<App>>, effect: Effect) {
    if let Effect::InvokeTool { tool, args_json } = &effect {
        invoke(app, tool, args_json).await;
        return;
    }
    // Built in its OWN statement so the `borrow()` guard dies here, not at the
    // end of the expression: one alive across an await panics the next
    // `borrow_mut`, and the chat poll spawns a `drive` every 400 ms.
    let running = crate::effects::execute_port_effect(&app.borrow().ports, effect);
    let result = running.await;
    let mut a = app.borrow_mut();
    match result {
        Ok(events) => {
            for event in events {
                let appended = a.append(event.kind);
                a.pending.push(appended);
            }
        }
        Err(e) => crate::failure::card::record(&mut a, e),
    }
}

/// ONE tool call, run and recorded, by the first of THREE runners that claims
/// it: the built-in table `tools::tool_entry`, then whatever `ToolHost` a
/// composition root installed (`faculty::run_hosted`), then `tools::run`.
/// BUILT-INS WIN. A faculty widens what an agent may do; it may not redefine
/// what this crate already does, so a host declaring `exec` or `web_search`
/// never sees a call those actually run. The middle rung is what lets a faculty
/// defined in a crate `core` has never heard of — a browser one, in
/// `adapters_web` — have its tools RUN rather than be refused; a handler that
/// DECLINES the call it was routed ran nothing, so that call goes on. The first
/// two are awaited OUTSIDE any borrow (one held across an await panics the next
/// `borrow_mut`); only `run`, which is sync, is inside one. The append-and-push
/// is written once — five copies is five places to drift apart.
async fn invoke(app: &Rc<RefCell<App>>, tool: &ToolId, args_json: &str) {
    let mut awaited = match crate::tools::tool_entry(tool) {
        Some(handler) => handler(app, tool, args_json).await,
        None => None,
    };
    if awaited.is_none() {
        awaited = crate::faculty::run_hosted(app, tool, args_json).await;
    }
    let mut a = app.borrow_mut();
    let kind = match awaited {
        Some(kind) => kind,
        None => crate::tools::run(&mut a, tool, args_json),
    };
    let appended = a.append(kind);
    a.pending.push(appended);
}
