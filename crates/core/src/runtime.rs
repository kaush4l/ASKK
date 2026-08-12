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
use kernel::{Event, EventId, EventKind, ModelError};

use crate::app::{App, Ports};
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

/// Execute ONE effect through the ports and return the resulting FACTS, in
/// order. Usually one; a model call that came back with an accounting block
/// returns two, because what it cost is a different fact from what it said.
/// `'static`: every port handle it needs is Rc-cloned before the future is
/// built, so nothing borrows the app across the await.
pub fn execute_effect(
    ports: &Ports,
    effect: Effect,
) -> impl std::future::Future<Output = Result<Vec<Event>, CoreError>> + 'static {
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
                let at = clock.now();
                let fact = |kind| Event {
                    id: EventId(0), // assigned at append
                    seq: 0,
                    at,
                    kind,
                };
                // What it cost, when the provider says. `ModelCalled` has been
                // in the closed set since G2 and nothing ever emitted it: the
                // adapter dropped `usage` on the floor and every meter in the
                // product had nothing to project. It is the FIRST of the two,
                // so a reader folding the log sees the cost of a reply before
                // the reply, never after it.
                // The port moved bytes; reading them is this layer's job, and
                // `context` owns every provider quirk (§8.1). A port that
                // fills `usage` itself is honoured, so an adapter with a
                // richer source than the body can still say so.
                let spent = reply.usage.or_else(|| context::openai_usage(&reply.body_json));
                let spent = spent.map(|u| {
                    fact(EventKind::ModelCalled {
                        document_hash: context::content_hash(&messages),
                        spent_tokens: u.input_tokens + u.output_tokens,
                    })
                });
                Ok(spent
                    .into_iter()
                    .chain([fact(EventKind::ModelReplied {
                        text,
                        // Whose words these are. Empty is this process's own
                        // agent — the reply to the call IT made; `summarizer` is
                        // a compaction, a turn taken on this agent's behalf.
                        agent: speaker,
                    })])
                    .collect())
            }
            Effect::Emit { kind } => Ok(vec![Event {
                id: EventId(0),
                seq: 0,
                at: clock.now(),
                kind,
            }]),
            // Tools run against the app (sync) and delegations as a batch; both
            // live in `batch.rs`. See `batch::run_effects`.
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
                if kind == crate::files::OPEN_REQUEST {
                    let (path, folder) = serde_json::from_str::<(String, bool)>(payload_json)
                        .unwrap_or_else(|_| (payload_json.clone(), true));
                    crate::workspace::open_typed(&app, &path, folder).await;
                    continue;
                }
                if kind == crate::terminal::EXEC_REQUEST {
                    let command = serde_json::from_str::<String>(payload_json)
                        .unwrap_or_else(|_| payload_json.clone());
                    crate::workspace::run_typed(&app, &command).await;
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
        // Quiescent AND no task outstanding: the turn is over, so the next move
        // is the person's — `Waiting`, which only the entry agent may be in. The
        // task check matters because the seam spawns a `drive` per request:
        // while one awaits the model, the chat poll starts another that finds
        // nothing pending, and it would report the agent as waiting mid-turn.
        // Only OUT OF Working: a raised turn is already `Failed`, with its why.
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
        // The turn is over: the boundary an agent authored during it installs
        // at (increment 11). Then the agent's own log, in the Python's order.
        crate::roster::reconcile(&mut app.borrow_mut());
        crate::logs::drain(&app).await;
        crate::logs::persist(&app).await?;
        Ok(())
    })
}
