use super::save_snapshot;
use super::shared::{CompactList, StatBlock, set_status};
use crate::engine::{ReActEngine, clear_interrupt};
use crate::state::AppSnapshot;
use dioxus::prelude::*;
use wasm_bindgen_futures::spawn_local;

#[component]
pub fn InspectorPanel(snapshot: Signal<AppSnapshot>) -> Element {
    let current = snapshot.read().clone();

    rsx! {
        section { class: "panel page-panel inspector-panel",
            h2 { "State Inspector" }
            div { class: "stats-grid",
                StatBlock { label: "Agents", value: current.agents.len().to_string() }
                StatBlock { label: "Profiles", value: current.provider_profiles.len().to_string() }
                StatBlock { label: "Memories", value: current.memories.len().to_string() }
                StatBlock { label: "Tasks", value: current.tasks.len().to_string() }
                StatBlock { label: "Jobs", value: current.jobs.len().to_string() }
                StatBlock { label: "Runs", value: current.runs.len().to_string() }
            }
            h3 { "Current Run" }
            CompactList {
                items: current.current_run.as_ref()
                    .map(|run| {
                        vec![
                            format!("Lane: {}", run.lane.as_label()),
                            format!("Status: {}", run.status),
                            format!("Meta-tools: {}", run.scratchpad.meta_tool_calls.len()),
                            format!("Workers: {}", run.scratchpad.workers.len()),
                            format!(
                                "Steps: {}/{}",
                                run.scratchpad.budgets.steps_used,
                                run.scratchpad.budgets.max_steps
                            ),
                            format!("Verification: {}", run.scratchpad.verification.status),
                        ]
                    })
                    .unwrap_or_else(|| vec!["No current run.".to_string()])
            }
            h3 { "Orchestrator Config" }
            CompactList {
                items: vec![
                    format!("Routing profile: {}", current.orchestrator.routing_provider_profile_id.clone().unwrap_or_else(|| "active provider".to_string())),
                    format!("Worker profile: {}", current.orchestrator.worker_provider_profile_id.clone().unwrap_or_else(|| "active provider".to_string())),
                    format!("Max steps: {}", current.orchestrator.max_steps),
                    format!("Verification retries: {}", current.orchestrator.verification_retries),
                    format!("No-progress turns: {}", current.orchestrator.no_progress_turns),
                    format!("Max parallelism: {}", current.orchestrator.max_parallelism),
                ]
            }
            h3 { "Orchestrator Meta-tools" }
            CompactList {
                items: current.current_run.as_ref()
                    .map(|run| run.scratchpad.meta_tool_calls.iter().map(|call| {
                        format!("{} -> {}", call.name, call.result)
                    }).collect::<Vec<_>>())
                    .unwrap_or_default()
            }
            h3 { "Workers" }
            CompactList {
                items: current.current_run.as_ref()
                    .map(|run| run.scratchpad.workers.iter().map(|worker| {
                        format!("{} [{}] -> {}", worker.role, worker.status, worker.sub_goal)
                    }).collect::<Vec<_>>())
                    .unwrap_or_default()
            }
            h3 { "Background Jobs" }
            if current.jobs.is_empty() {
                CompactList { items: vec!["No background jobs.".to_string()] }
            } else {
                div { class: "job-list",
                    for job in current.jobs.iter() {
                        article { class: "event-row job-row", key: "{job.id}",
                            div { class: "event-meta",
                                span { "{job.status}" }
                                span { "{job.updated_at}" }
                            }
                            h3 { "{job.goal}" }
                            p { class: "muted", "{job.progress}" }
                            p { class: "muted", "Job {job.id}" }
                            if is_resumable_job(&job.status) {
                                button {
                                    class: "ghost-button",
                                    onclick: {
                                        let job_id = job.id.clone();
                                        move |_| resume_background_job(snapshot, job_id.clone())
                                    },
                                    "Resume"
                                }
                            }
                        }
                    }
                }
            }
            h3 { "Provider Profiles" }
            CompactList {
                items: current.provider_profiles
                    .iter()
                    .map(|profile| format!("{} -> {}", profile.name, profile.config.model))
                    .collect::<Vec<_>>()
            }
            h3 { "Memories" }
            CompactList { items: current.memories.iter().map(|item| item.content.clone()).collect::<Vec<_>>() }
            h3 { "Tasks" }
            CompactList {
                items: current.tasks.iter().map(|task| format!("{} [{}]", task.title, task.status)).collect::<Vec<_>>()
            }
            h3 { "Recent Tool Calls" }
            CompactList {
                items: current.current_run.as_ref()
                    .map(|run| run.tool_calls.iter().map(|call| format!("{} {}", call.tool_name, call.arguments)).collect::<Vec<_>>())
                    .unwrap_or_default()
            }
        }
    }
}

fn is_resumable_job(status: &str) -> bool {
    matches!(status, "paused" | "failed" | "blocked")
}

fn resume_background_job(mut snapshot: Signal<AppSnapshot>, job_id: String) {
    let start_data = snapshot.read().clone();
    clear_interrupt();
    set_status(
        &mut snapshot,
        format!("Resuming background job {job_id}..."),
    );

    spawn_local(async move {
        let runtime = ReActEngine::new();
        let mut live_snapshot = snapshot;
        let mut final_snapshot = snapshot;
        let result = runtime
            .resume_job_with_observer(start_data, job_id.clone(), move |run| {
                let mut next = live_snapshot.read().clone();
                next.status = format!("Resuming {} lane...", run.lane.as_label());
                next.current_run = Some(run);
                live_snapshot.set(next);
            })
            .await;

        match result {
            Ok(next) => {
                let run_status = next.status.clone();
                let save_status = save_snapshot(next.clone()).await;
                final_snapshot.set(next);
                set_status(&mut final_snapshot, format!("{run_status}. {save_status}"));
            }
            Err(err) => {
                set_status(&mut final_snapshot, format!("Resume failed: {err}"));
            }
        }
    });
}
