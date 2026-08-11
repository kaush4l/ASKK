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

/// Run one delegation on its agent's Worker, keeping that agent's row on the
/// board current: Working before, Idle after (a sub-agent's caller already has
/// its answer, so it does not go to Waiting), Failed WITH THE MESSAGE if its
/// turn raised — the Python `ThreadedAgent.invoke`, line for line.
async fn delegate(app: &Rc<RefCell<App>>, agent: String, goal: String) -> EventKind {
    let port = {
        let mut a = app.borrow_mut();
        a.set_status(&agent, Status::Working, "");
        Rc::clone(&a.ports.agents)
    };
    let outcome = port.delegate(&agent, &goal).await;
    let mut a = app.borrow_mut();
    let (ok, output) = match outcome {
        Ok(answer) => {
            a.set_status(&agent, Status::Idle, "");
            (true, answer)
        }
        Err(DelegateError::Unknown { agent: name }) => {
            let message = format!("No agent called '{name}' is loaded in this browser.");
            a.set_status(&agent, Status::Failed, &message);
            (false, message)
        }
        Err(DelegateError::Failed { message, .. }) => {
            a.set_status(&agent, Status::Failed, &message);
            (false, format!("{agent} failed: {message}"))
        }
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
        Err(e) => {
            a.append(EventKind::Custom {
                kind: "core.error".into(),
                payload_json: serde_json::to_string(&e)
                    .unwrap_or_else(|_| "\"unserializable error\"".into()),
            });
            // The turn RAISED. The Python marks the agent Failed and records
            // the message (`ThreadedAgent.invoke`); without this the entry
            // agent stays Working forever on the board, which is the one
            // status a person reads as "still going" — a hosted failed turn
            // left it there for the whole session.
            a.agent.task = None;
            let message = crate::failure::sentence(&e);
            a.set_status(crate::app::ENTRY_AGENT, Status::Failed, &message);
        }
    }
}
