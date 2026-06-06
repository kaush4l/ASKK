use super::save_snapshot;
use super::shared::set_status;
use crate::engine::{ReActEngine, clear_interrupt, request_interrupt};
use crate::state::{AgentEventKind, AgentRun, AppSnapshot};
use dioxus::prelude::*;
use wasm_bindgen_futures::spawn_local;

#[component]
pub fn ChatPanel(mut snapshot: Signal<AppSnapshot>, mut goal: Signal<String>) -> Element {
    let current = snapshot.read().clone();
    let current_goal = goal.read().clone();

    rsx! {
        section { class: "panel page-panel chat-panel",
            div { class: "page-heading",
                div {
                    h2 { "Chat" }
                }
                div { class: "button-row",
                    button {
                        onclick: move |_| submit_goal(snapshot, goal),
                        "Run"
                    }
                    if current.current_run.as_ref().is_some_and(|run| run.status == "running") {
                        button {
                            class: "ghost-button",
                            onclick: move |_| {
                                request_interrupt();
                                set_status(&mut snapshot, "Stop requested. The run will halt after the current turn.".to_string());
                            },
                            "Stop"
                        }
                    }
                    button {
                        class: "ghost-button",
                        onclick: move |_| {
                            snapshot.write().current_run = None;
                            set_status(&mut snapshot, "Current run reset.".to_string());
                        },
                        "Reset"
                    }
                }
            }

            div { class: "composer",
                textarea {
                    class: "goal-box",
                    placeholder: "Describe a goal or message for the agent...",
                    value: "{current_goal}",
                    oninput: move |event| goal.set(event.value()),
                    onkeydown: move |event| {
                        if event.key() == Key::Enter
                            && !event.modifiers().contains(Modifiers::SHIFT)
                        {
                            event.prevent_default();
                            submit_goal(snapshot, goal);
                        }
                    }
                }
            }

            div { class: "conversation-scroll",
                if let Some(run) = current.current_run.as_ref() {
                    article { class: "message-bubble user-message",
                        div { class: "message-author", "You" }
                        p { "{run.goal}" }
                    }
                    RunSummary { run: run.clone() }
                    if !run.final_answer.trim().is_empty() {
                        article { class: "message-bubble final-message",
                            div { class: "message-author", "Assistant" }
                            p { "{run.final_answer}" }
                        }
                    } else if run.status == "running" {
                        article { class: "message-bubble assistant-message",
                            div { class: "message-author", "Assistant" }
                            p { "Working..." }
                        }
                    } else if run.status == "error" {
                        article { class: "message-bubble error-message",
                            div { class: "message-author", "Error" }
                            p { "{last_error(run)}" }
                        }
                    } else if run.status == "interrupted" {
                        article { class: "message-bubble error-message",
                            div { class: "message-author", "Interrupted" }
                            p { "Run interrupted." }
                        }
                    }
                    RunDetails { run: run.clone() }
                } else if current_goal.trim().is_empty() {
                    div { class: "empty-state", "No chat yet. Enter a message to start a run." }
                } else {
                    article { class: "message-bubble draft-message",
                        div { class: "message-author", "Draft" }
                        p { "{current_goal}" }
                    }
                }
            }
        }
    }
}

fn submit_goal(mut snapshot: Signal<AppSnapshot>, mut goal: Signal<String>) {
    let run_goal = goal.read().trim().to_string();
    if run_goal.is_empty() {
        set_status(&mut snapshot, "Enter a message before running.".to_string());
        return;
    }

    let start_data = snapshot.read().clone();
    goal.set(String::new());
    clear_interrupt();
    set_status(&mut snapshot, "Running orchestrator...".to_string());

    spawn_local(async move {
        let runtime = ReActEngine::new();
        let restore_goal = run_goal.clone();
        let mut live_snapshot = snapshot;
        let mut final_snapshot = snapshot;
        let mut final_goal = goal;
        let result = runtime
            .run_goal_with_observer(start_data, run_goal, move |run| {
                let mut next = live_snapshot.read().clone();
                next.status = format!("Running {} lane...", run.lane.as_label());
                next.current_run = Some(run);
                live_snapshot.set(next);
            })
            .await;

        match result {
            Ok(next) => {
                let run_failed = next
                    .current_run
                    .as_ref()
                    .is_some_and(|run| run.status == "error");
                if run_failed {
                    final_goal.set(restore_goal);
                }
                let run_status = next.status.clone();
                let save_status = save_snapshot(next.clone()).await;
                final_snapshot.set(next);
                set_status(&mut final_snapshot, format!("{run_status}. {save_status}"));
            }
            Err(err) => {
                final_goal.set(restore_goal);
                set_status(&mut final_snapshot, format!("Run failed: {err}"));
            }
        }
    });
}

#[component]
fn RunSummary(run: AgentRun) -> Element {
    let worker_labels = run
        .scratchpad
        .workers
        .iter()
        .map(|worker| format!("{} [{}]", worker.role, worker.status))
        .collect::<Vec<_>>();
    let verification = &run.scratchpad.verification;

    rsx! {
        article { class: "run-summary",
            div { class: "run-summary-head",
                span { class: "lane-chip", "{run.lane.as_label()}" }
                span { class: "event-meta", "{run.status}" }
            }
            if !run.scratchpad.current_plan.is_empty() {
                ul { class: "compact-list",
                    for item in run.scratchpad.current_plan.iter() {
                        li { "{item}" }
                    }
                }
            }
            if !worker_labels.is_empty() {
                div { class: "worker-labels",
                    for label in worker_labels.iter() {
                        span { class: "worker-chip", "{label}" }
                    }
                }
            }
            if !verification.status.trim().is_empty() && verification.status != "pending" {
                p { class: "muted", "Verification: {verification.status} - {verification.last_result}" }
            }
        }
    }
}

#[component]
fn RunDetails(run: AgentRun) -> Element {
    let tool_count = run.tool_results.len();
    let event_count = run.events.len();
    let meta_count = run.scratchpad.meta_tool_calls.len();

    rsx! {
        details { class: "run-details",
            summary {
                "Run details "
                span { class: "event-count", "{event_count}" }
            }
            div { class: "run-details-grid",
                if !run.scratchpad.workers.is_empty() {
                    div { class: "detail-section",
                        h3 { "Workers" }
                        for worker in run.scratchpad.workers.iter() {
                            article { class: "event-row", key: "{worker.id}",
                                div { class: "event-meta",
                                    span { "{worker.role}" }
                                    span { "{worker.status}" }
                                }
                                pre { "Goal: {worker.sub_goal}\nResult: {worker.result}\nEvidence:\n{worker.evidence.join(\"\\n\")}" }
                            }
                        }
                    }
                }
                if meta_count > 0 {
                    div { class: "detail-section",
                        h3 { "Orchestrator" }
                        for call in run.scratchpad.meta_tool_calls.iter() {
                            article { class: "event-row", key: "{call.id}",
                                div { class: "event-meta",
                                    span { "{call.name}" }
                                    span { "{call.created_at}" }
                                }
                                pre { "Args: {call.arguments}\nResult: {call.result}" }
                            }
                        }
                    }
                }
                div { class: "detail-section",
                    h3 { "Scratchpad" }
                    article { class: "event-row",
                        div { class: "event-meta",
                            span { "steps {run.scratchpad.budgets.steps_used}/{run.scratchpad.budgets.max_steps}" }
                            span { "verification {run.scratchpad.verification.status}" }
                        }
                        pre { "{scratchpad_text(&run)}" }
                    }
                }
                if tool_count > 0 {
                    div { class: "detail-section",
                        h3 { "Tools" }
                        for result in run.tool_results.iter() {
                            article { class: if result.ok { "event-row" } else { "event-row error-row" }, key: "{result.call_id}",
                                div { class: "event-meta",
                                    span { "{result.call_id}" }
                                    span { if result.ok { "ok" } else { "error" } }
                                }
                                pre { "{result.content}" }
                            }
                        }
                    }
                }
                div { class: "detail-section",
                    h3 { "Timeline" }
                    for event in run.events.iter() {
                        article { class: event_class(&event.kind), key: "{event.id}",
                            div { class: "event-meta",
                                span { "{event.created_at}" }
                                span { "{event.kind:?}" }
                            }
                            h3 { "{event.title}" }
                            pre { "{event.body}" }
                        }
                    }
                }
                if !run.messages.is_empty() {
                    div { class: "detail-section",
                        h3 { "Messages" }
                        for (index, message) in run.messages.iter().enumerate() {
                            article { class: "event-row", key: "{index}",
                                div { class: "event-meta",
                                    span { "{message.role}" }
                                }
                                pre { "{message.content}" }
                            }
                        }
                    }
                }
            }
        }
    }
}

fn event_class(kind: &AgentEventKind) -> &'static str {
    match kind {
        AgentEventKind::Error => "event-row error-row",
        AgentEventKind::ToolCompleted => "event-row tool-event-row",
        _ => "event-row",
    }
}

fn last_error(run: &AgentRun) -> String {
    run.events
        .iter()
        .rev()
        .find(|event| event.kind == AgentEventKind::Error)
        .map(|event| event.body.clone())
        .unwrap_or_else(|| "Run failed.".to_string())
}

fn scratchpad_text(run: &AgentRun) -> String {
    let observations = run
        .scratchpad
        .recent_observations
        .iter()
        .map(|observation| format!("- {}: {}", observation.source, observation.content))
        .collect::<Vec<_>>()
        .join("\n");
    if observations.is_empty() {
        "No observations yet.".to_string()
    } else {
        observations
    }
}
