//! THE ROW UNDER THE FORM: save it, take it away as a file, or delete this
//! browser's copy. Three presses with three different costs, so each one says
//! what it does before it does it.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

use crate::authoring::agentfile::{export, post};
use crate::ui::Button;

#[component]
pub(crate) fn EditorControls(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    status: Signal<String>,
    refused: Signal<bool>,
    draft: Signal<String>,
    name: Signal<String>,
    authored: ReadSignal<Vec<String>>,
    /// Whether Delete has been asked once already.
    armed: Signal<bool>,
    /// WHAT THE PRIMARY WOULD DO, and whether it can do anything at all (F15).
    /// "Save agent" was accent-filled and live over two empty fields, so the
    /// one enabled control looked like it would overwrite the agent the page
    /// was pointed at. A form that cannot produce a save does not offer one.
    savable: bool,
) -> Element {
    let target = name.read().trim().to_string();
    let deletable = authored.read().contains(&target);
    rsx! {
        div { class: "row",
            Button { variant: "primary", submit: true, disabled: !savable, "Save agent" }
            ExportAgentButton { name, draft }
            DeleteAgentButton { web, tick, status, refused, name, armed, deletable }
            if armed() && deletable {
                Button {
                    variant: "ghost",
                    onclick: move |_| {
                        let mut armed = armed;
                        armed.set(false);
                    },
                    "Cancel"
                }
            }
        }
        DeleteConsequence { target: target.clone(), asked: armed() && deletable }
    }
}

/// WHAT DELETING TAKES AWAY, between the ask and the confirmation — under the
/// row, where the second press is about to land.
#[component]
fn DeleteConsequence(target: String, asked: bool) -> Element {
    if !asked {
        return rsx! {};
    }
    rsx! {
        p { class: "error", role: "status", "⚠ This removes {target} from this \
            browser. Its conversation stays in the log; writing an agent of that \
            name again picks it back up." }
    }
}

/// The file leaves the browser exactly as it is in the box. An unnamed form
/// still exports — it is a download, not a save — so it falls back to `agent`.
#[component]
fn ExportAgentButton(name: Signal<String>, draft: Signal<String>) -> Element {
    rsx! {
        Button {
            variant: "secondary",
            disabled: draft.read().is_empty(),
            onclick: move |_| {
                let who = match name.peek().trim().is_empty() {
                    true => "agent".to_string(),
                    false => name.peek().trim().to_string(),
                };
                export(&who, &draft.peek().clone());
            },
            "Export as a file"
        }
    }
}

/// ONE PRESS ASKS, THE NEXT DOES IT (R18-P1-8): this fired on one click, while
/// `Reset every endpoint` has been armed since R6-5. Named, too — the
/// destructive control says what it destroys.
#[component]
fn DeleteAgentButton(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    status: Signal<String>,
    refused: Signal<bool>,
    name: Signal<String>,
    mut armed: Signal<bool>,
    deletable: bool,
) -> Element {
    let target = name.read().trim().to_string();
    rsx! {
        Button {
            variant: if armed() { "danger" } else { "secondary" },
            disabled: !deletable,
            onclick: move |_| {
                let ready = armed.peek().to_owned();
                armed.set(!ready);
                match ready {
                    true => post(web, status, refused, tick, Request::post_form(
                        "/agents/delete", &[("name", &name.peek().trim().to_string())])),
                    false => {
                        let mut status = status;
                        status.set(String::new());
                    }
                }
            },
            if !deletable { "Delete" } else if armed() { "Yes — delete {target}" }
            else { "Delete {target}" }
        }
    }
}
