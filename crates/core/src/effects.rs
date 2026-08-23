//! The one place in the core where a PORT is called for a model turn. Its
//! neighbour `runtime/mod.rs` owns the drive loop and so owns *when*; this file
//! owns *how*, and holds no policy about either. The effects that run against
//! the app rather than a port — tools, delegations — are `batch.rs`'s.

use std::rc::Rc;

use kernel::{Event, EventId, EventKind, ModelError};

use crate::app::Ports;
use crate::error::CoreError;
use agent::Effect;

/// Execute ONE effect THROUGH THE PORTS and return the resulting FACTS, in
/// order. Usually one; a model call that came back with an accounting block
/// returns two, because what it cost is a different fact from what it said.
///
/// `port` is in the name because it is the whole contract: the two effects
/// that run against the app instead — `InvokeTool` and `Delegate` — reach
/// `batch::run_effects` and never this function, which is why their arms here
/// are `unreachable!`.
///
/// `'static`: every port handle it needs is Rc-cloned before the future is
/// built, so nothing borrows the app across the await.
pub fn execute_port_effect(
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
                        evicted: evicted(&document),
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
        }
    }
}

/// WHAT THE BUDGET TOOK OUT OF THIS PAPER ALTOGETHER — the sections the ADR-009
/// ladder walked all the way to `Elided`, in the order it walked them.
///
/// THE FILTER IS THE POINT, AND IT IS NOT AN OPTIMISATION. `degrade::degrade`
/// records every step it takes, and most of them are a budget working correctly:
/// a long conversation summarises its history and points at its space, the
/// headings stay, and the model is told how to ask for either back. Recording
/// those would put a row in the log on every model call to say nothing was
/// wrong, and a person who is shown a warning on every healthy turn stops
/// reading warnings. `Elided` is the step that is different in KIND: the heading
/// goes, so an agent whose prose says "read `## observations`" is now looking at
/// a paper that has no such block, and neither it nor the person can tell.
///
/// Read off the DOCUMENT and not off the ladder: `report` is the assembly's own
/// receipt (I8, no second truth), and this is the only place in the core that
/// holds a Document and an event emitter at the same time.
fn evicted(document: &context::Document) -> Vec<kernel::SectionId> {
    document
        .report
        .steps
        .iter()
        .filter(|step| step.to == context::Fidelity::Elided)
        .map(|step| step.section.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use context::{Budget, CompactionReport, CompactionStep, Document, Fidelity};
    use kernel::SectionId;

    /// A report the ladder could have produced: two sections stepped down and
    /// only one of them gone. Built as a literal because the FILTER is what
    /// this file owns — that the ladder reaches `Elided` at all is
    /// `context::degrade`'s behaviour and is tested there.
    fn document(steps: Vec<(&str, Fidelity)>) -> Document {
        Document {
            phase: kernel::PhaseId::Work,
            sections: Vec::new(),
            report: CompactionReport {
                budget: Budget { max_tokens: 4096 },
                spent: 4096,
                steps: steps
                    .into_iter()
                    .map(|(id, to)| CompactionStep {
                        section: SectionId(id.into()),
                        from: Fidelity::Full,
                        to,
                    })
                    .collect(),
                withheld: Vec::new(),
            },
        }
    }

    /// **ONLY THE SECTIONS THAT ARE GONE.** Positive control: change the filter
    /// in `evicted` to `!=` and this fails naming `history` and `space`, which
    /// is the noisy-log outcome the field's doc comment argues against.
    #[test]
    fn a_working_budget_records_nothing_and_an_eviction_records_itself() {
        let healthy = document(vec![
            ("history", Fidelity::Summarized),
            ("space", Fidelity::Pointer),
        ]);
        assert!(
            super::evicted(&healthy).is_empty(),
            "a budget that summarised and pointered lost nothing: {:?}",
            super::evicted(&healthy)
        );
        let lost = document(vec![
            ("history", Fidelity::Pointer),
            ("observations", Fidelity::Elided),
        ]);
        assert_eq!(
            super::evicted(&lost),
            vec![SectionId("observations".into())],
            "the elided component is the one fact this field carries"
        );
    }
}

