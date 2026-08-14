//! `AgentEditor` — writing an agent in the browser (plan, increment 11). It
//! owns the textarea and nothing else: the list beside it and who authored what
//! are the core's `/agents` projection, and every write crosses the same seam
//! as everything else (I4). Loading, saving, exporting and deleting are pure
//! browser work, which is why they all work on the hosted page.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

use crate::agentfile::{export, open_selected, picker, post, BLANK};
use crate::ui::{Button, Card, Field, Form};

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
    let mut status = use_signal(String::new);
    use_effect(move || open_selected(web, &agent(), draft, name)); // R7-8
    use_effect(move || {
        if blank() > 0 {
            name.set(String::new());
            draft.set(BLANK.to_string());
        }
    });
    let mut refused = use_signal(|| false);
    // Whether Delete is ARMED (R18-P1-8) — Settings' reset signal, same shape.
    let mut armed = use_signal(|| false);
    let target = name.read().trim().to_string();
    let deletable = authored.read().contains(&target);
    // …AND WHAT SAVING THIS NAME WOULD REPLACE, BEFORE IT DOES (R17-P1-7). The
    // same two facts `core::authoring::replaces_shipped` decides the receipt
    // on, read off the two lists this pane already holds: a name the deploy
    // shipped, with nothing of this browser's already in front of it.
    let shipped = loaded.read().contains(&target) && !deletable;
    // WHAT THE PRIMARY WOULD DO, and whether it can do anything at all (F15).
    // "Save agent" was accent-filled and live over two empty fields, so the one
    // enabled control looked like it would overwrite the agent the page was
    // pointed at. A form that cannot produce a save does not offer one.
    let savable = !target.is_empty() && !draft.read().trim().is_empty();
    // The caption says what THIS FORM holds; which agent the page is pointed
    // at is a different fact and reads as one. ONE STATE PER MOMENT (R4-6): a
    // refused save printed its refusal AND a sentence derived from the value
    // the core had just rejected, two lines below it.
    let holding = match (refused(), target.is_empty(), draft.read().trim().is_empty()) {
        (true, ..) => String::new(),
        (_, true, true) => "This form is empty. Load an agent above, or start a new one.".into(),
        (_, true, false) => "This form needs an agent name before it can be saved.".into(),
        (_, false, true) => format!("This form is named {target} and has no file in it yet."),
        (_, false, false) => format!("Saving writes {target} into this browser."),
    };
    rsx! {
        Card { title: "Write an agent", aria_label: "Write an agent",
            // Eight lines of preamble in front of one textarea (F9); the
            // format and the export route are behind the marker below.
            p { class: "note",
                "An agent is a short text file: a few settings, then the instructions it \
                 follows. Save one here and it is yours, kept in this browser."
            }
            {crate::agentkeys::ask_author(loaded.read().iter().any(|a| a == "author"))}
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
                    // WHAT THE FIELD IS FOR, NOT WHERE IT LANDS (R6-12). It was
                    // labelled `Folder name` — the agent's IDENTITY, named
                    // after the storage detail underneath it — with a
                    // placeholder that looks exactly like an existing agent's
                    // name, so a first-timer reads the form as "leave this
                    // blank and you overwrite that one".
                    label: "Agent name — what you will call it everywhere else",
                    r#type: "text",
                    value: "{name}",
                    placeholder: "a name no agent has yet",
                    autocomplete: "off",
                    // Wired to the field it is about (R4-7).
                    "aria-invalid": if refused() { "true" } else { "false" },
                    "aria-describedby": if refused() { "agent-status" } else { "" },
                    // Editing clears it: it was about the old value.
                    oninput: move |e: FormEvent| {
                        name.set(e.value());
                        armed.set(false);
                        if refused() { refused.set(false); status.set(String::new()); }
                    },
                }
                // `rows` makes this the multiline variant (12 walk).
                Field {
                    id: "agent-md",
                    label: "The agent file — settings, then instructions",
                    rows: 14,
                    "spellcheck": "false",
                    value: "{draft}",
                    oninput: move |e: FormEvent| draft.set(e.value()),
                }
                if shipped {
                    p { class: "warn", role: "status",
                        "{target} is shipped with this site. Saving replaces it with what is in \
                         this form, in this browser only, until you delete your copy again — \
                         give it a different name above to keep both."
                    }
                }
                // WHY THE PRIMARY IS DEAD, BESIDE IT (R18-P2). The Dashboard
                // has said `Start agent is off until you have typed a task.`
                // under its own dead primary since R3-15; this one was dead in
                // exactly the same way with nothing next to it, and the reason
                // it does have — `holding` — is four paragraphs below, past the
                // key notes. The same sentence, in the same place, naming
                // whichever half is missing.
                if !savable {
                    p { class: "note",
                        {match (target.is_empty(), draft.read().trim().is_empty()) {
                            (true, true) => "Save agent is off until you have named the agent \
                                             and written its file above.",
                            (true, false) => "Save agent is off until you have named the agent \
                                              above.",
                            _ => "Save agent is off until you have written the agent's file \
                                  above.",
                        }}
                    }
                }
                div { class: "row",
                    Button { variant: "primary", submit: true, disabled: !savable, "Save agent" }
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
                    // ONE PRESS ASKS, THE NEXT DOES IT (R18-P1-8): this fired on one
                    // click, while `Reset every endpoint` has been armed since R6-5.
                    Button {
                        variant: if armed() { "danger" } else { "secondary" },
                        disabled: !deletable,
                        onclick: move |_| {
                            let ready = armed.peek().to_owned();
                            armed.set(!ready);
                            match ready {
                                true => post(web, status, refused, tick, Request::post_form(
                                    "/agents/delete", &[("name", &name.peek().trim().to_string())])),
                                false => status.set(String::new()),
                            }
                        },
                        // Named: the destructive control says what it destroys.
                        if !deletable { "Delete" } else if armed() { "Yes — delete {target}" }
                        else { "Delete {target}" }
                    }
                    if armed() && deletable { Button { variant: "ghost", onclick: move |_| armed.set(false), "Cancel" } }
                }
                if armed() && deletable {
                    p { class: "error", role: "status", "⚠ This removes {target} from this \
                        browser. Its conversation stays in the log; writing an agent of that \
                        name again picks it back up." }
                }
            }
            if !status.read().is_empty() {
                p {
                    id: "agent-status",
                    class: if refused() { "error" } else { "pending" },
                    role: "status",
                    "{status}"
                }
            }
            {crate::agentkeys::notes()}
            p { class: "note",
                "{holding} The page is pointed at {agent} — that is the agent Chat, Run a \
                 task and the side panel are all about, and it is not changed by saving here. \
                 Every agent's origin, who wrote it and what it can reach are in the Agents \
                 panel above."
            }
        }
    }
}
