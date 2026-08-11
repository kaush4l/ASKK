//! `AgentEditor` — writing an agent in the browser (plan, increment 11). It
//! owns the textarea and nothing else: the list beside it, who authored what
//! and what each one's space granted are all the core's `/agents` projection,
//! and every write crosses the same seam as everything else (I4).
//!
//! Loading, saving, exporting and deleting are pure browser work — no model is
//! involved in any of them, which is why they all work on the hosted page.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

use crate::agentfile::{export, load, post};

/// The row that loads an existing agent into the editor, or starts a blank
/// one. Its own fn so the pane's body stays inside the 40-line rule (I12).
fn picker(
    web: Signal<Option<Rc<WebApp>>>,
    loaded: Signal<Vec<String>>,
    mut draft: Signal<String>,
    mut name: Signal<String>,
) -> Element {
    rsx! {
    div { class: "editor-picks",
        for who in loaded.read().clone() {
            button {
                r#type: "button",
                key: "{who}",
                onclick: {
            let who = who.clone();
            move |_| {
                if let Some(text) = load(&web, &who) {
                    draft.set(text);
                    name.set(who.clone());
                }
            }
                },
                "Load {who}"
            }
        }
        button {
            r#type: "button",
            onclick: move |_| {
                name.set(String::new());
                draft.set(BLANK.to_string());
            },
            "New agent"
        }
            }
    }
}

#[component]
pub fn AgentEditor(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    loaded: Signal<Vec<String>>,
    /// Every agent THIS BROWSER holds — the only ones there is anything here
    /// to delete. Delete used to be live for the shipped `main`, where it can
    /// only ever be refused, and dead for an agent you had just saved until
    /// you re-loaded it from the picks row (11b walk).
    authored: ReadSignal<Vec<String>>,
    agent: ReadSignal<String>,
) -> Element {
    let mut draft = use_signal(String::new);
    let mut name = use_signal(String::new);
    let status = use_signal(String::new);
    let refused = use_signal(|| false);
    let target = name.read().trim().to_string();
    let deletable = authored.read().contains(&target);
    rsx! {
        section { class: "panel", aria_label: "Write an agent",
            h2 { "Write an agent" }
            p { class: "note",
                "An agent is an agent.md: YAML frontmatter, then the system prompt. What you \
                 write here is kept in this browser and takes effect at the end of the current \
                 turn — no reload. It beats a shipped agent of the same name, so writing one \
                 called main replaces main until you delete it again."
            }
            p { class: "note",
                "Export downloads the same file public/agents/ serves. Committing it takes two \
                 steps, not one: put it at public/agents/<name>/agent.md, AND add <name> to \
                 public/agents/index.json — that file is the manifest, and a folder it does not \
                 list is never fetched."
            }
            {picker(web, loaded, draft, name)}
            form {
                onsubmit: move |e| {
                    e.prevent_default();
                    post(web, status, refused, tick, Request::post_form(
                        "/agents",
                        &[("name", &name.peek().clone()), ("text", &draft.peek().clone())],
                    ));
                },
                label { r#for: "agent-name", "Folder name" }
                input {
                    id: "agent-name",
                    r#type: "text",
                    value: "{name}",
                    placeholder: "note-taker",
                    autocomplete: "off",
                    oninput: move |e| name.set(e.value()),
                }
                label { r#for: "agent-md", "agent.md" }
                textarea {
                    id: "agent-md",
                    rows: 14,
                    // The stylesheet gives it `width: 100%`; with NO stylesheet
                    // a textarea falls back to the UA default of 20 columns, so
                    // the agent editor was a 20×14 comment box (12 walk). The
                    // plain skin is permanent, so the editor is an editor there
                    // too. `cols` is a minimum, not a cap: CSS still wins.
                    cols: 72,
                    spellcheck: false,
                    value: "{draft}",
                    oninput: move |e| draft.set(e.value()),
                }
                div { class: "row",
                    button { r#type: "submit", "Save agent" }
                    button {
                        r#type: "button",
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
                    button {
                        r#type: "button",
                        disabled: !deletable,
                        onclick: move |_| {
                            post(web, status, refused, tick, Request::post_form(
                                "/agents/delete",
                                &[("name", &name.peek().trim().to_string())],
                            ));
                        },
                        "Delete {target}"
                    }
                }
            }
            if !status.read().is_empty() {
                p {
                    class: if refused() { "error" } else { "pending" },
                    role: "status",
                    "{status}"
                }
            }
            p { class: "note",
                "Selected: {agent}. Every agent's origin, who wrote it and what its space \
                 granted it are on its card in the Agents panel."
            }
        }
    }
}

/// The starting point for a new agent: every key the loader reads, so nobody
/// has to remember which ones exist. `tools: []` is the MAXIMAL grant and the
/// comment above it says so — it read as "no tools" (11b walk).
const BLANK: &str = "---\nname: \ndescription: \nmodel: \nengine: react\nspace: \n\
                     # tools: [] means every built-in tool, write_agent included;\n\
                     # tools: [now] is only that one.\n\
                     tools: []\ncompact_at: 8\nkeep_recent: 3\n---\n\nYou are …\n";
