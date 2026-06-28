//! The team driver: the async glue that runs a team pipeline to completion. It owns
//! the loop that asks the [`TeamPipeline`] which member runs next, runs it (via an
//! injected `run_member` step), updates that member's status/progress on the
//! [`Supervisor`], threads each member's output forward as context for the next, and
//! folds the gate's verdict back into the pipeline (bouncing to the first member on a
//! revise, until the retry budget is spent).
//!
//! The actual model call is injected as `run_member` rather than hardcoded here, so
//! the whole coordination flow — context handoff, status transitions, inbox folding,
//! bounce-back — is host-testable with a scripted fake. The real caller (the
//! `delegate_team` tool) passes a `run_member` that drives the engine's
//! [`crate::engine::SessionRunner`] for one member and shares the single workspace.

use std::cell::RefCell;
use std::future::Future;
use std::pin::Pin;

use super::pipeline::{PipelineOutcome, TeamPipeline, Verdict, classify_verdict};
use super::status::AgentStatus;
use super::{Message, Supervisor};

/// How a team run ended.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TeamOutcome {
    /// The gate accepted; `answer` is the final member's output.
    Done { answer: String },
    /// The gate kept rejecting until the retry budget ran out; `last` is the most
    /// recent gate output explaining what still fails.
    Exhausted { last: String },
    /// A member's run errored (never a panic); `error` describes it.
    Failed { error: String },
}

impl TeamOutcome {
    /// The text to hand back to the orchestrator as the team's (untrusted) result.
    pub fn into_observation(self, team_id: &str) -> String {
        match self {
            TeamOutcome::Done { answer } => {
                format!("Team `{team_id}` completed (untrusted observation):\n{answer}")
            }
            TeamOutcome::Exhausted { last } => format!(
                "Team `{team_id}` did not pass verification within its retry budget (untrusted observation). Last verifier output:\n{last}"
            ),
            TeamOutcome::Failed { error } => {
                format!("Team `{team_id}` failed to run: {error}")
            }
        }
    }
}

/// The step that runs ONE member's loop: given `(agent_id, member_goal)`, produce
/// the member's final answer (or an error string). Boxed so callers can capture the
/// engine without threading generics through the driver.
pub type RunMember<'a> =
    dyn FnMut(String, String) -> Pin<Box<dyn Future<Output = Result<String, String>> + 'a>> + 'a;

/// Compose the goal handed to a member: the original team goal, the running context
/// (prior members' outputs and any bounce feedback), and any messages addressed to
/// this member via its inbox. Sections are only included when non-empty so a
/// first-pass planner sees a clean goal.
fn compose_member_goal(goal: &str, context: &str, inbox: &[Message]) -> String {
    let mut composed = goal.trim().to_string();

    if !context.trim().is_empty() {
        composed.push_str("\n\n## Team context so far\n");
        composed.push_str(context.trim());
    }

    if !inbox.is_empty() {
        composed.push_str("\n\n## Messages addressed to you\n");
        for message in inbox {
            composed.push_str(&format!("- from {}: {}\n", message.from, message.body));
        }
    }

    composed
}

/// Drive `pipeline` to completion, running each member through `run_member` and
/// recording coordination state on `supervisor`. Returns the team's [`TeamOutcome`].
///
/// `supervisor` is shared via a [`RefCell`] rather than borrowed exclusively so that
/// a member's own tool calls (e.g. `agent_send`/`agent_progress`) can reach the SAME
/// live supervisor while that member runs. The driver only ever borrows it briefly
/// between awaits — never across the `run_member` await — so those re-entrant borrows
/// never overlap.
///
/// Members share one workspace (the caller's `run_member` clones from a common base
/// snapshot, and the workspace filesystem is an external singleton), so a later
/// member sees the files an earlier member wrote. Logical handoff — the planner's
/// work target, the coder's summary — travels through the accumulated `context`.
pub async fn run_team(
    supervisor: &RefCell<Supervisor>,
    pipeline: &mut TeamPipeline,
    goal: &str,
    run_member: &mut RunMember<'_>,
) -> TeamOutcome {
    let mut context = String::new();
    let mut last_output = String::new();

    while let Some(member_id) = pipeline.next_member().map(str::to_string) {
        let is_gate = pipeline.current_is_gate();
        let (phase, inbox) = {
            let mut sup = supervisor.borrow_mut();
            let phase = sup
                .instance(&member_id)
                .map(|instance| instance.role.clone())
                .unwrap_or_else(|| member_id.clone());
            let inbox = sup.drain_inbox(&member_id);
            (phase, inbox)
        };
        let member_goal = compose_member_goal(goal, &context, &inbox);

        {
            let mut sup = supervisor.borrow_mut();
            sup.set_status(
                &member_id,
                AgentStatus::Running {
                    turn: 0,
                    phase: phase.clone(),
                },
            );
            sup.note_progress(&member_id, format!("started ({phase})"));
        }

        let answer = match run_member(member_id.clone(), member_goal).await {
            Ok(answer) => answer,
            Err(error) => {
                supervisor.borrow_mut().set_status(
                    &member_id,
                    AgentStatus::Failed {
                        error: error.clone(),
                    },
                );
                return TeamOutcome::Failed { error };
            }
        };

        supervisor
            .borrow_mut()
            .note_progress(&member_id, "produced output");
        last_output = answer.clone();

        // Thread this member's output forward as context for the next member.
        context.push_str(&format!("\n### {phase} ({member_id})\n{}\n", answer.trim()));

        let verdict = if is_gate {
            classify_verdict(&answer)
        } else {
            Verdict::Pass
        };

        match pipeline.advance(verdict) {
            PipelineOutcome::Continue => {
                supervisor.borrow_mut().set_status(
                    &member_id,
                    AgentStatus::Done {
                        answer: answer.clone(),
                    },
                );
            }
            PipelineOutcome::Done => {
                supervisor.borrow_mut().set_status(
                    &member_id,
                    AgentStatus::Done {
                        answer: answer.clone(),
                    },
                );
                return TeamOutcome::Done { answer };
            }
            PipelineOutcome::Bounced => {
                // Gate rejected: feedback re-enters as context and earlier members
                // are re-queued for another pass.
                supervisor.borrow_mut().set_status(
                    &member_id,
                    AgentStatus::Blocked {
                        reason: "verification failed; bouncing back".to_string(),
                    },
                );
                context.push_str(&format!(
                    "\n### verification feedback (pass {})\n{}\n",
                    pipeline.retries(),
                    answer.trim()
                ));
                requeue_pending(supervisor, pipeline);
            }
            PipelineOutcome::Exhausted => {
                supervisor.borrow_mut().set_status(
                    &member_id,
                    AgentStatus::Failed {
                        error: "verification budget exhausted".to_string(),
                    },
                );
                return TeamOutcome::Exhausted { last: answer };
            }
        }
    }

    // Pipeline drained without a gate verdict (e.g. an empty team): surface the last
    // output as the result.
    TeamOutcome::Done { answer: last_output }
}

/// Reset every member to `Queued` after a bounce so the roster reflects that the
/// pipeline restarted from the top.
fn requeue_pending(supervisor: &RefCell<Supervisor>, pipeline: &TeamPipeline) {
    let mut sup = supervisor.borrow_mut();
    for member_id in pipeline.members() {
        sup.set_status(member_id, AgentStatus::Queued);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{Agent, agent_from_markdown};
    use std::cell::RefCell;

    fn coder_agents() -> Vec<Agent> {
        vec![
            agent_from_markdown("agents/coder/1_planner.md", "---\n---\nPlan.").unwrap(),
            agent_from_markdown("agents/coder/2_coder.md", "---\n---\nWrite code.").unwrap(),
            agent_from_markdown("agents/coder/3_verifier.md", "---\n---\nVerify.").unwrap(),
        ]
    }

    fn spawned() -> (RefCell<Supervisor>, TeamPipeline) {
        let agents = coder_agents();
        let mut supervisor = Supervisor::new();
        let members = supervisor.spawn_team(&agents, "coder").unwrap();
        let pipeline = TeamPipeline::new(members, 2);
        (RefCell::new(supervisor), pipeline)
    }

    #[test]
    fn compose_goal_includes_context_and_inbox_only_when_present() {
        let bare = compose_member_goal("do x", "", &[]);
        assert_eq!(bare, "do x");

        let full = compose_member_goal(
            "do x",
            "prior output",
            &[Message::new("orchestrator", "hint")],
        );
        assert!(full.contains("## Team context so far"));
        assert!(full.contains("prior output"));
        assert!(full.contains("## Messages addressed to you"));
        assert!(full.contains("from orchestrator: hint"));
    }

    #[test]
    fn happy_path_runs_members_in_order_and_completes() {
        let (supervisor, mut pipeline) = spawned();
        let seen = RefCell::new(Vec::<String>::new());

        let mut run_member = |id: String, _goal: String| {
            seen.borrow_mut().push(id.clone());
            let answer = if id == "coder-verifier" {
                "PASS — build green".to_string()
            } else {
                format!("{id} output")
            };
            Box::pin(async move { Ok(answer) })
                as Pin<Box<dyn Future<Output = Result<String, String>>>>
        };

        let outcome = pollster::block_on(run_team(
            &supervisor,
            &mut pipeline,
            "build a feature",
            &mut run_member,
        ));

        assert_eq!(
            *seen.borrow(),
            vec!["coder-planner", "coder-coder", "coder-verifier"]
        );
        assert!(matches!(outcome, TeamOutcome::Done { .. }));
        assert_eq!(
            supervisor.borrow().progress_of("coder-verifier").cloned(),
            Some(AgentStatus::Done {
                answer: "PASS — build green".to_string()
            })
        );
    }

    #[test]
    fn context_from_earlier_members_reaches_later_members() {
        let (supervisor, mut pipeline) = spawned();
        let coder_goal = RefCell::new(String::new());

        let mut run_member = |id: String, goal: String| {
            if id == "coder-coder" {
                *coder_goal.borrow_mut() = goal;
            }
            let answer = if id == "coder-verifier" {
                "PASS".to_string()
            } else {
                format!("{id}: did the work")
            };
            Box::pin(async move { Ok(answer) })
                as Pin<Box<dyn Future<Output = Result<String, String>>>>
        };

        pollster::block_on(run_team(
            &supervisor,
            &mut pipeline,
            "goal",
            &mut run_member,
        ));

        // The coder's goal carried the planner's output as team context.
        let goal = coder_goal.borrow();
        assert!(goal.contains("## Team context so far"));
        assert!(goal.contains("coder-planner: did the work"));
    }

    #[test]
    fn revise_then_pass_bounces_and_eventually_completes() {
        let (supervisor, mut pipeline) = spawned();
        let verifier_calls = RefCell::new(0u32);

        let mut run_member = |id: String, _goal: String| {
            let answer = if id == "coder-verifier" {
                let mut calls = verifier_calls.borrow_mut();
                *calls += 1;
                if *calls == 1 {
                    "REVISE: tests fail in src/x.rs".to_string()
                } else {
                    "PASS".to_string()
                }
            } else {
                format!("{id} output")
            };
            Box::pin(async move { Ok(answer) })
                as Pin<Box<dyn Future<Output = Result<String, String>>>>
        };

        let outcome = pollster::block_on(run_team(
            &supervisor,
            &mut pipeline,
            "goal",
            &mut run_member,
        ));

        assert!(matches!(outcome, TeamOutcome::Done { .. }));
        assert_eq!(*verifier_calls.borrow(), 2);
        assert_eq!(pipeline.retries(), 1);
    }

    #[test]
    fn persistent_failure_exhausts_budget() {
        let (supervisor, mut pipeline) = spawned();
        let mut run_member = |id: String, _goal: String| {
            let answer = if id == "coder-verifier" {
                "REVISE: still broken".to_string()
            } else {
                format!("{id} output")
            };
            Box::pin(async move { Ok(answer) })
                as Pin<Box<dyn Future<Output = Result<String, String>>>>
        };

        let outcome = pollster::block_on(run_team(
            &supervisor,
            &mut pipeline,
            "goal",
            &mut run_member,
        ));

        assert!(matches!(outcome, TeamOutcome::Exhausted { .. }));
    }

    #[test]
    fn member_error_aborts_with_failed_outcome() {
        let (supervisor, mut pipeline) = spawned();
        let mut run_member = |id: String, _goal: String| {
            let result = if id == "coder-coder" {
                Err("run_command bridge offline".to_string())
            } else {
                Ok(format!("{id} output"))
            };
            Box::pin(async move { result })
                as Pin<Box<dyn Future<Output = Result<String, String>>>>
        };

        let outcome = pollster::block_on(run_team(
            &supervisor,
            &mut pipeline,
            "goal",
            &mut run_member,
        ));

        assert!(matches!(outcome, TeamOutcome::Failed { .. }));
        assert!(matches!(
            supervisor.borrow().progress_of("coder-coder"),
            Some(AgentStatus::Failed { .. })
        ));
    }
}
