use super::save_snapshot;
use super::shared::{CompactList, StatBlock, set_status};
use crate::components::ui::{Badge, Button, SectionHeading};
use crate::engine::SessionRunner;
use crate::state::{AppSnapshot, RunId, RunStatus};
use dioxus::prelude::*;
use wasm_bindgen_futures::spawn_local;

const EDITORS_CSS: Asset = asset!("/assets/pages/editors.css");

#[component]
pub fn InspectorPanel(snapshot: Signal<AppSnapshot>) -> Element {
    let current = snapshot.read().clone();

    // Which fleet instance the inspector is viewing. `None` tracks the active
    // instance (the default), so a freshly-started or single-run fleet needs no
    // selection. A user-picked id pins one instance until it leaves the fleet.
    let mut selected_id = use_signal(|| None::<RunId>);

    // Resolve the instance to show: the pinned selection if it still exists, else
    // the active instance. Read-only — the inspector never mutates the fleet.
    let instances = current.instances();
    let selected_instance = selected_id
        .read()
        .as_ref()
        .and_then(|id| instances.get(id))
        .or_else(|| instances.active());
    let selected_run = selected_instance.map(|instance| &instance.projection);
    let selected_instance_id = selected_instance.map(|instance| instance.id.clone());
    let active_id = instances.active().map(|instance| instance.id.clone());

    rsx! {
        document::Stylesheet { href: EDITORS_CSS }
        section { class: "panel page-panel inspector-panel",
            h2 { "State Inspector" }
            div { class: "stats-grid",
                StatBlock { label: "Agents", value: current.agents.len().to_string() }
                StatBlock { label: "Profiles", value: current.provider_profiles.len().to_string() }
                StatBlock { label: "Memories", value: current.memories.len().to_string() }
                StatBlock { label: "Tasks", value: current.tasks.len().to_string() }
                StatBlock { label: "Jobs", value: current.jobs.len().to_string() }
                StatBlock { label: "Instances", value: instances.len().to_string() }
            }
            SectionHeading { title: "Fleet" }
            if instances.is_empty() {
                CompactList { items: vec!["No engine instances.".to_string()] }
            } else {
                div { class: "inspector-rows",
                    for instance in instances.iter() {
                        article {
                            class: "inspector-row",
                            key: "{instance.id}",
                            div { class: "inspector-row-head",
                                Badge { tone: "neutral", "{instance.status}" }
                                if Some(&instance.id) == active_id.as_ref() {
                                    Badge { tone: "info", "active" }
                                }
                            }
                            h3 { "{instance.projection.goal}" }
                            p { class: "muted", "Instance {instance.id}" }
                            Button {
                                variant: "ghost",
                                disabled: Some(&instance.id) == selected_instance_id.as_ref(),
                                onclick: {
                                    let id = instance.id.clone();
                                    move |_| selected_id.set(Some(id.clone()))
                                },
                                "View"
                            }
                        }
                    }
                }
            }
            SectionHeading { title: "Selected Run" }
            CompactList {
                items: selected_run
                    .map(|run| {
                        vec![
                            format!("Id: {}", run.id),
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
            SectionHeading { title: "Run limits" }
            CompactList {
                items: vec![
                    format!("Max steps: {}", current.orchestrator.max_steps),
                    format!("Max parallel agents: {}", current.orchestrator.max_parallelism),
                    format!("Verification retries: {}", current.orchestrator.verification_retries),
                ]
            }
            SectionHeading { title: "Orchestrator Meta-tools" }
            CompactList {
                items: selected_run
                    .map(|run| run.scratchpad.meta_tool_calls.iter().map(|call| {
                        format!("{} -> {}", call.name, call.result)
                    }).collect::<Vec<_>>())
                    .unwrap_or_default()
            }
            SectionHeading { title: "Workers" }
            CompactList {
                items: selected_run
                    .map(|run| run.scratchpad.workers.iter().map(|worker| {
                        format!("{} [{}] -> {}", worker.role, worker.status, worker.sub_goal)
                    }).collect::<Vec<_>>())
                    .unwrap_or_default()
            }
            SectionHeading { title: "Background Jobs" }
            if current.jobs.is_empty() {
                CompactList { items: vec!["No background jobs.".to_string()] }
            } else {
                div { class: "inspector-rows",
                    for job in current.jobs.iter() {
                        article { class: "inspector-row", key: "{job.id}",
                            div { class: "inspector-row-head",
                                Badge { tone: "neutral", "{job.status}" }
                                span { class: "muted", "{job.updated_at}" }
                            }
                            h3 { "{job.goal}" }
                            p { class: "muted", "{job.progress}" }
                            p { class: "muted", "Job {job.id}" }
                            if is_resumable_job(job.status) {
                                Button {
                                    variant: "secondary",
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
            SectionHeading { title: "Connections" }
            CompactList {
                items: current.provider_profiles
                    .iter()
                    .map(|profile| format!("{} -> {}", profile.name, profile.config.model))
                    .collect::<Vec<_>>()
            }
            SectionHeading { title: "Memories" }
            CompactList { items: current.memories.iter().map(|item| item.content.clone()).collect::<Vec<_>>() }
            SectionHeading { title: "Tasks" }
            CompactList {
                items: current.tasks.iter().map(|task| format!("{} [{}]", task.title, task.status)).collect::<Vec<_>>()
            }
            SectionHeading { title: "Recent Tool Calls" }
            CompactList {
                items: selected_run
                    .map(|run| run.tool_calls.iter().map(|call| format!("{} {}", call.tool_name, call.arguments)).collect::<Vec<_>>())
                    .unwrap_or_default()
            }
        }
    }
}

fn is_resumable_job(status: RunStatus) -> bool {
    matches!(status, RunStatus::Paused)
}

fn resume_background_job(mut snapshot: Signal<AppSnapshot>, job_id: String) {
    let start_data = snapshot.read().clone();
    // No global flag to clear: the resumed run builds a fresh `RunId`, so its
    // per-instance interrupt entry is never pre-set (and the run clears its own id
    // on finish).
    set_status(
        &mut snapshot,
        format!("Resuming background job {job_id}..."),
    );

    spawn_local(async move {
        let runtime = SessionRunner::new();
        let mut live_snapshot = snapshot;
        let mut final_snapshot = snapshot;
        let result = runtime
            .resume_job_with_observer(start_data, job_id.clone(), move |run| {
                let mut next = live_snapshot.read().clone();
                next.status = format!("Resuming {} lane...", run.lane.as_label());
                next.set_current_run(Some(run));
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
