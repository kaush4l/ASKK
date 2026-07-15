//! Probe panel: a full browser-capability sweep grouped by section, each entry
//! shown as a status-dotted card with its detail line, plus a re-probe button.
//! Read-only inspection surface backed by [`askk_browser::capabilities::probe`]
//! (nothing here touches the agent engine — ADR-041).

use dioxus::prelude::*;

use askk_browser::capabilities::{probe, CapabilityStatus};

/// Map a status to its (CSS suffix, label) pair for the `.feat-status` pill.
fn status_pill(status: CapabilityStatus) -> (&'static str, &'static str) {
    match status {
        CapabilityStatus::Yes => ("s-yes", "yes"),
        CapabilityStatus::Partial => ("s-partial", "partial"),
        CapabilityStatus::No => ("s-no", "no"),
    }
}

#[component]
pub fn ProbePanel() -> Element {
    let mut report = use_resource(move || async move { probe().await });

    // `read_unchecked` keeps the match in one statement; every arm builds owned
    // rsx (format strings + `grouped()` clone), so no borrow outlives the guard.
    let body = match &*report.read_unchecked() {
        None => rsx! {
            div { class: "feat-detail", "Probing browser capabilities…" }
        },
        Some(Err(e)) => rsx! {
            div { class: "feat-err", "{e}" }
        },
        Some(Ok(rep)) => rsx! {
            div { class: "feat-detail", "{rep.user_agent}" }
            for (group, entries) in rep.grouped() {
                div { class: "feat-group-title", "{group}" }
                div { class: "feat-grid",
                    for entry in entries {
                        {
                            let (suffix, text) = status_pill(entry.status);
                            rsx! {
                                div { class: "feat-card",
                                    div { class: "feat-card-title",
                                        "{entry.label}"
                                        span { class: "feat-status {suffix}", "{text}" }
                                    }
                                    if !entry.detail.is_empty() {
                                        div { class: "feat-detail", "{entry.detail}" }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
    };

    rsx! {
        div { class: "presets",
            button {
                class: "preset",
                onclick: move |_| report.restart(),
                "Re-probe"
            }
        }
        {body}
    }
}
