//! WHAT THE FORM SAYS ABOUT ITSELF: what saving this name would replace, why
//! the primary is dead, what the core answered, and which agent the page is
//! pointed at. Four sentences, each with the one condition that puts it there.

use dioxus::prelude::*;

/// Eight lines of preamble in front of one textarea (F9); the format and the
/// export route are behind the marker below the form.
#[component]
pub(crate) fn WhatAnAgentIs() -> Element {
    rsx! {
        p { class: "note",
            "An agent is a short text file: a few settings, then the instructions it \
             follows. Save one here and it is yours, kept in this browser."
        }
    }
}

/// …AND WHAT SAVING THIS NAME WOULD REPLACE, BEFORE IT DOES (R17-P1-7). The
/// same two facts `core::agents::authoring::replaces_shipped` decides the receipt on,
/// read off the two lists this pane already holds: a name the deploy shipped,
/// with nothing of this browser's already in front of it.
#[component]
pub(crate) fn ShippedReplaceWarning(
    loaded: Signal<Vec<String>>,
    authored: ReadSignal<Vec<String>>,
    target: String,
) -> Element {
    let shipped = loaded.read().contains(&target) && !authored.read().contains(&target);
    if !shipped {
        return rsx! {};
    }
    rsx! {
        p { class: "warn", role: "status",
            "{target} is shipped with this site. Saving replaces it with what is in \
             this form, in this browser only, until you delete your copy again — \
             give it a different name above to keep both."
        }
    }
}

/// WHY THE PRIMARY IS DEAD, BESIDE IT (R18-P2). The Dashboard has said `Start
/// agent is off until you have typed a task.` under its own dead primary since
/// R3-15; this one was dead in exactly the same way with nothing next to it,
/// and the reason it does have — `PointedAtNote` — is four paragraphs below,
/// past the key notes. The same sentence, in the same place, naming whichever
/// half is missing.
#[component]
pub(crate) fn SaveBlockedNote(
    name: Signal<String>,
    draft: Signal<String>,
    savable: bool,
) -> Element {
    if savable {
        return rsx! {};
    }
    // ONE sentence with the missing half named in it, rather than three
    // sentences that have to be kept in step with each other.
    let missing = match (name.read().trim().is_empty(), draft.read().trim().is_empty()) {
        (true, true) => "named the agent and written its file above",
        (true, false) => "named the agent above",
        _ => "written the agent's file above",
    };
    rsx! {
        p { class: "note", "Save agent is off until you have {missing}." }
    }
}

/// What the core answered the last press, in its own words — an error when it
/// refused, pending otherwise. `agent-name` points at this by id when it is a
/// refusal (R4-7).
#[component]
pub(crate) fn SaveResult(status: Signal<String>, refused: Signal<bool>) -> Element {
    if status.read().is_empty() {
        return rsx! {};
    }
    rsx! {
        p {
            id: "agent-status",
            class: if refused() { "error" } else { "pending" },
            role: "status",
            "{status}"
        }
    }
}

/// The caption says what THIS FORM holds; which agent the page is pointed at is
/// a different fact and reads as one.
///
/// ONE STATE PER MOMENT (R4-6): a refused save printed its refusal AND a
/// sentence derived from the value the core had just rejected, two lines below
/// it — so a refusal silences this half.
#[component]
pub(crate) fn PointedAtNote(
    agent: ReadSignal<String>,
    name: Signal<String>,
    draft: Signal<String>,
    refused: Signal<bool>,
) -> Element {
    let target = name.read().trim().to_string();
    let holding = match (refused(), target.is_empty(), draft.read().trim().is_empty()) {
        (true, ..) => String::new(),
        (_, true, true) => "This form is empty. Load an agent above, or start a new one.".into(),
        (_, true, false) => "This form needs an agent name before it can be saved.".into(),
        (_, false, true) => format!("This form is named {target} and has no file in it yet."),
        (_, false, false) => format!("Saving writes {target} into this browser."),
    };
    rsx! {
        p { class: "note",
            "{holding} The page is pointed at {agent} — that is the agent Chat, Run a \
             task and the side panel are all about, and it is not changed by saving here. \
             Every agent's origin, who wrote it and what it can reach are in the Agents \
             panel above."
        }
    }
}
