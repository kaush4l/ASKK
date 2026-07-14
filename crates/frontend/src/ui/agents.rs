//! Agents stage (kiln `agentsStage`): the run-card forest — every run in
//! the fold, newest first, with agent name, status dot, goal, turns used,
//! and its tool rows (tool name + truncated observation). Flat list: our
//! `RunStarted` carries no parent id, so delegation edges are not drawn.

use dioxus::prelude::*;

use askk_core::{Role, RunId, RunProjection, RunStatus};

pub(crate) fn status_class(status: RunStatus) -> &'static str {
    match status {
        RunStatus::Running => "a-dot s-running",
        RunStatus::Answered => "a-dot s-done",
        RunStatus::Failed => "a-dot s-error",
        RunStatus::Interrupted => "a-dot s-aborted",
        RunStatus::Unverified | RunStatus::BudgetExhausted => "a-dot",
    }
}

pub(crate) fn status_label(status: RunStatus) -> &'static str {
    match status {
        RunStatus::Running => "running",
        RunStatus::Answered => "answered",
        RunStatus::Unverified => "unverified",
        RunStatus::BudgetExhausted => "budget exhausted",
        RunStatus::Interrupted => "interrupted",
        RunStatus::Failed => "failed",
    }
}

/// `"run started: coder — fix the bug"` → `("coder", "fix the bug")`;
/// `None` when the fold has no `RunStarted` line (callers pick a fallback).
pub(crate) fn agent_and_goal(proj: &RunProjection) -> Option<(String, String)> {
    proj.timeline
        .iter()
        .find_map(|line| line.strip_prefix("run started: "))
        .and_then(|rest| rest.split_once(" — "))
        .map(|(agent, goal)| (agent.to_string(), goal.to_string()))
}

/// Tool rows: each `tool requested` timeline entry paired (by order) with
/// its Tool-role observation, truncated kiln-style at 200 chars.
fn tool_rows(proj: &RunProjection) -> Vec<(String, String)> {
    let names = proj.timeline.iter().filter_map(|line| {
        let rest = line.strip_prefix("tool requested: ")?;
        Some(rest.split(" (").next().unwrap_or(rest).to_string())
    });
    let mut observations = proj
        .messages
        .iter()
        .filter(|m| m.role == Role::Tool)
        .map(|m| m.content.chars().take(200).collect::<String>());
    names
        .map(|name| (name, observations.next().unwrap_or_default()))
        .collect()
}

#[component]
pub fn AgentsStage(runs: Vec<(RunId, RunProjection)>) -> Element {
    rsx! {
        div { class: "agents-wrap",
            div { class: "settings-title", "Agents" }
            if runs.is_empty() {
                p { class: "hint",
                    "no runs yet — send a message in Chat. Every run traces its loop, tool calls, and state here."
                }
            }
            div { class: "tree",
                for (run_id, proj) in runs.iter() {
                    {
                        let (agent, goal) = agent_and_goal(proj)
                            .unwrap_or_else(|| ("agent".into(), String::new()));
                        let rows = tool_rows(proj);
                        rsx! {
                            div { key: "{run_id.0}", class: "run-card",
                                div { class: "run-head",
                                    span { class: "{status_class(proj.status)}" }
                                    span { class: "run-name", "{agent}" }
                                    span { class: "run-state", "{status_label(proj.status)}" }
                                    span { class: "run-ms", "{proj.turns_used} turns" }
                                }
                                if !goal.is_empty() {
                                    div { class: "run-goal", "{goal}" }
                                }
                                div { class: "run-loop",
                                    if rows.is_empty() {
                                        span { class: "loop-empty", "no tool calls yet" }
                                    }
                                    for (i, (tool, obs)) in rows.iter().enumerate() {
                                        div { key: "{i}", class: "step",
                                            span { class: "step-name", "act" }
                                            span { class: "step-tool", "{tool}" }
                                            if !obs.is_empty() {
                                                div { class: "step-obs", "{obs}" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use askk_core::Message;

    #[test]
    fn header_and_tool_rows_parse_from_the_fold() {
        let proj = RunProjection {
            timeline: vec![
                "run started: coder — fix the bug".into(),
                "tool requested: echo (c1)".into(),
                "tool completed (c1): ok=true".into(),
            ],
            messages: vec![Message::new(Role::Tool, "observation text")],
            ..Default::default()
        };
        assert_eq!(
            agent_and_goal(&proj),
            Some(("coder".into(), "fix the bug".into()))
        );
        assert_eq!(agent_and_goal(&RunProjection::default()), None);
        assert_eq!(
            tool_rows(&proj),
            vec![("echo".into(), "observation text".into())]
        );
        assert_eq!(status_class(RunStatus::Answered), "a-dot s-done");
    }
}
