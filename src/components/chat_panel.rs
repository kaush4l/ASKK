use super::artifact_view::ArtifactGallery;
use super::save_snapshot;
use super::shared::set_status;
use crate::engine::clear_interrupt;
use crate::state::{AgentEventKind, AgentRun, AppSnapshot, RunArtifact, RunStatus};
use crate::worker::client::{request_active_worker_cancel, run_goal_in_worker_or_inline};
use dioxus::prelude::*;
use wasm_bindgen_futures::spawn_local;

#[component]
pub fn ChatPanel(mut snapshot: Signal<AppSnapshot>, mut goal: Signal<String>) -> Element {
    let current = snapshot.read().clone();
    let current_goal = goal.read().clone();
    let running = current
        .current_run
        .as_ref()
        .is_some_and(|run| run.status == RunStatus::Running);
    let resumable = current
        .current_run
        .as_ref()
        .is_some_and(|run| run.status == RunStatus::Paused);
    // The in-progress or recovered run is only shown live; completed runs live in `runs`.
    let live_turn = current
        .current_run
        .as_ref()
        .filter(|run| run.status == RunStatus::Running || run.status == RunStatus::Paused)
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
        .is_some_and(|run| run.status == RunStatus::Running)
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
        let result = run_goal_in_worker_or_inline(start_data, run_goal_text, move |run| {
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
                    .is_some_and(|run| run.status == RunStatus::Error);
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
    // The run's own artifacts plus any its workers produced, shown inline so the
    // agent can *show* the user images/HTML/JSON/text it generated this turn.
    let artifacts = collect_artifacts(&run);

    // Derive the current phase name from the newest PhaseStarted event. Only shown
    // while the run is actively Running so paused/completed runs stay clean.
    let current_phase = run
        .events
        .iter()
        .rev()
        .find(|event| event.kind == AgentEventKind::PhaseStarted)
        .map(|event| event.title.clone());

    rsx! {
        div { class: "chat-turn",
            article { class: "message-bubble user-message",
                div { class: "message-author", "You" }
                p { "{run.goal}" }
            }
            // NOTE: final_answer may be provisional while a multi-phase strategy is still
            // running (e.g. act answered, review pending). When a phase is active we show
            // the phase-status line beneath the provisional answer so the user can see
            // the strategy is still in progress (e.g. "Phase: review" running after "act").
            if !run.final_answer.trim().is_empty() {
                article { class: "message-bubble final-message",
                    div { class: "message-author",
                        span { "Assistant" }
                        span { class: "lane-chip", "{run.lane.as_label()}" }
                    }
                    p { "{run.final_answer}" }
                    if let Some(phase) = current_phase.as_ref().filter(|_| run.status == RunStatus::Running) {
                        span { class: "phase-status", "{phase}" }
                    }
                }
            } else if run.status == RunStatus::Running || live {
                article { class: "message-bubble assistant-message",
                    div { class: "message-author", "Assistant" }
                    p { class: "thinking-line", "{working_label(&run)}" }
                    if let Some(phase) = current_phase.as_ref().filter(|_| run.status == RunStatus::Running) {
                        span { class: "phase-status", "{phase}" }
                    }
                }
            } else if run.status == RunStatus::Error {
                article { class: "message-bubble error-message",
                    div { class: "message-author", "Error" }
                    p { "{last_error(&run)}" }
                }
            } else if run.status == RunStatus::Interrupted {
                article { class: "message-bubble error-message",
                    div { class: "message-author", "Interrupted" }
                    p { "Run interrupted." }
                }
            }
            ArtifactGallery { artifacts, heading: "Artifacts".to_string() }
            RunDetails { run: run.clone(), live }
        }
    }
}

/// Gather every [`RunArtifact`] for a turn: the orchestrator run's own artifacts
/// first, then each worker's, so the chat shows everything produced this turn in a
/// stable order.
fn collect_artifacts(run: &AgentRun) -> Vec<RunArtifact> {
    let mut artifacts = run.scratchpad.artifacts.clone();
    for worker in &run.scratchpad.workers {
        artifacts.extend(worker.scratchpad.artifacts.iter().cloned());
    }
    artifacts
}

#[component]
fn RunDetails(run: AgentRun, live: bool) -> Element {
    // Count only the steps shown in the clean log (the ReAct flow), not internal
    // bookkeeping events.
    let step_count = run
        .events
        .iter()
        .filter(|event| log_step(&event.kind).is_some())
        .count();

    rsx! {
        details { class: "run-details", open: live,
            summary {
                "Run log "
                span { class: "event-count", "{step_count}" }
            }
            div { class: "run-details-grid",
                div { class: "detail-section",
                    h3 { "Steps" }
                    div { class: "react-log",
                        for event in run.events.iter() {
                            if let Some((label, css)) = log_step(&event.kind) {
                                article { class: "react-step {css}", key: "{event.id}",
                                    div { class: "react-step-head",
                                        span { class: "react-step-label", "{label}" }
                                        span { class: "react-step-title", "{event.title}" }
                                    }
                                    if step_shows_body(&event.kind) && !event.body.trim().is_empty() {
                                        pre { "{event.body}" }
                                    }
                                }
                            }
                        }
                    }
                }
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
            }
        }
    }
}

/// Map an event to its place in the clean ReAct log: `(label, css class)`, or `None`
/// to hide it. The flow the user reads is: LLM call → response → (tool call → tool
/// result)* → answer, with errors surfaced inline.
fn log_step(kind: &AgentEventKind) -> Option<(&'static str, &'static str)> {
    match kind {
        AgentEventKind::LlmRequest => Some(("LLM call", "step-llm-call")),
        AgentEventKind::LlmResponse => Some(("Response", "step-llm-response")),
        AgentEventKind::ToolRequested => Some(("Tool call", "step-tool-call")),
        AgentEventKind::ToolCompleted => Some(("Tool result", "step-tool-result")),
        AgentEventKind::McpConnected => Some(("MCP", "step-mcp")),
        AgentEventKind::McpToolsListed => Some(("MCP tools", "step-mcp")),
        AgentEventKind::FinalAnswer => Some(("Answer", "step-answer")),
        AgentEventKind::Error => Some(("Error", "step-error")),
        AgentEventKind::Interrupted => Some(("Interrupted", "step-error")),
        // Internal bookkeeping — kept out of the readable log.
        AgentEventKind::Started
        | AgentEventKind::Routing
        | AgentEventKind::MetaTool
        | AgentEventKind::Workflow
        | AgentEventKind::PhaseStarted
        | AgentEventKind::PhaseCompleted
        | AgentEventKind::MemoryCompacted
        | AgentEventKind::RollingSummaryUpdated
        | AgentEventKind::Verification
        | AgentEventKind::WorkerStarted
        | AgentEventKind::WorkerCompleted => None,
    }
}

/// The `LLM call` step's body is just message-count bookkeeping; every other step's
/// body (the response text, the tool args, the tool result, the answer) is worth
/// showing.
fn step_shows_body(kind: &AgentEventKind) -> bool {
    !matches!(kind, AgentEventKind::LlmRequest)
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
