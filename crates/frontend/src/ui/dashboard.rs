//! Dashboard stage: the wall display. One glanceable view of ALL live agent
//! work — foreign tabs' runs arrive through the shared signal mirror, so a
//! second tab opened at `#/Dashboard` is a passive command-center screen.
//! Pure data component (askk-core types only, ADR-013): `app.rs` assembles
//! `DashRun`s from the host facade per refold; the one browser side effect
//! (pop-out tab) goes through `host::dom` like every other stage.

use dioxus::prelude::*;

use std::collections::BTreeMap;

use askk_core::{RunId, RunProjection, RunStatus};

use crate::ui::agents::{agent_and_goal, status_class, status_label};
use askk_browser::dom;

/// One run's wall data: the fold plus its live streaming tail.
#[derive(Clone, PartialEq)]
pub struct DashRun {
    pub id: RunId,
    pub proj: RunProjection,
    pub draft: String,
}

/// Agent + goal from the fold's `run started:` line; a foreign or partial
/// fold without one shows its run id instead.
fn tile_name(id: &RunId, proj: &RunProjection) -> (String, String) {
    agent_and_goal(proj).unwrap_or_else(|| (id.0.clone(), String::new()))
}

/// The latest named activity: the newest `phase:` or `tool requested:`
/// timeline entry, whichever happened last.
fn run_phase(proj: &RunProjection) -> String {
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

/// Last `max` chars of the streaming draft — the wall shows the tail, not
/// the whole answer.
fn draft_tail(draft: &str, max: usize) -> String {
    let trimmed = draft.trim_end();
    let count = trimmed.chars().count();
    if count <= max {
        return trimmed.to_string();
    }
    let tail: String = trimmed.chars().skip(count - max).collect();
    format!("…{tail}")
}

/// Session numerals: (runs, live, answered, tools completed, turns) —
/// all derived from projections, no extra plumbing.
fn totals(runs: &[DashRun]) -> (usize, usize, usize, usize, u32) {
    let live = runs
        .iter()
        .filter(|r| r.proj.status == RunStatus::Running)
        .count();
    let answered = runs
        .iter()
        .filter(|r| r.proj.status == RunStatus::Answered)
        .count();
    let tools = runs
        .iter()
        .flat_map(|r| r.proj.timeline.iter())
        .filter(|line| line.starts_with("tool completed"))
        .count();
    let turns = runs.iter().map(|r| r.proj.turns_used).sum();
    (runs.len(), live, answered, tools, turns)
}

/// Artifact names newest-first: runs arrive newest-first and appends within
/// a run are oldest-first, so each run's list flips.
fn recent_artifacts(runs: &[DashRun], max: usize) -> Vec<String> {
    runs.iter()
        .flat_map(|r| r.proj.artifacts.iter().rev().cloned())
        .take(max)
        .collect()
}

/// Tool-usage matrix across the session: tool name → how many times it was
/// requested, busiest first (ties broken by name). Parsed from the timelines'
/// `tool requested: <name> (<id>)` lines — no extra plumbing.
fn tool_activity(runs: &[DashRun]) -> Vec<(String, usize)> {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for line in runs.iter().flat_map(|r| r.proj.timeline.iter()) {
        if let Some(rest) = line.strip_prefix("tool requested: ") {
            let name = rest.split(" (").next().unwrap_or(rest).trim();
            if !name.is_empty() {
                *counts.entry(name.to_string()).or_default() += 1;
            }
        }
    }
    let mut rows: Vec<(String, usize)> = counts.into_iter().collect();
    rows.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    rows
}

#[component]
pub fn DashboardStage(runs: Vec<DashRun>) -> Element {
    let (n_runs, n_live, n_answered, n_tools, n_turns) = totals(&runs);
    let artifacts = recent_artifacts(&runs, 8);
    let tools_used = tool_activity(&runs);
    let quiet = runs.is_empty();
    let numerals = [
        (n_runs.to_string(), "runs", false),
        (n_live.to_string(), "live", true),
        (n_answered.to_string(), "answered", false),
        (n_tools.to_string(), "tools", false),
        (n_turns.to_string(), "turns", false),
    ];

    rsx! {
        div { class: "dash-wrap",
            div { class: "dash-head",
                div { class: "settings-title", "Dashboard" }
                span { class: "dash-live",
                    if n_live > 0 {
                        span { class: "a-dot s-running" }
                    }
                    "{n_live} live"
                }
                button {
                    class: "wall-btn",
                    title: "Open this dashboard full-screen in a new tab",
                    onclick: move |_| dom::open_tab("Dashboard"),
                    "Open wall display ↗"
                }
            }
            if quiet {
                div { class: "dash-quiet",
                    div { class: "dash-wordmark", "ASKK" }
                    div { class: "dash-quiet-sub", "all quiet — live agent work appears here" }
                }
            } else {
                div { class: "dash-nums",
                    for (value, label, live) in numerals {
                        div { key: "{label}", class: "dash-num-cell",
                            div { class: if live { "dash-num live" } else { "dash-num" }, "{value}" }
                            div { class: "dash-label", "{label}" }
                        }
                    }
                }
                div { class: "dash-label", "Active runs" }
                div { class: "dash-runs",
                    for r in runs.iter() {
                        {
                            let (agent, goal) = tile_name(&r.id, &r.proj);
                            let phase = run_phase(&r.proj);
                            let tail = draft_tail(&r.draft, 160);
                            let live = r.proj.status == RunStatus::Running;
                            rsx! {
                                div {
                                    key: "{r.id.0}",
                                    class: if live { "dash-run live" } else { "dash-run" },
                                    div { class: "dash-run-head",
                                        span { class: "{status_class(r.proj.status)}" }
                                        span { class: "dash-run-agent", "{agent}" }
                                        span { class: "run-state", "{status_label(r.proj.status)}" }
                                        span { class: "run-ms", "{r.proj.turns_used} turns" }
                                    }
                                    if !goal.is_empty() {
                                        div { class: "dash-run-goal", "{goal}" }
                                    }
                                    if !phase.is_empty() {
                                        div { class: "dash-run-phase", "{phase}" }
                                    }
                                    if live && !tail.is_empty() {
                                        div { class: "dash-run-tail", "{tail}" }
                                    }
                                }
                            }
                        }
                    }
                }
                div { class: "dash-row",
                    div { class: "dash-tile",
                        div { class: "dash-label", "Tool activity" }
                        if tools_used.is_empty() {
                            div { class: "hint", "no tools used yet" }
                        }
                        for (name, count) in tools_used.iter() {
                            div { key: "{name}", class: "dash-board-title",
                                span { class: "meta-tag", "{count}" }
                                span { class: "dash-board-text", "{name}" }
                            }
                        }
                    }
                    div { class: "dash-tile",
                        div { class: "dash-label", "Recent artifacts" }
                        if artifacts.is_empty() {
                            div { class: "hint", "none yet" }
                        }
                        for (i, name) in artifacts.iter().enumerate() {
                            div { key: "{i}", class: "dash-art", "{name}" }
                        }
                        if !artifacts.is_empty() {
                            div { class: "hint", "open in Artifacts" }
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

    fn run(id: &str, proj: RunProjection, draft: &str) -> DashRun {
        DashRun {
            id: RunId::new(id),
            proj,
            draft: draft.into(),
        }
    }

    #[test]
    fn tile_name_falls_back_to_the_run_id() {
        let named = RunProjection {
            timeline: vec!["run started: coder — fix the bug".into()],
            ..Default::default()
        };
        assert_eq!(
            tile_name(&RunId::new("r1"), &named),
            ("coder".into(), "fix the bug".into())
        );
        assert_eq!(
            tile_name(&RunId::new("r2"), &RunProjection::default()),
            ("r2".into(), String::new())
        );
    }

    #[test]
    fn run_phase_names_the_latest_activity() {
        let proj = RunProjection {
            timeline: vec![
                "run started: coder — fix".into(),
                "phase: plan".into(),
                "tool requested: shell (c1)".into(),
                "tool completed (c1): ok=true".into(),
            ],
            ..Default::default()
        };
        assert_eq!(run_phase(&proj), "shell"); // the tool came after the phase
        let planning = RunProjection {
            timeline: vec!["phase: plan".into()],
            ..Default::default()
        };
        assert_eq!(run_phase(&planning), "plan");
        assert_eq!(run_phase(&RunProjection::default()), "");
    }

    #[test]
    fn draft_tail_keeps_the_end() {
        assert_eq!(draft_tail("short", 10), "short");
        assert_eq!(draft_tail("abcdefghij", 4), "…ghij");
        assert_eq!(draft_tail("trailing ws  \n", 20), "trailing ws");
    }

    #[test]
    fn tool_activity_counts_requests_busiest_first() {
        let a = run(
            "r1",
            RunProjection {
                timeline: vec![
                    "tool requested: web_search (c1)".into(),
                    "tool requested: web_search (c2)".into(),
                    "tool requested: calc (c3)".into(),
                ],
                ..Default::default()
            },
            "",
        );
        let b = run(
            "r2",
            RunProjection {
                timeline: vec!["tool requested: calc (c4)".into()],
                ..Default::default()
            },
            "",
        );
        // web_search 2, calc 2 → tie broken by name; then no others.
        assert_eq!(
            tool_activity(&[a, b]),
            vec![("calc".into(), 2), ("web_search".into(), 2)]
        );
        assert_eq!(tool_activity(&[]), Vec::<(String, usize)>::new());
    }

    #[test]
    fn totals_and_artifacts_fold_across_runs() {
        let a = run(
            "r1",
            RunProjection {
                status: RunStatus::Running,
                timeline: vec![
                    "tool completed (c1): ok=true".into(),
                    "tool completed (c2): ok=false".into(),
                ],
                artifacts: vec!["old.rs".into(), "new.rs".into()],
                turns_used: 3,
                ..Default::default()
            },
            "",
        );
        let b = run(
            "r2",
            RunProjection {
                status: RunStatus::Answered,
                turns_used: 2,
                artifacts: vec!["b.md".into()],
                ..Default::default()
            },
            "",
        );
        let runs = [a, b];
        assert_eq!(totals(&runs), (2, 1, 1, 2, 5));
        // Newest run first, newest artifact within a run first.
        assert_eq!(recent_artifacts(&runs, 8), vec!["new.rs", "old.rs", "b.md"]);
        assert_eq!(recent_artifacts(&runs, 2), vec!["new.rs", "old.rs"]);
    }
}
