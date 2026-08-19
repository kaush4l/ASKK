//! `AgentEditor` — writing an agent in the browser (plan, increment 11). It
//! owns the textarea and nothing else: the list beside it and who authored what
//! are the core's `/agents` projection, and every write crosses the same seam
//! as everything else (I4). Loading, saving, exporting and deleting are pure
//! browser work, which is why they all work on the hosted page.

pub(crate) mod agentfile;
pub(crate) mod controls;
pub(crate) mod key_help;
pub(crate) mod notices;

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;


use crate::authoring::agentfile::{open_selected, picker, post, BLANK};
use crate::ui::{Card, Field, Form};
use controls::EditorControls;
use notices::{PointedAtNote, SaveBlockedNote, SaveResult, ShippedReplaceWarning, WhatAnAgentIs};

/// The save itself: the name and the file, through the same seam every other
/// write crosses (I4). `peek` on both, because the press reads them once and
/// subscribing here would re-render the form on every keystroke.
fn save(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    status: Signal<String>,
    refused: Signal<bool>,
    name: Signal<String>,
    draft: Signal<String>,
) {
    let body = [
        ("name", name.peek().clone()),
        ("text", draft.peek().clone()),
    ];
    let form: Vec<(&str, &str)> = body.iter().map(|(k, v)| (*k, v.as_str())).collect();
    post(web, status, refused, tick, Request::post_form("/agents", &form));
}

#[component]
pub fn AgentEditor(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    loaded: Signal<Vec<String>>,
    /// Every agent THIS BROWSER holds — the only ones there is anything here
    /// to delete (11b walk).
    authored: ReadSignal<Vec<String>>,
    agent: ReadSignal<String>,
    /// PRESSES OF `Write a new agent`, counted (R17-P1-7). The roster's link
    /// used to only focus this form — which arrives holding an agent — so
    /// "new" landed on somebody else's file with a Save that would overwrite
    /// it. A press empties the form here rather than scrolling to a full one.
    blank: Signal<u32>,
) -> Element {
    let mut draft = use_signal(String::new);
    let mut name = use_signal(String::new);
    let status = use_signal(String::new);
    let refused = use_signal(|| false);
    use_effect(move || open_selected(web, &agent(), draft, name)); // R7-8
    use_effect(move || {
        if blank() > 0 {
            name.set(String::new());
            draft.set(BLANK.to_string());
        }
    });
    rsx! {
        Card { title: "Write an agent", aria_label: "Write an agent",
            WhatAnAgentIs {}
            {crate::authoring::key_help::ask_author(loaded.read().iter().any(|a| a == "author"))}
            {picker(web, loaded, draft, name)}
            AgentSaveForm { web, tick, loaded, authored, draft, name, status, refused }
            {crate::authoring::key_help::notes()}
            PointedAtNote { agent, name, draft, refused }
        }
    }
}

/// THE FORM: the two fields, the sentences about what saving this name would
/// do, the controls, and what the core said about the last press.
#[component]
fn AgentSaveForm(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    loaded: Signal<Vec<String>>,
    authored: ReadSignal<Vec<String>>,
    draft: Signal<String>,
    name: Signal<String>,
    status: Signal<String>,
    refused: Signal<bool>,
) -> Element {
    let target = name.read().trim().to_string();
    let savable = !target.is_empty() && !draft.read().trim().is_empty();
    // Whether Delete is ARMED (R18-P1-8) — Settings' reset signal, same shape.
    // Held here because editing the NAME disarms it: the two controls that
    // move it are in two regions below.
    let armed = use_signal(|| false);
    rsx! {
        Form {
            onsubmit: move |_| save(web, tick, status, refused, name, draft),
            AgentNameField { name, armed, refused, status }
            // `rows` makes this the multiline variant (12 walk).
            Field {
                id: "agent-md",
                label: "The agent file — settings, then instructions",
                rows: 14,
                "spellcheck": "false",
                value: "{draft}",
                oninput: move |e: FormEvent| {
                    let mut draft = draft;
                    draft.set(e.value());
                },
            }
            ShippedReplaceWarning { loaded, authored, target: target.clone() }
            SaveBlockedNote { name, draft, savable }
            EditorControls { web, tick, status, refused, draft, name, authored, armed, savable }
        }
        SaveResult { status, refused }
    }
}

/// WHAT THE FIELD IS FOR, NOT WHERE IT LANDS (R6-12). It was labelled `Folder
/// name` — the agent's IDENTITY, named after the storage detail underneath it —
/// with a placeholder that looks exactly like an existing agent's name, so a
/// first-timer reads the form as "leave this blank and you overwrite that one".
#[component]
fn AgentNameField(
    mut name: Signal<String>,
    mut armed: Signal<bool>,
    mut refused: Signal<bool>,
    mut status: Signal<String>,
) -> Element {
    rsx! {
        Field {
            id: "agent-name",
            label: "Agent name — what you will call it everywhere else",
            r#type: "text",
            value: "{name}",
            placeholder: "a name no agent has yet",
            autocomplete: "off",
            // Wired to the field it is about (R4-7).
            "aria-invalid": if refused() { "true" } else { "false" },
            "aria-describedby": if refused() { "agent-status" } else { "" },
            // Editing clears it: it was about the old value, and it disarms
            // Delete, which was about the old name.
            oninput: move |e: FormEvent| {
                name.set(e.value());
                armed.set(false);
                if refused() {
                    refused.set(false);
                    status.set(String::new());
                }
            },
        }
    }
}
