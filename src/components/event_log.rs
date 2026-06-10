use crate::state::{AgentEventKind, AppSnapshot};
use dioxus::prelude::*;

#[component]
pub fn EventLogPanel(snapshot: Signal<AppSnapshot>) -> Element {
    let current = snapshot.read().clone();
    let events = current
        .current_run
        .as_ref()
        .map(|run| run.events.clone())
        .unwrap_or_default();

    rsx! {
        aside { class: "panel event-log-panel",
            div { class: "panel-heading",
                h2 { "Event Log" }
                span { class: "event-count", "{events.len()}" }
            }
            div { class: "timeline scroll-area",
                if events.is_empty() {
                    div { class: "empty-state", "No events yet." }
                } else {
                    for event in events.iter() {
                        {
                            let kind_label = event_kind_label(&event.kind);
                            rsx! {
                        article { class: "event-row", key: "{event.id}",
                            div { class: "event-meta",
                                span { "{event.created_at}" }
                                span { "{kind_label}" }
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
    }
}

fn event_kind_label(kind: &AgentEventKind) -> &'static str {
    match kind {
        AgentEventKind::Started => "started",
        AgentEventKind::Routing => "routing",
        AgentEventKind::MetaTool => "meta_tool",
        AgentEventKind::LlmRequest => "llm_request",
        AgentEventKind::LlmResponse => "llm_response",
        AgentEventKind::ToolRequested => "tool_requested",
        AgentEventKind::ToolCompleted => "tool_completed",
        AgentEventKind::WorkerStarted => "worker_started",
        AgentEventKind::WorkerCompleted => "worker_completed",
        AgentEventKind::Workflow => "workflow",
        AgentEventKind::PhaseStarted => "phase_started",
        AgentEventKind::PhaseCompleted => "phase_completed",
        AgentEventKind::MemoryCompacted => "memory_compacted",
        AgentEventKind::Verification => "verification",
        AgentEventKind::McpConnected => "mcp_connected",
        AgentEventKind::McpToolsListed => "mcp_tools_listed",
        AgentEventKind::Interrupted => "interrupted",
        AgentEventKind::FinalAnswer => "final_answer",
        AgentEventKind::Error => "error",
    }
}
