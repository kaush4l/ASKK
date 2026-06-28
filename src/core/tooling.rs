//! Tool dispatch primitives shared by the [`super::tool`] composition layer: the
//! callable shape every tool exposes ([`ToolBinding`] / [`ToolFuture`]), the
//! concurrent fan-out ([`join_in_order`]), and the structured allowlist
//! rejection ([`disallowed_tool_result`]).
//!
//! A [`ToolBinding`] is an owned async callable from `(snapshot, args)` to a
//! result string: the closure generalization of `crate::tools::ToolHandler` (a
//! plain `fn` pointer). A compiled tool, a JS body, an MCP tool, and a sub-agent
//! delegation are all just `Rc<dyn Tool>` entries in the [`super::ToolSet`],
//! indistinguishable to the loop — the paradigm is chosen when the set is built,
//! never branched on at dispatch.
//!
//! Membership IS the allowlist: a name absent from the set is rejected with a
//! structured [`ToolResult`] before anything executes, preserving the single
//! visible approval gate.

use crate::state::{AppResult, AppSnapshot, ToolResult};
use futures_util::future::join_all;
use serde_json::Value;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;

/// Boxed future a tool binding returns. Same shape as `crate::tools::ToolFuture`,
/// re-declared here so the core stays self-contained.
pub type ToolFuture<'a> = Pin<Box<dyn Future<Output = AppResult<String>> + 'a>>;

/// A bound tool: an owned async callable from `(snapshot, args)` to a result.
/// `Rc` because the engine and in-flight call futures share it on the one
/// browser event loop (no `Send` — WASM is single-threaded).
pub type ToolBinding = Rc<dyn for<'a> Fn(&'a mut AppSnapshot, &'a Value) -> ToolFuture<'a>>;

/// The pure concurrent core of multi-call dispatch: drive every future in
/// `futures` **concurrently** with [`join_all`] and collect the outputs **in
/// input order** — i.e. call order — so observations feed back
/// deterministically regardless of which call finished first. WASM is
/// single-threaded: this is cooperative concurrency on the one event loop,
/// not parallel threads.
pub(crate) async fn join_in_order<I>(futures: I) -> Vec<<I::Item as Future>::Output>
where
    I: IntoIterator,
    I::Item: Future,
{
    join_all(futures).await
}

/// The result for a call whose tool is not in the map. A disallowed call still
/// produces a well-formed, ordered [`ToolResult`] the engine can surface as
/// feedback to the model. Same model-visible message as the engine shell's
/// dispatcher renders today.
pub fn disallowed_tool_result(call_id: &str, tool_name: &str, allowed: &[String]) -> ToolResult {
    let allowlist = if allowed.is_empty() {
        "<empty>".to_string()
    } else {
        allowed.join(", ")
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
    use crate::state::AgentMemory;
    use std::cell::{Cell, RefCell};
    use std::task::{Context, Poll, Waker};

    /// Shared instrumentation across all mock tool futures in one dispatch.
    /// `in_flight` is the live count of futures parked between their first and
    /// last poll; `peak` is the high-water mark. If two calls overlap, `peak`
    /// reaches >= 2 — which a strictly sequential dispatch could never produce.
    #[derive(Default)]
    struct Instrument {
        in_flight: Cell<usize>,
        peak: Cell<usize>,
        completion_order: RefCell<Vec<usize>>,
    }

    /// A mock async tool: parks (returns `Pending`) for `yields` polls —
    /// registering itself as in-flight the whole time — then completes with a
    /// `ToolResult` tagged by `index`. Giving earlier calls *more* yields than
    /// later ones forces completion order to invert call order, so a passing
    /// ordering test proves the dispatcher re-sorts to call order rather than
    /// coincidentally matching completion order.
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

    /// Hand-drive a future to completion on the host with no async runtime, so
    /// the test is deterministic. No `unsafe`: the future is heap-pinned with
    /// `Box::pin` and the waker is the std no-op waker; the mock futures
    /// self-reschedule with `wake_by_ref` while parked and this loop re-polls
    /// unconditionally.
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

    /// Build one mock tool future per `(index, yields)` pair, all sharing
    /// `instrument` — the stand-in for the iterator of real call futures the
    /// engine hands to `join_in_order`.
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

    /// Drive `join_in_order` with mock async tool fns whose completion order is
    /// the *reverse* of call order. The returned results must still be in call
    /// order — the property the engine relies on to feed observations back
    /// deterministically.
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

    /// Concurrency proof: every mock call parks itself as in-flight before any
    /// completes, so the shared peak counter must reach the fan-out width. A
    /// sequential dispatch — one tool fully awaited before the next starts —
    /// could never exceed 1 in flight.
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

    /// The single-call path must behave like running that one call directly:
    /// one future, awaited to completion, yielding a one-element `Vec`.
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

    /// Write-back proof: results paired with per-call `agent_memories` deltas
    /// come back keyed to their originating call, in call order, even when
    /// completion order inverts — so the engine can merge them deterministically.
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
                    // Stand in for a call snapshot's `agent_memories` moved out
                    // after the handler finishes.
                    let memories = vec![AgentMemory {
                        agent_id: format!("agent-{index}"),
                        rolling_summary: format!("delta-{index}"),
                        updated_at: String::new(),
                    }];
                    (result, memories)
                }
            });

        let returned = run_to_completion(join_in_order(futures));

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
