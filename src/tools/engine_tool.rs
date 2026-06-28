//! `EngineTool` — the engine-as-a-tool: a peer agent exposed as a first-class
//! [`crate::core::Tool`] (paradigm [`ToolParadigm::Agent`]). It carries its
//! advertised [`ToolSpec`] and the fixed target agent id; each call resolves that
//! agent from the live snapshot and runs its own ReAct loop on the focused
//! sub-goal, returning the final answer as an UNTRUSTED observation.
//!
//! [`delegate`] is the single engine-spawn seam every delegation path routes
//! through. The per-agent `agent_<slug>` tools ARE [`EngineTool`]s (built by the
//! shell when it assembles the run's tool set); the generic [`super::call_agent`]
//! tool shares the same seam, reading the target agent from the model's arguments.
//! The nesting cap, sub-snapshot isolation, rolling-summary write-back, and
//! untrusted-observation framing all live in [`delegate`], defined exactly once.
//!
//! In-process today (the sub-run shares this thread); Phase 4 will let an
//! `EngineTool` spawn its engine into a dedicated worker and stream the sub-run's
//! Signals onto the bus. The sub-agent's answer is UNTRUSTED DATA, exactly like
//! any other tool observation (CLAUDE.md invariant 3) — it is returned as a plain
//! result string and never treated as an instruction to the caller.

use std::cell::Cell;

use serde_json::Value;

use super::common::{integer_arg, optional_string_arg, string_arg};
use crate::core::{Tool, ToolFuture, ToolParadigm};
use crate::engine::{LoopParams, SessionRunner};
use crate::state::{Agent, AgentMemory, AppResult, AppSnapshot, ToolSpec, upsert_rolling_summary};

/// Hard cap on nested delegation depth. Each level is already bounded by the run
/// step budget, and delegation is opt-in (not in the default tool allowlist), but
/// a misconfigured pair of agents could still delegate to each other indefinitely.
/// This cap makes runaway nesting unrepresentable. WASM is single-threaded, so a
/// thread-local `Cell` is a sufficient, lock-free counter.
const MAX_NESTING_DEPTH: u32 = 3;

/// Ceiling on a caller-supplied per-invocation step budget. The budget is
/// model-controlled data; without a clamp a buggy model could request a budget
/// that burns the user's tokens for hours.
pub(crate) const MAX_SUB_AGENT_TURNS: u32 = 100;

thread_local! {
    static NESTING_DEPTH: Cell<u32> = const { Cell::new(0) };
}

/// RAII guard that increments the nesting depth on entry and decrements it on drop,
/// so the counter is always balanced even if the sub-run returns an error.
#[derive(Debug)]
struct DepthGuard;

impl DepthGuard {
    /// Enter one nesting level, or return an error result if the cap is reached.
    fn enter() -> AppResult<Self> {
        NESTING_DEPTH.with(|depth| {
            let current = depth.get();
            if current >= MAX_NESTING_DEPTH {
                return Err(format!(
                    "call_agent nesting limit reached ({MAX_NESTING_DEPTH}); refusing to delegate deeper to avoid runaway recursion."
                ));
            }
            depth.set(current + 1);
            Ok(Self)
        })
    }
}

impl Drop for DepthGuard {
    fn drop(&mut self) {
        NESTING_DEPTH.with(|depth| depth.set(depth.get().saturating_sub(1)));
    }
}

/// A peer agent exposed as a first-class [`Tool`] (paradigm [`ToolParadigm::Agent`])
/// — the engine-as-a-tool. It carries its advertised [`ToolSpec`] and the fixed
/// target agent id (resolved when the run's tool set was assembled). The shell
/// builds one per enabled `agent_<slug>` name, so the loop dispatches delegation
/// polymorphically through [`Tool::call`] with no name special-casing.
pub(crate) struct EngineTool {
    spec: ToolSpec,
    agent_id: String,
}

impl EngineTool {
    /// Expose `agent_id` as a callable tool advertised by `spec`. The agent is
    /// resolved lazily at call time against the live snapshot.
    pub(crate) fn for_agent(spec: ToolSpec, agent_id: String) -> Self {
        Self { spec, agent_id }
    }
}

impl Tool for EngineTool {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn paradigm(&self) -> ToolParadigm {
        ToolParadigm::Agent
    }

    fn call<'a>(&'a self, snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
        Box::pin(async move {
            let query = string_arg(args, "query")?;
            let strategy = optional_string_arg(args, "strategy");
            // Negatives are meaningless as a step budget; clamp to >= 0 here and
            // let `delegate` apply the upper ceiling. `agent` is fixed (this tool
            // IS a specific agent), so it is not read from the model's arguments.
            let max_turns = integer_arg(args, "max_turns").map(|value| value.max(0) as u32);
            delegate(snapshot, &self.agent_id, &query, strategy, max_turns).await
        })
    }
}

/// The single engine-spawn seam: resolve `agent_ref` (id or name, case-insensitive)
/// to a peer agent and run its own ReAct loop on `query`, returning the final
/// answer framed as an UNTRUSTED observation. Both the per-agent [`EngineTool`]
/// tools and the generic [`super::call_agent`] tool route through here, so the
/// nesting cap, sub-snapshot isolation (the sub-run never mutates the caller's live
/// snapshot / current run), rolling-summary write-back, and untrusted framing live
/// exactly once. `max_turns` is clamped to [`MAX_SUB_AGENT_TURNS`].
pub(crate) async fn delegate(
    snapshot: &mut AppSnapshot,
    agent_ref: &str,
    query: &str,
    strategy: Option<String>,
    max_turns: Option<u32>,
) -> AppResult<String> {
    // Bound delegation depth so two agents that delegate to each other cannot
    // recurse forever. Held for the duration of the sub-run, released on drop.
    let _depth = DepthGuard::enter()?;

    // Resolve up front so an unknown name is a clean error result (never a panic)
    // before any loop work begins.
    let agent = resolve_agent(snapshot, agent_ref)?;

    let params = LoopParams {
        agent_id: Some(agent.id.clone()),
        strategy,
        max_turns: clamp_turns(max_turns),
    };
    let sub_snapshot = snapshot.clone().with_active_agent(agent.clone());
    let (final_answer, sub_memories) =
        run_sub_agent(sub_snapshot, query.to_string(), params).await?;

    // Persist the sub-agent's rolling summaries back into the caller's snapshot
    // (the sub-run mutated only its own clone).
    for memory in sub_memories {
        upsert_rolling_summary(
            &mut snapshot.agent_memories,
            &memory.agent_id,
            memory.rolling_summary,
        );
    }

    // The sub-agent's answer is UNTRUSTED DATA: hand it back verbatim as a tool
    // observation, clearly attributed, with no instruction-following implied.
    Ok(format!(
        "Sub-agent `{}` returned (untrusted observation):\n{final_answer}",
        agent.name
    ))
}

/// Clamp a caller-supplied per-invocation step budget to [`MAX_SUB_AGENT_TURNS`].
fn clamp_turns(max_turns: Option<u32>) -> Option<u32> {
    max_turns.map(|turns| turns.min(MAX_SUB_AGENT_TURNS))
}

/// Resolve a sub-agent by id or name (case-insensitive), preferring an exact id
/// match, then an exact name match. Returns a graceful error naming the unknown
/// reference (and never panics) when nothing matches.
fn resolve_agent(snapshot: &AppSnapshot, agent_ref: &str) -> AppResult<Agent> {
    let needle = agent_ref.trim();
    snapshot
        .agents
        .iter()
        .find(|agent| agent.id.eq_ignore_ascii_case(needle))
        .or_else(|| {
            snapshot
                .agents
                .iter()
                .find(|agent| agent.name.eq_ignore_ascii_case(needle))
        })
        .cloned()
        .ok_or_else(|| {
            format!("Unknown agent `{agent_ref}`. No agent with that id or name exists.")
        })
}

/// Run the resolved sub-agent's loop on `query` and extract its final answer text
/// plus any rolling summaries the sub-run updated. A run that produces no answer
/// yields a clear, non-panicking message.
async fn run_sub_agent(
    sub_snapshot: AppSnapshot,
    query: String,
    params: LoopParams,
) -> AppResult<(String, Vec<AgentMemory>)> {
    // The observer is a no-op: the sub-run's timeline is internal to this tool call
    // and is summarized by its final answer.
    let result = SessionRunner::new()
        .run_with_params_and_observer(sub_snapshot, query, params, |_run| {})
        .await?;

    let answer = result
        .current_run()
        .map(|run| run.final_answer.trim().to_string())
        .unwrap_or_default();

    let answer = if answer.is_empty() {
        "The sub-agent finished without producing a final answer.".to_string()
    } else {
        answer
    };
    Ok((answer, result.agent_memories))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Agent;
    use serde_json::json;

    fn snapshot_with_agents() -> AppSnapshot {
        let mut researcher = Agent::new(
            "Researcher",
            "Find and cite evidence on the web.",
            Vec::new(),
        );
        researcher.id = "researcher".to_string();
        let coder = Agent::new("Coder", "Write and test small programs.", Vec::new());
        AppSnapshot {
            agents: vec![researcher, coder],
            ..AppSnapshot::default()
        }
    }

    fn agent_tool(agent_id: &str) -> EngineTool {
        EngineTool::for_agent(
            ToolSpec {
                name: format!("agent_{agent_id}"),
                description: "Delegate to a peer agent.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": { "query": { "type": "string" } },
                    "required": ["query"]
                }),
            },
            agent_id.to_string(),
        )
    }

    #[test]
    fn resolve_agent_routes_by_id_and_name_case_insensitively() {
        let snapshot = snapshot_with_agents();
        assert_eq!(
            resolve_agent(&snapshot, "researcher")
                .expect("resolves by id")
                .name,
            "Researcher"
        );
        assert_eq!(
            resolve_agent(&snapshot, "CODER")
                .expect("resolves by name")
                .name,
            "Coder"
        );
    }

    #[test]
    fn resolve_agent_errors_gracefully_on_unknown_reference() {
        let snapshot = snapshot_with_agents();
        let error = resolve_agent(&snapshot, "nobody").expect_err("unknown agent is an error");
        assert!(error.contains("Unknown agent"));
        assert!(error.contains("nobody"));
    }

    #[test]
    fn clamp_turns_caps_an_oversized_budget() {
        assert_eq!(clamp_turns(Some(10_000)), Some(MAX_SUB_AGENT_TURNS));
        assert_eq!(clamp_turns(Some(5)), Some(5));
        assert_eq!(clamp_turns(None), None);
    }

    #[test]
    fn depth_guard_caps_nesting_and_rebalances_on_drop() {
        // Hold the cap-many levels live, then assert the next entry is refused.
        let mut held = Vec::new();
        for _ in 0..MAX_NESTING_DEPTH {
            held.push(DepthGuard::enter().expect("within the nesting cap"));
        }
        let error = DepthGuard::enter().expect_err("at the cap, a further entry is refused");
        assert!(error.contains("nesting limit"));

        // Dropping the held guards rebalances the counter so later calls succeed.
        drop(held);
        let _reentry = DepthGuard::enter().expect("counter is rebalanced after drop");
    }

    // The agent-as-tool surfaces sub-task failures as graceful errors (never a
    // panic) before any loop work: an empty query is rejected by argument
    // validation, and a non-object argument value is the same clean failure.
    #[test]
    fn call_rejects_empty_query_gracefully() {
        let mut snapshot = snapshot_with_agents();
        let tool = agent_tool("researcher");
        let error = pollster::block_on(tool.call(&mut snapshot, &json!({ "query": "   " })))
            .expect_err("empty query is rejected");
        assert!(error.contains("query"));
    }

    #[test]
    fn call_rejects_non_object_args_gracefully() {
        let mut snapshot = snapshot_with_agents();
        let tool = agent_tool("researcher");
        let result = pollster::block_on(tool.call(&mut snapshot, &json!("not an object")));
        assert!(result.is_err(), "missing query must fail cleanly");
    }
}
