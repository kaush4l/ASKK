//! One line of tool calls, executed. Split from `runtime.rs` to hold the
//! 200-line rule, and because this file is where the Python's layout rule
//! finally becomes true in both halves:
//!
//! - calls on ONE line are independent and run AT THE SAME TIME — each in the
//!   callee's own Worker, which is what makes "at the same time" real rather
//!   than a comment (increment 05 shipped only the ordering half);
//! - a NEW line runs after everything above it.
//!
//! Results are appended in the order the model WROTE the calls, never in the
//! order they happened to finish: the transcript must be reproducible.

use std::cell::RefCell;
use std::rc::Rc;

use agent::Effect;
use futures::future::join_all;
use kernel::{DelegateError, EventKind, Status, ToolId};

use crate::app::App;

/// One turn on another agent's Worker, recorded in THAT agent's own history
/// (increment 07) and on its row: Working before, then Waiting if a PERSON
/// asked it (they are the ones it now waits on) or Idle if the lead did (its
/// caller already has the answer), Failed WITH THE MESSAGE if its turn raised
/// — the Python `ThreadedAgent.invoke`, line for line.
///
/// One function for both callers, so a sub-agent's transcript is the same
/// whether you typed to it or the lead delegated to it: the delegated turn
/// belongs to the sub-agent, not to whoever asked.
pub(crate) async fn run_on(
    app: &Rc<RefCell<App>>,
    agent: &str,
    goal: &str,
    asked_by_person: bool,
) -> Result<String, String> {
    let port = {
        let mut a = app.borrow_mut();
        a.set_status(agent, Status::Working, "");
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
        Err(e) => {
            let message = match e {
                DelegateError::Unknown { agent: name } => {
                    format!("No agent called '{name}' is loaded in this browser.")
                }
                // Its OWN words. Carried across the `postMessage` boundary so
                // a sub-agent's failure names its cause the way the lead's does.
                DelegateError::Failed { message, .. } => message,
            };
            // The RECORD keeps the typed payload the Worker sent, so the card
            // can carry its disclosure; the BOARD gets the sentence, because a
            // status row is one line a person reads at a glance.
            let said = crate::told::told(&message, agent);
            a.set_status(agent, Status::Failed, &said);
            a.append(EventKind::Custom {
                kind: "core.agent_error".into(),
                payload_json: crate::told::agent_error(agent, &message),
            });
            Err(said)
        }
    }
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

/// Execute the effects of one `pump`, respecting the layout rule. Everything
/// that is not a delegation is instantaneous local work and stays in written
/// order; a RUN of delegations sharing a batch index is awaited together.
pub(crate) async fn run_effects(app: &Rc<RefCell<App>>, effects: Vec<Effect>) {
    let mut rest = effects.as_slice();
    while let Some(first) = rest.first() {
        let Effect::Delegate { batch, .. } = first else {
            let (one, tail) = rest.split_at(1);
            single(app, one[0].clone()).await;
            rest = tail;
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

/// One non-delegating effect: a local tool against the app, or a port call.
async fn single(app: &Rc<RefCell<App>>, effect: Effect) {
    // A tool runs against the app, synchronously, and its envelope is the fact
    // that comes back (I8) — including a refusal.
    if let Effect::InvokeTool { tool, args_json } = &effect {
        // A space's tools write to the SHARED store, so they are the one tool
        // family that cannot run inside a borrow of the app.
        // A workspace tool runs a command in a Linux, which is I/O and cannot
        // happen inside a borrow of the app either.
        if let Some(kind) = crate::workspace::run(app, tool, args_json).await {
            let mut a = app.borrow_mut();
            let appended = a.append(kind);
            a.pending.push(appended);
            return;
        }
        if let Some(kind) = crate::space::run(app, tool, args_json).await {
            let mut a = app.borrow_mut();
            let appended = a.append(kind);
            a.pending.push(appended);
            return;
        }
        let mut a = app.borrow_mut();
        let kind = crate::tools::run(&a, tool, args_json);
        let appended = a.append(kind);
        a.pending.push(appended);
        return;
    }
    // The future is built in its OWN statement so the `borrow()` guard dies
    // here rather than at the end of the expression — a guard alive across the
    // await panics the next `borrow_mut`, and the seam's chat poll spawns a
    // second `drive` every 400 ms, so there always is a next one.
    let running = crate::runtime::execute_effect(&app.borrow().ports, effect);
    let result = running.await;
    let mut a = app.borrow_mut();
    match result {
        Ok(event) => {
            let appended = a.append(event.kind);
            a.pending.push(appended);
        }
        Err(e) => crate::failure::record(&mut a, e),
    }
}
