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
use crate::ui::{has_rows, Button, Card, EmptyState, Field, Form, Skeleton};

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
                Button {
                    key: "{who}",
                    variant: "secondary",
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
            Button {
                variant: "secondary",
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
        Card { title: "Write an agent", aria_label: "Write an agent",
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
            Form {
                onsubmit: move |_| {
                    post(web, status, refused, tick, Request::post_form(
                        "/agents",
                        &[("name", &name.peek().clone()), ("text", &draft.peek().clone())],
                    ));
                },
                Field {
                    id: "agent-name",
                    label: "Folder name",
                    r#type: "text",
                    value: "{name}",
                    placeholder: "note-taker",
                    autocomplete: "off",
                    oninput: move |e: FormEvent| name.set(e.value()),
                }
                // `rows` makes this the multiline variant; `cols: 72` rides
                // inside the component (12 walk: with no stylesheet a textarea
                // falls back to 20 columns and this was a comment box).
                Field {
                    id: "agent-md",
                    label: "agent.md",
                    rows: 14,
                    "spellcheck": "false",
                    value: "{draft}",
                    oninput: move |e: FormEvent| draft.set(e.value()),
                }
                div { class: "row",
                    Button { submit: true, "Save agent" }
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
                    Button {
                        variant: "danger",
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

/// Who is loaded, and where from. Its own fn because the shell composes the
/// page and owns no content (plan, "UI shape").
pub(crate) fn agent_panel(agents: Signal<String>) -> Element {
    let projection = agents.read().clone();
    rsx! {
        Card { title: "Agents", aria_label: "Agents",
            p { class: "note",
                "Loaded from public/agents/ at boot — edit an agent.md, redeploy, reload, \
                 and the agent changes with no rebuild. An agent written in this browser is \
                 the same file, kept here instead, and each card says which it is and what \
                 its space granted it."
            }
            if projection.is_empty() {
                Skeleton { lines: 3, label: "Reading the agent roster" }
            } else if has_rows(&projection, "agent-card") {
                div { dangerous_inner_html: "{projection}" }
            } else {
                EmptyState {
                    glyph: "◇",
                    title: "No agents are loaded",
                    sentence: "Nothing was fetched from public/agents/. index.json is the \
                               manifest and a folder it does not list is never fetched — so \
                               either the manifest is empty or the fetch failed. You can \
                               write one here instead: it is kept in this browser and takes \
                               effect at the end of the current turn.",
                    Button {
                        variant: "secondary",
                        onclick: move |_| crate::ui::focus("agent-name"),
                        "Write an agent"
                    }
                }
            }
        }
    }
}
