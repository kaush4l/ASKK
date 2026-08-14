//! The effect runtime loop (§11, ARCHITECTURE §1c). `step` describes; this
//! executes through ports and feeds results back as Events — event sourcing's
//! other half, not an extra system.
//!
//! PROVISIONAL (G4 discovery, the shape change this gate exists to find): the
//! frozen `pump(app, event) -> BoxFuture` held `&mut App` across the model
//! await — wedging every seam round-trip for the whole fetch. Split instead:
//! `pump` is the SYNC thinking half, `execute_effect` returns a `'static`
//! future built from Rc-cloned ports, and `drive` only borrows between awaits.

use std::cell::RefCell;
use std::rc::Rc;

use agent::Effect;
use kernel::{Event, EventKind};

use crate::app::App;
use crate::error::CoreError;

/// Feed one event to `agent::step` and log what moved (I8). Sync — thinking
/// never does I/O. The ONLY caller of `step` at runtime, so the wall between
/// thinking and doing has one door. Returns the effects for `execute_effect`.
pub fn pump(app: &mut App, event: Event) -> Vec<Effect> {
    let phase_before = app.agent.phase;
    let state = std::mem::take(&mut app.agent);
    let (state, effects) = agent::step(state, event);
    app.agent = state;
    if app.agent.phase != phase_before {
        app.append(EventKind::PhaseEntered {
            phase: app.agent.phase,
        });
    }
    effects
}

/// The loop: drain pending events through `pump`, execute the returned
/// effects, append every resulting fact to the log and feed it back, repeat
/// until quiescent; then persist every unpersisted log entry through
/// `StorePort` (`events/<seq>` keys). A failed effect becomes a
/// `core.error` fact — typed, logged, rendered honestly, never retried
/// silently. Borrows the app only BETWEEN awaits.
pub fn drive(app: Rc<RefCell<App>>) -> kernel::BoxFuture<'static, Result<(), CoreError>> {
    Box::pin(async move {
        loop {
            // The space, re-read before every pass: a peer on another Worker may
            // have written to it since the last turn (Python `Engine.context`).
            crate::space::refresh(&app).await;
            let Some(event) = ({
                let mut a = app.borrow_mut();
                if a.pending.is_empty() {
                    None
                } else {
                    Some(a.pending.remove(0))
                }
            }) else {
                break;
            };
            // A message ADDRESSED TO ANOTHER AGENT never enters this engine
            // (increment 07): its turn runs on that agent's own Worker and is
            // recorded in that agent's own history, so two conversations on one
            // page cannot cross. It is not pumped for the same reason: a pumped
            // foreign message puts someone else's words into this agent's paper.
            if let EventKind::UserMessage { text, agent, .. } = &event.kind {
                let (goal, to) = (text.clone(), agent.clone());
                let mine = { to.is_empty() || to == app.borrow().me() };
                if !mine {
                    let _ = crate::batch::run_on(&app, &to, &goal, true).await;
                    continue;
                }
                // This agent enters Working the moment a person speaks to it,
                // and `turns` counts exactly these entries (Python
                // `State.set`: `turns + (status is WORKING)`).
                let me = app.borrow().me().to_string();
                app.borrow_mut().set_status(&me, kernel::Status::Working, "");
            }
            // A command a PERSON typed into the terminal (increment 10). Not an
            // agent turn, so it never enters `step`: it runs in this agent's own
            // workspace, under the same grant, and its result is the same
            // `ToolInvoked` fact the agent's own calls produce.
            if let EventKind::Custom { kind, payload_json } = &event.kind {
                if kind == crate::files::SAVE_REQUEST {
                    let (path, contents) =
                        serde_json::from_str::<(String, String)>(payload_json)
                            .unwrap_or_default();
                    crate::typed::save_typed(&app, &path, &contents).await;
                    continue;
                }
                if kind == crate::files::OPEN_REQUEST {
                    let (path, folder) = serde_json::from_str::<(String, bool)>(payload_json)
                        .unwrap_or_else(|_| (payload_json.clone(), true));
                    crate::typed::open_typed(&app, &path, folder).await;
                    continue;
                }
                // The Processes pane asked what is running — and, when it names
                // one, asked to STOP it first (R10-6). Both are the agent's own
                // tools through the same gate, so the pane can show only what
                // the agent would have been told, and a stop from a button and
                // a stop the model asked for are the same recorded fact.
                if kind == crate::processes::PANE_REQUEST {
                    let name = serde_json::from_str::<String>(payload_json).unwrap_or_default();
                    if !name.is_empty() {
                        crate::typed::stop_process(&app, &name).await;
                    }
                    crate::typed::list_processes(&app).await;
                    continue;
                }
                // STOP (R11-1b). It is handled by a `drive` OTHER than the one
                // wedged inside the command — the seam spawns one per request
                // and this loop borrows the app only between awaits, which is
                // exactly what makes an interrupt reachable while a command is
                // running. That is also why it must come before anything that
                // could await: a stop that queued behind the wedge would be the
                // bug it exists to fix.
                if kind == crate::terminal::STOP_REQUEST {
                    crate::typed::stop_command(&app).await;
                    continue;
                }
                if kind == crate::terminal::EXEC_REQUEST {
                    let command = serde_json::from_str::<String>(payload_json)
                        .unwrap_or_else(|_| payload_json.clone());
                    // IN FLIGHT, where a projection can see it (R2-8). The
                    // pane's own "running…" lived in component state and died
                    // with the component the moment you switched view.
                    app.borrow_mut().running.push(command.clone());
                    crate::typed::run_typed(&app, &command).await;
                    let mut a = app.borrow_mut();
                    if let Some(i) = a.running.iter().position(|c| *c == command) {
                        a.running.remove(i);
                    }
                    continue;
                }
                // The person stopped waiting (11b walk): the turn is over, so
                // the task is cleared exactly as a failed turn clears it — and
                // the swap `reconcile` was deferring can land below. Only when
                // the turn that ended is THIS agent's: a stop on a Worker's
                // pane ends the wait in the log the page projects, and clearing
                // the lead's task on it would abandon a turn nobody ended (12b).
                if kind == crate::chat::TURN_STOPPED {
                    let named = crate::chat::stopped_agent(payload_json);
                    if named.is_empty() || named == app.borrow().me() {
                        app.borrow_mut().agent.task = None;
                    }
                    continue;
                }
            }
            // `record` queues what the log owes the store: the entries this
            // pump appended, or the rewrite a compaction made due.
            let effects = {
                let mut a = app.borrow_mut();
                let effects = pump(&mut a, event);
                crate::logs::record(&mut a);
                effects
            };
            crate::batch::run_effects(&app, effects).await;
        }
        // Quiescent AND nothing outstanding: the turn is over, so the next move
        // is the person's — `Waiting`, which only the entry agent may be in. The
        // outstanding check matters because the seam spawns a `drive` per
        // request: while one awaits, the chat poll starts another that finds
        // nothing pending, and it would report the agent as waiting mid-turn.
        // Only OUT OF Working: a raised turn is already `Failed`, with its why.
        //
        // `task` ALONE WAS NOT THAT CHECK (R13-1). Stop waiting clears the task
        // so the swap `reconcile` defers can land (11b) — and then this wrote
        // `Waiting` over a turn whose `sleep 90` had 71 seconds left, so the
        // board read `main ready · 5 turns` and the Dashboard card read `main
        // finished "…"` with a Read the reply button, for a reply that did not
        // exist. `calling` is the call this process has handed the workspace
        // and not had back — the same fact the Tool trace renders as a running
        // row (`inflight`, R11-4). A turn with one of those outstanding has not
        // finished, whatever the person stopped waiting for.
        let me = app.borrow().me().to_string();
        let finished = {
            let a = app.borrow();
            a.agent.task.is_none()
                && a.calling.is_empty()
                && a.board
                    .get(&me)
                    .is_some_and(|r| r.status == kernel::Status::Working)
        };
        if finished {
            app.borrow_mut()
                .set_status(&me, kernel::Status::Waiting, "");
        }
        // The turn is over: the boundary an agent authored during it installs
        // at (increment 11). Then the agent's own log, in the Python's order.
        crate::roster::reconcile(&mut app.borrow_mut());
        crate::logs::drain(&app).await;
        crate::logs::persist(&app).await?;
        Ok(())
    })
}
