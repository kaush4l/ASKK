//! Pending-action bar: parked confirmations from the fold, each with the
//! tool name, pretty-printed args, and Approve/Deny wired to the facade's
//! `resolve` through the parent's handler (ADR-006's confirm gate, surfaced).

use dioxus::prelude::*;

use askk_core::ActionRecord;

#[component]
pub fn PendingActionsBar(
    records: Vec<ActionRecord>,
    on_resolve: EventHandler<(String, bool)>,
) -> Element {
    rsx! {
        section { class: "pending",
            for record in records {
                {
                    let approve_id = record.proposal.id.0.clone();
                    let deny_id = approve_id.clone();
                    let args = serde_json::to_string_pretty(&record.proposal.args)
                        .unwrap_or_else(|_| record.proposal.args.to_string());
                    rsx! {
                        div { key: "{record.proposal.id.0}", class: "pending-card",
                            div { class: "pending-head",
                                span { class: "tool-name", "{record.proposal.tool}" }
                                span { class: "muted", "wants to run" }
                            }
                            pre { class: "args", "{args}" }
                            if !record.proposal.rationale.is_empty() {
                                p { class: "muted rationale", "{record.proposal.rationale}" }
                            }
                            div { class: "pending-buttons",
                                button {
                                    class: "approve",
                                    onclick: move |_| on_resolve.call((approve_id.clone(), true)),
                                    "Approve"
                                }
                                button {
                                    class: "deny",
                                    onclick: move |_| on_resolve.call((deny_id.clone(), false)),
                                    "Deny"
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
