//! One LLM call with bounded retries (MAP hop 5): resolve the provider,
//! stream deltas to the host sink, race the in-flight call against the run's
//! cancel token, back off on error. Kept out of `turn` so the per-turn loop
//! reads as assemble → infer → parse → act. Nothing here throws into the loop:
//! a resolver miss, a cancel, or exhausted retries all land a terminal.

use askk_core::{InferenceReply, InferenceRequest, ProviderError, RunStatus, Signal, SignalKind};
use futures::future::{select, Either};

use crate::config::AgentConfig;
use crate::run::session::{RunState, Shared};
use crate::run::turn::{emit, MAX_PROVIDER_ATTEMPTS};
use crate::state::StoreError;

/// One LLM call: ≤3 attempts with host-owned backoff. `None` = the run
/// failed terminally (Error signal already emitted).
pub(crate) async fn infer_with_retry(
    shared: &Shared,
    run: &mut RunState,
    agent: &AgentConfig,
    request: &InferenceRequest,
) -> Result<Option<InferenceReply>, StoreError> {
    emit(shared, run, SignalKind::LlmRequest).await?;
    run.turns += 1;
    run.phase_turns += 1;
    let provider = match (shared.resolver)(&agent.provider) {
        Ok(provider) => provider,
        Err(e) => {
            emit(
                shared,
                run,
                SignalKind::Error {
                    message: e.to_string(),
                },
            )
            .await?;
            run.status = RunStatus::Failed;
            return Ok(None);
        }
    };
    let host = shared.host(&run.id);
    let run_id = run.id.clone();
    // Cloned Rc so no borrow of `run` is held across the select await.
    let cancel = run.cancel_requested.clone();
    let mut last_error = None;
    for attempt in 0..MAX_PROVIDER_ATTEMPTS {
        // Deltas reach the host sink AS THEY ARRIVE (`on_delta` is sync; the
        // log writer is async). They are transient UI signals — seq 0, never
        // logged: `LlmResponse` is the durable record and fold ignores
        // LlmDelta either way (ADR-003).
        let mut sink = |delta: &str| {
            host.on_signal(&Signal {
                seq: 0,
                run_id: run_id.clone(),
                ts_ms: host.now_ms(),
                kind: SignalKind::LlmDelta {
                    text: delta.to_string(),
                },
            });
        };
        // Race the in-flight call against the run's cancel token (GAPS 17):
        // on cancel the provider future is DROPPED mid-stream — FetchTransport
        // aborts the browser fetch on drop — and the run lands the same
        // Interrupted terminal as a between-turn cancel.
        let infer = provider.infer(request, &mut sink);
        let result = match select(infer, cancel.cancelled()).await {
            Either::Left((result, _)) => result,
            Either::Right(((), infer)) => {
                drop(infer); // stop consuming; the transport aborts the fetch
                emit(shared, run, SignalKind::Interrupted).await?;
                run.status = RunStatus::Interrupted;
                return Ok(None);
            }
        };
        match result {
            Ok(reply) => {
                emit(
                    shared,
                    run,
                    SignalKind::LlmResponse {
                        text: reply.text.clone(),
                    },
                )
                .await?;
                return Ok(Some(reply));
            }
            Err(e) => {
                let backoff = match &e {
                    ProviderError::RateLimited {
                        retry_after_ms: Some(ms),
                    } => *ms,
                    _ => 250 * (u64::from(attempt) + 1),
                };
                last_error = Some(e);
                if attempt + 1 < MAX_PROVIDER_ATTEMPTS {
                    host.sleep(backoff).await;
                }
            }
        }
    }
    // The loop runs at least once (MAX_PROVIDER_ATTEMPTS >= 1), so last_error is
    // set — but degrade instead of unwrapping: a bare `expect` in the failure
    // path is exactly the panic a "keep the app moving" layer must not have.
    let message = match last_error {
        Some(e) => e.to_string(),
        None => "provider call failed".to_string(),
    };
    emit(shared, run, SignalKind::Error { message }).await?;
    run.status = RunStatus::Failed;
    Ok(None)
}
