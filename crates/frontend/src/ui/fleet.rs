//! Fleet stage (ADR-042): launch, monitor, and cancel agents as individual
//! parallel loops. The engine already runs each `submit` as its own background
//! loop (per-run `drive_run`); this stage is the surface to start several at
//! once and watch them side by side. `on_launch` mirrors `app.rs::on_send`
//! (submit + drive), `on_cancel` targets one run via `cancel_run`.
//!
//! A launch grid (one card + goal input per agent) over a live-run grid that
//! reuses the dashboard's tile look. Reads only from props — the frontend owns
//! no web-sys; every browser reach lives in `askk_browser`.

use dioxus::prelude::*;

use askk_browser::boot::AgentCard;
use askk_core::{RunId, RunProjection};

use crate::ui::agents::{agent_and_goal, status_class, status_label};
use crate::ui::dashboard::DashRun;

// ponytail: duplicates dashboard.rs's private `run_phase`/`draft_tail`; those
// are not `pub(crate)` and this unit may only touch fleet.rs + main.css. Promote
// + share if a third caller ever appears.

/// The latest named activity: newest `phase:` or `tool requested:` line.
fn activity(proj: &RunProjection) -> String {
    proj.timeline
        .iter()
        .rev()
        .find_map(|line| {
            line.strip_prefix("phase: ")
                .map(str::to_string)
                .or_else(|| {
                    line.strip_prefix("tool requested: ")
                        .map(|rest| rest.split(" (").next().unwrap_or(rest).to_string())
                })
        })
        .unwrap_or_default()
}

/// Last `max` chars of the streaming draft — the tail, not the whole answer.
fn tail(draft: &str, max: usize) -> String {
    let trimmed = draft.trim_end();
    let count = trimmed.chars().count();
    if count <= max {
        return trimmed.to_string();
    }
    let end: String = trimmed.chars().skip(count - max).collect();
    format!("…{end}")
}

#[component]
pub fn FleetStage(
    agents: Vec<AgentCard>,
    runs: Vec<DashRun>,
    on_launch: EventHandler<(String, String)>,
    on_cancel: EventHandler<RunId>,
) -> Element {
    rsx! {
        div { class: "fleet-wrap",
            div { class: "settings-title", "Fleet" }
            p { class: "feat-sub",
                "Launch agents as individual parallel loops — start several, watch them run, "
                "cancel any. Each launch is its own background run (delegation still happens "
                "inside a run via the agent's tools)."
            }

            div { class: "dash-label", "Launch" }
            if agents.is_empty() {
                p { class: "hint", "no agents configured" }
            }
            div { class: "feat-grid",
                for agent in agents.iter() {
                    LaunchCard { key: "{agent.id}", agent: agent.clone(), on_launch }
                }
            }

            div { class: "dash-label", "Live runs" }
            if runs.is_empty() {
                p { class: "hint",
                    "nothing running yet — launch an agent above and its loop appears here."
                }
            }
            div { class: "dash-runs",
                for r in runs.iter() {
                    RunCard { key: "{r.id.0}", run: r.clone(), on_cancel }
                }
            }
        }
    }
}

/// One agent's launch tile: name, description, a goal input, and a Launch button
/// that fires `on_launch` with (agent id, goal) and clears the field.
#[component]
fn LaunchCard(agent: AgentCard, on_launch: EventHandler<(String, String)>) -> Element {
    let mut goal = use_signal(String::new);
    let id = agent.id.clone();
    rsx! {
        div { class: "feat-card",
            div { class: "feat-card-title", "{agent.name}" }
            if !agent.description.is_empty() {
                div { class: "hint", "{agent.description}" }
            }
            input {
                class: "field",
                placeholder: "goal for this agent…",
                value: "{goal}",
                oninput: move |e| goal.set(e.value()),
            }
            button {
                class: "preset",
                onclick: move |_| {
                    let g = goal().trim().to_string();
                    if g.is_empty() {
                        return;
                    }
                    on_launch.call((id.clone(), g));
                    goal.set(String::new());
                },
                "Launch"
            }
        }
    }
}

/// One live run: agent + goal header, status, latest activity, streaming tail,
/// and a Cancel button while it is still running.
#[component]
fn RunCard(run: DashRun, on_cancel: EventHandler<RunId>) -> Element {
    let (agent, goal) =
        agent_and_goal(&run.proj).unwrap_or_else(|| (run.id.0.clone(), String::new()));
    let act = activity(&run.proj);
    let end = tail(&run.draft, 160);
    let live = !run.proj.status.is_terminal();
    let id = run.id.clone();
    rsx! {
        div { class: if live { "dash-run live" } else { "dash-run" },
            div { class: "dash-run-head",
                span { class: "{status_class(run.proj.status)}" }
                span { class: "dash-run-agent", "{agent}" }
                span { class: "run-state", "{status_label(run.proj.status)}" }
                span { class: "run-ms", "{run.proj.turns_used} turns" }
            }
            if !goal.is_empty() {
                div { class: "dash-run-goal", "{goal}" }
            }
            if !act.is_empty() {
                div { class: "dash-run-phase", "{act}" }
            }
            if live && !end.is_empty() {
                div { class: "dash-run-tail", "{end}" }
            }
            if live {
                button {
                    class: "preset fleet-cancel",
                    onclick: move |_| on_cancel.call(id.clone()),
                    "Cancel"
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activity_names_the_latest_phase_or_tool() {
        let proj = RunProjection {
            timeline: vec![
                "run started: coder — fix".into(),
                "phase: plan".into(),
                "tool requested: shell (c1)".into(),
            ],
            ..Default::default()
        };
        assert_eq!(activity(&proj), "shell");
        let planning = RunProjection {
            timeline: vec!["phase: plan".into()],
            ..Default::default()
        };
        assert_eq!(activity(&planning), "plan");
        assert_eq!(activity(&RunProjection::default()), "");
    }

    #[test]
    fn tail_keeps_the_end() {
        assert_eq!(tail("short", 10), "short");
        assert_eq!(tail("abcdefghij", 4), "…ghij");
        assert_eq!(tail("trailing ws  \n", 20), "trailing ws");
    }
}
