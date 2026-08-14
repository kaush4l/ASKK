//! One effect, executed. Split from `runtime.rs`, which owns the drive loop,
//! so both hold the 200-line rule (I12): this file is the only place in the
//! core where a port is actually called for a model turn, and the loop above
//! it is the only place that decides when.

use std::rc::Rc;

use kernel::{Event, EventId, EventKind, ModelError};

use crate::app::Ports;
use crate::error::CoreError;
use agent::Effect;

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
                temperature,
                speaker,
            } => {
                let messages = context::render(&document, format);
                // The catalogue KEY, not a model id: `adapters_web` resolves
                // it against models.json and stamps the real id on the way out.
                let body = context::openai_request_body(&messages, &model_key, temperature);
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

