//! Concurrent tool-call dispatch for one model turn.
//!
//! When a single model turn yields **two or more** tool calls, the agent should not
//! pay the latency of running them one after another — most compiled tools are
//! `fetch`-bound (web search, web fetch, the local bridge), so their wall-clock time
//! overlaps for free on the browser event loop. This module runs every call from a
//! turn **concurrently** via [`futures_util::future::join_all`] — the same mechanism
//! `orchestrator.rs` already uses to fan out child agents — and returns the results
//! **in call order**, so the engine can feed observations back deterministically
//! regardless of which call finished first.
//!
//! WASM is single-threaded: `join_all` here is *cooperative* concurrency on the one
//! browser event loop, not parallel threads. Each call gets its own clone of the
//! [`AppSnapshot`] (mirroring the orchestrator's per-child snapshot clone) so the
//! concurrent futures never alias a single `&mut snapshot`.
//!
//! Handlers run against that clone. With one exception, every mutation a handler
//! makes to its clone is intentionally discarded when the clone drops — the durable
//! side effects live in the browser (OPFS / the bridge), not in the snapshot. The
//! exception is `agent_memories`: `call_agent` runs a sub-agent that produces a
//! rolling summary, and that summary must reach the parent. So the dispatcher moves
//! each call's `agent_memories` out of its clone after the handler finishes and
//! surfaces it alongside the [`ToolResult`], in call order, for the engine to merge
//! into the real snapshot. All OTHER clone mutations are still discarded by design.
//!
//! The untrusted-data boundary is unchanged: a [`ToolResult`] returned here is
//! observation/evidence, never an instruction. This module only *runs* tools and
//! orders their outputs; the engine still validates each result and decides what to
//! do with it.

use super::execution::BrowserExecutionProvider;
use crate::state::{AgentMemory, AppSnapshot, ToolResult};
use futures_util::future::join_all;
use serde_json::Value;
use std::future::Future;

/// One prepared tool call, ready to dispatch. The engine builds these after it has
/// assigned a stable `call_id`, emitted the `ToolRequested` event, and decided —
/// against the agent's allowlist — whether the call is `allowed`. Keeping the
/// allowlist decision on the engine side preserves it as the single visible gate
/// (CLAUDE.md invariant 7); this module only honors the flag.
#[derive(Clone, Debug)]
pub struct PreparedCall {
    /// Stable identifier the engine assigned to this call (echoed into its result).
    pub call_id: String,
    /// The compiled (or MCP-backed) tool name the model asked for.
    pub name: String,
    /// The parsed call arguments (untrusted: produced by the model).
    pub args: Value,
    /// Whether this call passed the agent's tool allowlist. A disallowed call is not
    /// executed; it yields a structured "not allowed" result instead.
    pub allowed: bool,
    /// The agent's allowlist, used only to render a helpful message on a disallowed
    /// call so the model can see which tools it *may* use.
    pub enabled_tools: Vec<String>,
}

/// Run every prepared call from one model turn **concurrently** and return their
/// results paired with each call's `agent_memories` delta, **in call order** (the
/// order of `calls`), regardless of completion order.
///
/// The single-call path is identical in behavior to running that one call directly:
/// `join_all` over a one-element iterator awaits exactly that future and yields a
/// one-element `Vec`. For two or more calls the futures overlap on the event loop.
///
/// Each call executes against its **own clone** of `snapshot` so the concurrent
/// futures do not alias a single `&mut AppSnapshot`. After the handler finishes, the
/// clone's `agent_memories` is moved out and returned as the second tuple element —
/// the one mutation that must survive (a `call_agent` sub-run's rolling summary). All
/// other clone mutations are discarded; matching the orchestrator's per-child clone.
///
/// Tool output is untrusted DATA. This function returns results verbatim; validation
/// and the decision to admit a result as evidence stay with the engine.
pub async fn dispatch_tool_calls(
    executor: &BrowserExecutionProvider,
    snapshot: &AppSnapshot,
    calls: &[PreparedCall],
) -> Vec<(ToolResult, Vec<AgentMemory>)> {
    // Build one future per call up front (they don't run until polled), then hand the
    // whole batch to the concurrent core. Each future captures *owned* clones of what
    // it needs — including its own snapshot clone — so they can all coexist and overlap
    // without aliasing `&mut snapshot`, mirroring orchestrator.rs's per-child clone.
    let futures = calls.iter().map(|call| {
        let mut call_snapshot = snapshot.clone();
        let call = call.clone();
        async move {
            let result = if call.allowed {
                executor
                    .execute_domain_tool(
                        &mut call_snapshot,
                        call.call_id.clone(),
                        &call.name,
                        call.args.clone(),
                    )
                    .await
            } else {
                disallowed_tool_result(&call.call_id, &call.name, &call.enabled_tools)
            };
            // Surface the handler's `agent_memories` mutation (e.g. a `call_agent`
            // sub-run's rolling summary) for the engine to merge in call order. Every
            // other mutation on `call_snapshot` is intentionally dropped here.
            (result, call_snapshot.agent_memories)
        }
    });
    join_in_order(futures).await
}

/// The pure concurrent core: drive every future in `futures` **concurrently** with
/// [`join_all`] and collect the outputs **in input order**.
///
/// Factoring this out (a) keeps the dispatcher's ordering/concurrency guarantee
/// independent of the concrete executor, so it can be unit-tested on the host with
/// mock async tool fns, and (b) names the one place that decides "run together, keep
/// order". The futures are already constructed by the caller; they all coexist here,
/// which is exactly the overlap we want.
async fn join_in_order<I>(futures: I) -> Vec<<I::Item as Future>::Output>
where
    I: IntoIterator,
    I::Item: Future,
{
    // `join_all` polls every future cooperatively and yields outputs in the SAME order
    // as the inputs — i.e. call order — so the engine feeds observations back
    // deterministically regardless of which call finished first.
    join_all(futures).await
}

/// The result handed back for a call whose tool is not in the agent's allowlist. Kept
/// here (rather than executing) so a disallowed call still produces a well-formed,
/// ordered [`ToolResult`] the engine can surface as feedback to the model.
fn disallowed_tool_result(call_id: &str, tool_name: &str, enabled_tools: &[String]) -> ToolResult {
    let allowlist = if enabled_tools.is_empty() {
        "<empty>".to_string()
    } else {
        enabled_tools.join(", ")
    };
    ToolResult {
        call_id: call_id.to_string(),
        ok: false,
        content: format!(
            "Tool `{tool_name}` is not in this agent's tool allowlist. Allowed tools: {allowlist}."
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::pin::Pin;
    use std::rc::Rc;
    use std::task::{Context, Poll, Waker};

    /// Shared instrumentation across all mock tool futures in one dispatch. `in_flight`
    /// is the live count of futures currently parked between their first and last poll;
    /// `peak` is the high-water mark. If two calls overlap, `peak` reaches >= 2 — which
    /// a strictly sequential dispatch could never produce.
    #[derive(Default)]
    struct Instrument {
        in_flight: Cell<usize>,
        peak: Cell<usize>,
        completion_order: RefCell<Vec<usize>>,
    }

    /// A mock async tool: stands in for `execute_domain_tool`. It parks (returns
    /// `Pending`) for `yields` polls — registering itself as in-flight the whole time —
    /// then completes with a `ToolResult` tagged by `index`. Giving earlier calls *more*
    /// yields than later ones forces completion order to invert call order, so a passing
    /// ordering test proves `dispatch` re-sorts to call order rather than coincidentally
    /// matching completion order.
    struct MockToolCall {
        index: usize,
        call_id: String,
        remaining_yields: usize,
        counted_in_flight: bool,
        instrument: Rc<Instrument>,
    }

    impl Future for MockToolCall {
        type Output = ToolResult;

        fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
            if !self.counted_in_flight {
                self.counted_in_flight = true;
                let now = self.instrument.in_flight.get() + 1;
                self.instrument.in_flight.set(now);
                if now > self.instrument.peak.get() {
                    self.instrument.peak.set(now);
                }
            }
            if self.remaining_yields > 0 {
                self.remaining_yields -= 1;
                cx.waker().wake_by_ref();
                return Poll::Pending;
            }
            self.instrument
                .in_flight
                .set(self.instrument.in_flight.get() - 1);
            self.instrument
                .completion_order
                .borrow_mut()
                .push(self.index);
            Poll::Ready(ToolResult {
                call_id: self.call_id.clone(),
                ok: true,
                content: format!("result-{}", self.index),
            })
        }
    }

    /// Hand-drive a future to completion on the host with no async runtime, so the test
    /// is deterministic. The dispatcher's real concurrency mechanism (`join_in_order` ->
    /// `join_all`) is exercised; only the *driver* is hand-rolled. No `unsafe`: the
    /// future is heap-pinned with `Box::pin` and the waker is the std no-op waker. Our
    /// mock futures self-reschedule with `wake_by_ref` while parked, and this loop
    /// re-polls unconditionally, so the waker only needs to be a valid inert handle.
    fn run_to_completion<F: Future>(fut: F) -> F::Output {
        let waker = Waker::noop();
        let mut cx = Context::from_waker(waker);
        let mut fut = Box::pin(fut);
        loop {
            if let Poll::Ready(out) = fut.as_mut().poll(&mut cx) {
                return out;
            }
        }
    }

    /// Build one mock tool future per `(index, yields)` pair, all sharing `instrument`.
    /// This is the test stand-in for the iterator of real `execute_domain_tool` futures
    /// the dispatcher hands to `join_in_order`.
    fn mock_calls(instrument: &Rc<Instrument>, specs: &[(usize, usize)]) -> Vec<MockToolCall> {
        specs
            .iter()
            .map(|&(index, remaining_yields)| MockToolCall {
                index,
                call_id: format!("call-{index}"),
                remaining_yields,
                counted_in_flight: false,
                instrument: Rc::clone(instrument),
            })
            .collect()
    }

    /// Drive `join_in_order` (the dispatcher's concurrent core) with mock async tool
    /// fns whose completion order is the *reverse* of call order. The returned results
    /// must still be in call order — the property the engine relies on to feed
    /// observations back deterministically.
    #[test]
    fn dispatch_returns_results_in_call_order_regardless_of_completion_order() {
        let instrument = Rc::new(Instrument::default());
        // Calls 0..3 in call order. Earlier calls park longer, so they finish LAST.
        let futures = mock_calls(&instrument, &[(0, 4), (1, 2), (2, 0)]);

        let results = run_to_completion(join_in_order(futures));

        // Completion order inverted (2, 1, 0) — proving the assertion below is non-trivial.
        assert_eq!(*instrument.completion_order.borrow(), vec![2, 1, 0]);
        // ...yet results come back in CALL order (0, 1, 2).
        let returned: Vec<String> = results.into_iter().map(|r| r.call_id).collect();
        assert_eq!(returned, vec!["call-0", "call-1", "call-2"]);
    }

    /// Concurrency proof: every mock call parks itself as in-flight before any completes,
    /// so the shared peak counter must reach the fan-out width (3, certainly >= 2). A
    /// sequential dispatch — one tool fully awaited before the next starts — could never
    /// exceed 1 in flight.
    #[test]
    fn dispatch_overlaps_calls_rather_than_sequencing_them() {
        let instrument = Rc::new(Instrument::default());
        let futures = mock_calls(&instrument, &[(0, 1), (1, 1), (2, 1)]);

        let _ = run_to_completion(join_in_order(futures));

        assert!(
            instrument.peak.get() >= 2,
            "expected concurrent overlap, peak in-flight was {}",
            instrument.peak.get()
        );
        assert_eq!(instrument.peak.get(), 3);
    }

    /// The single-call path must behave like running that one call directly: one future,
    /// awaited to completion, yielding a one-element `Vec`.
    #[test]
    fn dispatch_single_call_runs_exactly_one() {
        let instrument = Rc::new(Instrument::default());
        let futures = mock_calls(&instrument, &[(7, 0)]);

        let results = run_to_completion(join_in_order(futures));

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].call_id, "call-7");
        assert_eq!(*instrument.completion_order.borrow(), vec![7]);
        // One call can never overlap with itself.
        assert_eq!(instrument.peak.get(), 1);
    }

    /// Write-back proof: the dispatcher pairs each result with the `agent_memories`
    /// its handler mutated on its own clone, surfaced in CALL order. Here each mock
    /// call future yields `(ToolResult, Vec<AgentMemory>)` — the exact shape
    /// `dispatch_tool_calls` returns — with a per-call memory tagged by index, and
    /// completion order is inverted (call 0 parks longest). The memory deltas must
    /// still come back keyed to their originating call, in call order, so the engine
    /// can merge them deterministically.
    #[test]
    fn dispatch_surfaces_per_call_agent_memory_deltas_in_call_order() {
        let instrument = Rc::new(Instrument::default());
        // Earlier calls park longer (finish last), so completion order inverts.
        let futures = mock_calls(&instrument, &[(0, 4), (1, 2), (2, 0)])
            .into_iter()
            .map(|mock| {
                let index = mock.index;
                async move {
                    let result = mock.await;
                    // Stand in for `call_snapshot.agent_memories` moved out post-handler.
                    let memories = vec![AgentMemory {
                        agent_id: format!("agent-{index}"),
                        rolling_summary: format!("delta-{index}"),
                        updated_at: String::new(),
                    }];
                    (result, memories)
                }
            });

        let returned = run_to_completion(join_in_order(futures));

        // Completion order inverted (2, 1, 0) — proving the call-order claim is non-trivial.
        assert_eq!(*instrument.completion_order.borrow(), vec![2, 1, 0]);
        let pairs: Vec<(String, String)> = returned
            .into_iter()
            .map(|(result, memories)| {
                assert_eq!(memories.len(), 1);
                (result.call_id, memories[0].rolling_summary.clone())
            })
            .collect();
        assert_eq!(
            pairs,
            vec![
                ("call-0".to_string(), "delta-0".to_string()),
                ("call-1".to_string(), "delta-1".to_string()),
                ("call-2".to_string(), "delta-2".to_string()),
            ]
        );
    }

    #[test]
    fn disallowed_call_yields_structured_result_without_running() {
        let result = disallowed_tool_result(
            "call-1",
            "file_write",
            &["web_search".to_string(), "web_fetch".to_string()],
        );

        assert_eq!(result.call_id, "call-1");
        assert!(!result.ok);
        assert!(
            result
                .content
                .contains("not in this agent's tool allowlist")
        );
        assert!(result.content.contains("web_search"));
        assert!(result.content.contains("web_fetch"));
    }

    #[test]
    fn disallowed_call_with_empty_allowlist_reads_clearly() {
        let result = disallowed_tool_result("call-2", "web_search", &[]);
        assert!(!result.ok);
        assert!(result.content.contains("<empty>"));
    }
}
