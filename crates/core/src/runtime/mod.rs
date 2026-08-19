//! The effect runtime loop (§11, ARCHITECTURE §1c). `step` describes; this
//! executes through ports and feeds results back as Events — event sourcing's
//! other half, not an extra system.
//!
//! PROVISIONAL (G4 discovery, the shape change this gate exists to find): the
//! frozen `pump(app, event) -> BoxFuture` held `&mut App` across the model
//! await — wedging every seam round-trip for the whole fetch. Split instead:
//! `pump` is the SYNC thinking half, `execute_port_effect` returns a `'static`
//! future built from Rc-cloned ports, and `drive` only borrows between awaits.

mod requests;

use std::cell::RefCell;
use std::rc::Rc;

use agent::Effect;
use kernel::{Event, EventKind};

use crate::app::App;
use crate::error::CoreError;

/// Feed one event to `agent::step` and log what moved (I8). Sync — thinking
/// never does I/O. The ONLY caller of `step` at runtime, so the wall between
/// thinking and doing has one door. Returns the effects for `execute_port_effect`.
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
            // THE "BEFORE EVERY MODEL CALL" HOOK. Every faculty this agent
            // declared is re-read here, so what the model sees is what the
            // world is now rather than what it was when the turn began — a
            // page snapshot, a shared space, whatever the host can reach.
            //
            // The space goes first because it is two things: `refresh` re-reads
            // the store into the state the space TOOLS use (a peer on another
            // Worker may have written since the last turn — Python
            // `Engine.context`), and `refresh_all` then renders it for the
            // PROMPT as one faculty among the declared set, through the same
            // port a browser faculty would arrive by.
            crate::space::shared::refresh(&app).await;
            crate::faculty::refresh_all(&app).await;
            let Some(event) = next(&app) else { break };
            if let EventKind::UserMessage { text, agent, .. } = &event.kind {
                if requests::ran_elsewhere(&app, text, agent).await {
                    continue;
                }
            }
            if let EventKind::Custom { kind, payload_json } = &event.kind {
                if requests::serve(&app, kind, payload_json).await {
                    continue;
                }
            }
            crate::batch::run_effects(&app, think(&app, event)).await;
        }
        rest_if_finished(&app);
        // The turn is over: the boundary an agent authored during it installs
        // at (increment 11). Then the agent's own log, in the Python's order.
        crate::agents::roster::reconcile(&mut app.borrow_mut());
        crate::log::store::drain(&app).await;
        crate::log::store::persist(&app).await?;
        Ok(())
    })
}

/// The next pending event, taken in one borrow that ends with this call — the
/// loop above holds nothing across its awaits.
fn next(app: &Rc<RefCell<App>>) -> Option<Event> {
    let mut a = app.borrow_mut();
    match a.pending.is_empty() {
        true => None,
        false => Some(a.pending.remove(0)),
    }
}

/// The thinking half of one pass, in one borrow: `pump` decides, and `record`
/// queues what the log owes the store — the entries this pump appended, or the
/// rewrite a compaction made due.
fn think(app: &Rc<RefCell<App>>, event: Event) -> Vec<Effect> {
    let mut a = app.borrow_mut();
    let effects = pump(&mut a, event);
    crate::log::store::record(&mut a);
    effects
}

/// Quiescent AND nothing outstanding: the turn is over, so the next move is the
/// person's — `Waiting`, which only the entry agent may be in. The outstanding
/// check matters because the seam spawns a `drive` per request: while one
/// awaits, the chat poll starts another that finds nothing pending, and it
/// would report the agent as waiting mid-turn. Only OUT OF Working: a raised
/// turn is already `Failed`, with its why.
///
/// `task` ALONE WAS NOT THAT CHECK (R13-1). Stop waiting clears the task so the
/// swap `reconcile` defers can land (11b) — and then this wrote `Waiting` over
/// a turn whose `sleep 90` had 71 seconds left, so the board read `main ready ·
/// 5 turns` and the Dashboard card read `main finished "…"` with a Read the
/// reply button, for a reply that did not exist. `calling` is the call this
/// process has handed the workspace and not had back — the same fact the Tool
/// trace renders as a running row (`inflight`, R11-4). A turn with one of those
/// outstanding has not finished, whatever the person stopped waiting for.
fn rest_if_finished(app: &Rc<RefCell<App>>) {
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
}
