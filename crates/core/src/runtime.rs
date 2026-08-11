//! The effect runtime loop (§11, ARCHITECTURE §1c). `step` describes; this
//! executes through ports and feeds results back as Events — event
//! sourcing's other half, not an extra system.
//!
//! PROVISIONAL (G4 discovery, the shape change this gate exists to find):
//! the frozen `pump(app, event) -> BoxFuture` held `&mut App` across the
//! model await — wedging every seam round-trip for the whole fetch. Split
//! instead: `pump` is the SYNC thinking half, `execute_effect` returns a
//! `'static` future built from Rc-cloned ports, and `drive` is the loop that
//! only borrows the app between awaits, never across one.

use std::cell::RefCell;
use std::rc::Rc;

use agent::Effect;
use kernel::{Event, EventId, EventKind, ModelError};

use crate::app::{App, Ports};
use crate::error::CoreError;

/// Feed one event to `agent::step` and log what moved (I8). Sync — thinking
/// never does I/O. This is the ONLY caller of `step` at runtime, so the wall
/// between thinking and doing has exactly one door. Returns the effects for
/// `execute_effect`.
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

/// Execute ONE effect through the ports and return the resulting fact.
/// `'static`: every port handle it needs is Rc-cloned before the future is
/// built, so nothing borrows the app across the await.
pub fn execute_effect(
    ports: &Ports,
    effect: Effect,
) -> impl std::future::Future<Output = Result<Event, CoreError>> + 'static {
    let model = Rc::clone(&ports.model);
    let clock = Rc::clone(&ports.clock);
    async move {
        match effect {
            Effect::CallModel {
                document,
                format,
                endpoint,
                model: model_key,
                speaker,
            } => {
                let messages = context::render(&document, format);
                // The catalogue KEY, not a model id: `adapters_web` resolves
                // it against models.json and stamps the real id on the way out.
                let body = context::openai_request_body(&messages, &model_key);
                let reply = model
                    .call(&endpoint, &body)
                    .await
                    .map_err(CoreError::Model)?;
                let text = context::openai_reply_text(&reply.body_json).ok_or_else(|| {
                    CoreError::Model(ModelError::Provider {
                        status: 200,
                        message: "unrecognizable completion body".into(),
                    })
                })?;
                Ok(Event {
                    id: EventId(0), // assigned at append
                    seq: 0,
                    at: clock.now(),
                    kind: EventKind::ModelReplied {
                        text,
                        // Whose words these are. Empty is this process's own
                        // agent — the reply to the call IT made; `summarizer`
                        // is a compaction, an ordinary agent's turn taken on
                        // this agent's behalf.
                        agent: speaker,
                    },
                })
            }
            Effect::Emit { kind } => Ok(Event {
                id: EventId(0),
                seq: 0,
                at: clock.now(),
                kind,
            }),
            // Tools run against the app (sync) and delegations run as a batch;
            // both live in `batch.rs`, which is the only caller of this fn's
            // siblings. See `batch::run_effects`.
            Effect::InvokeTool { .. } | Effect::Delegate { .. } => {
                unreachable!("executed by batch::run_effects")
            }
            // The rest of the closed set lands with its first emitter.
            Effect::Persist { .. } | Effect::Sleep { .. } => {
                todo!("G5: first emitter of this effect")
            }
        }
    }
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
            // The space, re-read before every pass — the reason the clock is
            // not cached applies twice over: a peer on another Worker may have
            // written to it since the last turn (Python `Engine.context`).
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
            // recorded in that agent's own history, so two conversations on
            // one page cannot cross. This is also why it is not pumped — a
            // pumped foreign message would put someone else's words into this
            // agent's paper.
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
            // A command a PERSON typed into the terminal (increment 10). It is
            // not an agent turn, so it never enters `step`: it runs in this
            // agent's own workspace, under the same grant, and its result is
            // the same `ToolInvoked` fact the agent's own calls produce.
            if let EventKind::Custom { kind, payload_json } = &event.kind {
                if kind == crate::terminal::EXEC_REQUEST {
                    let command = serde_json::from_str::<String>(payload_json)
                        .unwrap_or_else(|_| payload_json.clone());
                    crate::workspace::run_typed(&app, &command).await;
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
        // Quiescent AND no task outstanding: the turn is over, so the next
        // move is the person's — `Waiting`, which only the entry agent may be
        // in. The task check matters because the seam spawns a `drive` per
        // request: while one is awaiting the model, the chat poll starts
        // another that finds nothing pending, and without this it would report
        // the agent as waiting in the middle of its own turn.
        // …and only OUT OF Working: a turn that raised is already `Failed`
        // with its message, and "waiting for you" would erase it.
        let me = app.borrow().me().to_string();
        let finished = {
            let a = app.borrow();
            a.agent.task.is_none()
                && a.board
                    .get(&me)
                    .is_some_and(|r| r.status == kernel::Status::Working)
        };
        if finished {
            app.borrow_mut()
                .set_status(&me, kernel::Status::Waiting, "");
        }
        // The turn is over, so this is the boundary an agent authored or
        // edited during it may be installed at (increment 11).
        crate::roster::reconcile(&mut app.borrow_mut());
        // The agent's own log first, in the order the Python writes it.
        crate::logs::drain(&app).await;
        crate::logs::persist(&app).await?;
        Ok(())
    })
}
