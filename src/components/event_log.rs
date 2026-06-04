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
        AgentEventKind::LlmRequest => "llm_request",
        AgentEventKind::LlmResponse => "llm_response",
        AgentEventKind::ToolRequested => "tool_requested",
        AgentEventKind::ToolCompleted => "tool_completed",
        AgentEventKind::FinalAnswer => "final_answer",
        AgentEventKind::Error => "error",
    }
}
