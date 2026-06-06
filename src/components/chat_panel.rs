use super::save_snapshot;
use super::shared::set_status;
use crate::engine::clear_interrupt;
use crate::orchestrator::run_goal_with_orchestrator_or_worker;
use crate::state::{AgentEventKind, AgentRun, AppSnapshot};
use crate::worker_client::request_active_worker_cancel;
use dioxus::prelude::*;
use wasm_bindgen_futures::spawn_local;

#[component]
pub fn ChatPanel(mut snapshot: Signal<AppSnapshot>, mut goal: Signal<String>) -> Element {
    let current = snapshot.read().clone();
    let current_goal = goal.read().clone();
    let running = current
        .current_run
        .as_ref()
        .is_some_and(|run| run.status == "running");
    let resumable = current
        .current_run
        .as_ref()
        .is_some_and(|run| run.status == "paused");
    // The in-progress or recovered run is only shown live; completed runs live in `runs`.
    let live_turn = current
        .current_run
        .as_ref()
        .filter(|run| run.status == "running" || run.status == "paused")
        .cloned();
    let has_history = !current.runs.is_empty();

    // Keep the transcript pinned to the newest message as the session grows.
    use_effect(move || {
        let data = snapshot.read();
        let _ = data.runs.len();
        let _ = data
            .current_run
            .as_ref()
            .map(|run| (run.events.len(), run.final_answer.len()));
        document::eval(
            "(() => { const el = document.querySelector('.conversation-scroll'); if (el) el.scrollTop = el.scrollHeight; })()",
        );
    });

    rsx! {
        section { class: "panel page-panel chat-panel",
            div { class: "page-heading chat-header",
                h2 { "Chat" }
                div { class: "button-row",
                    if running {
                        button {
                            class: "ghost-button",
                            onclick: move |_| {
                                request_active_worker_cancel("user requested stop");
                                set_status(&mut snapshot, "Stop requested. The run will halt after the current turn.".to_string());
                            },
                            "Stop"
                        }
                    }
                    if resumable {
                        button {
                            class: "ghost-button",
                            onclick: move |_| resume_current_run(snapshot, goal),
                            "Resume"
                        }
                    }
                    button {
                        class: "ghost-button",
                        disabled: running,
                        onclick: move |_| new_chat(snapshot),
                        "New chat"
                    }
                }
            }

            div { class: "conversation-scroll",
                if !has_history && live_turn.is_none() {
                    div { class: "empty-state",
                        "Start a conversation — your messages and the agent's replies stay in this session, so follow-up questions keep their context."
                    }
                }
                for run in current.runs.iter() {
                    ConversationTurn { key: "{run.id}", run: run.clone(), live: false }
                }
                if let Some(run) = live_turn.as_ref() {
                    ConversationTurn { key: "{run.id}", run: run.clone(), live: true }
                }
            }

            form {
                class: "composer",
                onsubmit: move |event| {
                    event.prevent_default();
                    submit_goal(snapshot, goal);
                },
                textarea {
                    class: "goal-box",
                    placeholder: "Message the agent…  (Enter to send, Shift+Enter for a new line)",
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
                div { class: "composer-actions",
                    span { class: "composer-hint", "{session_label(&current)}" }
                    button {
                        r#type: "submit",
                        disabled: running || current_goal.trim().is_empty(),
                        if running { "Running…" } else { "Send" }
                    }
                }
            }
        }
    }
}

fn new_chat(mut snapshot: Signal<AppSnapshot>) {
    {
        let mut data = snapshot.write();
        data.runs.clear();
        data.current_run = None;
    }
    set_status(&mut snapshot, "Started a new chat.".to_string());
    let data = snapshot.read().clone();
    spawn_local(async move {
        let _ = save_snapshot(data).await;
    });
}

fn resume_current_run(mut snapshot: Signal<AppSnapshot>, mut goal: Signal<String>) {
    let restored_goal = {
        let data = snapshot.read();
        data.current_run
            .as_ref()
            .map(|run| run.goal.clone())
            .unwrap_or_default()
    };

    if restored_goal.is_empty() {
        set_status(&mut snapshot, "No paused run to resume.".to_string());
        return;
    }

    goal.set(restored_goal.clone());
    run_goal(snapshot, goal, restored_goal, "Resuming paused run...");
}

fn submit_goal(mut snapshot: Signal<AppSnapshot>, mut goal: Signal<String>) {
    let run_goal_text = goal.read().trim().to_string();
    if run_goal_text.is_empty() {
        set_status(&mut snapshot, "Enter a message before sending.".to_string());
        return;
    }
    if snapshot
        .read()
        .current_run
        .as_ref()
        .is_some_and(|run| run.status == "running")
    {
        set_status(
            &mut snapshot,
            "A run is already in progress. Wait for it to finish or press Stop.".to_string(),
        );
        return;
    }

    goal.set(String::new());
    run_goal(snapshot, goal, run_goal_text, "Running agent...");
}

fn run_goal(
    mut snapshot: Signal<AppSnapshot>,
    goal: Signal<String>,
    run_goal_text: String,
    status: &'static str,
) {
    clear_interrupt();
    set_status(&mut snapshot, status.to_string());

    spawn_local(async move {
        let restore_goal = run_goal_text.clone();
        let start_data = snapshot.read().clone();
        let mut live_snapshot = snapshot;
        let mut final_snapshot = snapshot;
        let mut final_goal = goal;
        let result = run_goal_with_orchestrator_or_worker(start_data, run_goal_text, move |run| {
            let mut next = live_snapshot.read().clone();
            next.status = format!("Running {} lane...", run.lane.as_label());
            next.current_run = Some(run);
            next.checkpoint_current_run();
            let checkpoint = next.clone();
            spawn_local(async move {
                let _ = save_snapshot(checkpoint).await;
            });
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
                } else {
                    final_goal.set(String::new());
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
fn ConversationTurn(run: AgentRun, live: bool) -> Element {
    rsx! {
        div { class: "chat-turn",
            article { class: "message-bubble user-message",
                div { class: "message-author", "You" }
                p { "{run.goal}" }
            }
            if !run.final_answer.trim().is_empty() {
                article { class: "message-bubble final-message",
                    div { class: "message-author",
                        span { "Assistant" }
                        span { class: "lane-chip", "{run.lane.as_label()}" }
                    }
                    p { "{run.final_answer}" }
                }
            } else if run.status == "running" || live {
                article { class: "message-bubble assistant-message",
                    div { class: "message-author", "Assistant" }
                    p { class: "thinking-line", "{working_label(&run)}" }
                }
            } else if run.status == "error" {
                article { class: "message-bubble error-message",
                    div { class: "message-author", "Error" }
                    p { "{last_error(&run)}" }
                }
            } else if run.status == "interrupted" {
                article { class: "message-bubble error-message",
                    div { class: "message-author", "Interrupted" }
                    p { "Run interrupted." }
                }
            }
            RunDetails { run: run.clone() }
        }
    }
}

#[component]
fn RunDetails(run: AgentRun) -> Element {
    let tool_count = run.tool_results.len();
    let event_count = run.events.len();

    rsx! {
        details { class: "run-details",
            summary {
                "Run details "
                span { class: "event-count", "{event_count}" }
            }
            div { class: "run-details-grid",
                div { class: "detail-section",
                    h3 { "Scratchpad" }
                    article { class: "event-row",
                        div { class: "event-meta",
                            span { "steps {run.scratchpad.budgets.steps_used}/{run.scratchpad.budgets.max_steps}" }
                            span { "{run.status}" }
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

fn working_label(run: &AgentRun) -> String {
    run.events
        .iter()
        .rev()
        .find(|event| !event.title.trim().is_empty())
        .map(|event| format!("{}…", event.title))
        .unwrap_or_else(|| "Working…".to_string())
}

fn session_label(snapshot: &AppSnapshot) -> String {
    match snapshot.runs.len() {
        0 => "New session".to_string(),
        1 => "1 turn in this session".to_string(),
        count => format!("{count} turns in this session"),
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
