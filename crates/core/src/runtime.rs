//! The effect runtime loop (§11, ARCHITECTURE §1c). `step` describes; this
//! executes through ports and feeds results back as Events — event
//! sourcing's other half, not an extra system.
//!
//! PROVISIONAL (G4 discovery, the shape change this gate exists to find):
//! the frozen `pump(app, event) -> BoxFuture` held `&mut App` across the
//! model await — under a browser host that wedges every seam round-trip
//! (the 400 ms chat polls) for the whole fetch. Split instead: `pump` is the
//! SYNC thinking half (step + log), `execute_effect` returns a `'static`
//! future built from Rc-cloned ports (the doing half), and `drive` is the
//! loop that only borrows the app between awaits, never across one.

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
            } => {
                let messages = context::render(&document, format);
                let body = context::openai_request_body(&messages, "local");
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
                    kind: EventKind::ModelReplied { text },
                })
            }
            Effect::Emit { kind } => Ok(Event {
                id: EventId(0),
                seq: 0,
                at: clock.now(),
                kind,
            }),
            // The rest of the closed set lands with its first emitter.
            Effect::InvokeTool { .. }
            | Effect::Persist { .. }
            | Effect::Sleep { .. }
            | Effect::Spawn { .. } => todo!("G5: first emitter of this effect"),
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
            let effects = pump(&mut app.borrow_mut(), event);
            for effect in effects {
                let fut = execute_effect(&app.borrow().ports, effect);
                let result = fut.await;
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
                    }
                }
            }
        }
        // Persistence: the log is truth in memory the moment it is appended;
        // the store catches up here. A failed write is itself a fact.
        let (store, batch) = {
            let mut a = app.borrow_mut();
            (
                Rc::clone(&a.ports.store),
                std::mem::take(&mut a.unpersisted),
            )
        };
        for event in batch {
            let key = format!("events/{:08}", event.seq);
            let value = serde_json::to_string(&event).map_err(|e| {
                CoreError::Store(kernel::StoreError::Backend {
                    message: e.to_string(),
                })
            })?;
            if let Err(e) = store.kv().put(&key, &value).await {
                app.borrow_mut().append(EventKind::StoreFailed {
                    key,
                    message: format!("{e:?}"),
                });
                return Err(CoreError::Store(e));
            }
        }
        Ok(())
    })
}
