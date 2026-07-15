//! Workflow-path steps (ADR-042): the deterministic, no-LLM phase kind.
//!
//! "Repeated paths become workflow-path code" — an agent author scripts a
//! `phase.N.tool` step that runs a fixed tool once with fixed args and
//! advances, so the LLM only drives the judgment phases. All of dispatch's
//! error-swallowing is reused (unknown tool / tool error / clamp become an
//! observation the NEXT phase reads), so a scripted step never throws into the
//! loop. Scripted steps run PURE (read-only) tools only.

use askk_core::{Effect, PhaseStep, ToolCall};
use serde_json::Value;

use crate::run::answer::finish_unverified;
use crate::run::dispatch::{dispatch_queued, Dispatch};
use crate::run::session::{RunState, Shared};
use crate::run::turn::{effective_allow, observe, Turn};
use crate::state::StoreError;

/// Run the current phase's scripted tool ONCE, then advance — no LLM call.
/// A mutating tool is refused as an observation rather than mutate without a
/// model or human in the loop.
pub(crate) async fn scripted_turn(shared: &Shared, run: &mut RunState) -> Result<Turn, StoreError> {
    let phase = run.phases[run.phase_idx].clone();
    let PhaseStep::Tool { tool: name, args } = &phase.step else {
        return Ok(Turn::Continue); // unreachable: only Tool phases route here
    };
    // Effect check before dispatch: a mutating scripted tool is refused (no
    // unconfirmed mutation from author-scripted code). Pure and unknown tools
    // fall through to dispatch, which owns the unknown-tool observation.
    let effect = effective_allow(run)
        .iter()
        .any(|t| t == name)
        .then(|| shared.registry.get(name).map(|t| t.spec().effect))
        .flatten();
    if effect == Some(Effect::Mutating) {
        observe(
            shared,
            run,
            format!(
                "scripted step '{name}' is a mutating tool; workflow-path steps run \
                 read-only tools only — skipped (use an LLM phase for mutating actions)"
            ),
        )
        .await?;
    } else {
        let call = ToolCall {
            id: format!("{}-call-{}", run.id.0, run.call_seq),
            name: name.clone(),
            args: substitute_goal(args, &run.goal),
        };
        run.call_seq += 1;
        run.queued_calls = vec![call];
        if dispatch_queued(shared, run).await? == Dispatch::Paused {
            // Pure tools never park a confirmation, so this is unreachable —
            // but if it ever does, do NOT advance (re-drive resumes the same
            // phase after the resolution).
            return Ok(Turn::Paused);
        }
    }
    // Advance like handle_answer's Advance branch: a scripted step is not a
    // gate, so running off the end ends the run Unverified (ADR-008).
    run.phase_idx += 1;
    if run.phase_idx >= run.phases.len() {
        finish_unverified(shared, run, String::new()).await?;
        return Ok(Turn::Terminal);
    }
    run.phase_entered = false;
    Ok(Turn::Continue)
}

/// v1 workflow-path templating: replace the literal `{goal}` inside every
/// string leaf of the scripted args with the run goal. ponytail: only `{goal}`
/// today — extend to prior-phase artifacts when a workflow actually needs it.
fn substitute_goal(args: &Value, goal: &str) -> Value {
    match args {
        Value::String(s) => Value::String(s.replace("{goal}", goal)),
        Value::Array(a) => Value::Array(a.iter().map(|v| substitute_goal(v, goal)).collect()),
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, v)| (k.clone(), substitute_goal(v, goal)))
                .collect(),
        ),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn substitute_goal_replaces_nested_string_leaves() {
        let args = serde_json::json!({
            "query": "{goal}",
            "opts": {"q": "about {goal}", "n": 3},
            "tags": ["{goal}", "static"],
        });
        let out = substitute_goal(&args, "world cup");
        assert_eq!(out["query"], "world cup");
        assert_eq!(out["opts"]["q"], "about world cup");
        assert_eq!(out["opts"]["n"], 3);
        assert_eq!(out["tags"][0], "world cup");
        assert_eq!(out["tags"][1], "static");
    }
}
