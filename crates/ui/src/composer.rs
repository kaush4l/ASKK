//! The composer — the one control that starts a turn. Its own file so
//! `ChatPane` stays inside the 200-line rule (I12).

use std::collections::HashMap;

use dioxus::prelude::*;

use crate::ui::{Button, Field, Form, COMPOSER_ID};

/// The composer: a real form, so Enter submits and the button is a submit
/// button — with the default navigation prevented, because the seam is the only
/// transport. That is what stops the message becoming a query string. With no
/// endpoint configured it does not send: the first-run path is a sentence, not
/// a request that cannot work.
///
/// It is NOT disabled while a turn runs. It was, for as long as a turn was one
/// model call; an agent that may now work for sixty-four rounds (15C) cannot
/// also be a thing you are locked out of for the duration. A message typed
/// mid-run is steering: the pure machine appends it to the history and the
/// agent reads it on its next step (`agent::step`), so the only thing that
/// changes here is the word on the button.
#[component]
pub fn Composer(busy: bool, ready: bool, agent: String, on_send: EventHandler<String>) -> Element {
    // The field says who it is addressing: two panes with the same accessible
    // name would be indistinguishable to a screen reader.
    let label = match agent.is_empty() {
        true => "Message to the agent".to_string(),
        false => format!("Message to {agent}"),
    };
    // One draft PER AGENT. A single signal survived the agent prop changing —
    // the component keeps its position in the tree, so the text did too: type
    // to `author`, switch to `main`, press Send, and author's sentence went to
    // main (13d walk). A half-written message belongs to the conversation it
    // was being written to, the same way the transcript does.
    let mut drafts = use_signal(HashMap::<String, String>::new);
    let mine = agent.clone();
    let draft = drafts.read().get(&mine).cloned().unwrap_or_default();
    let key = mine.clone();
    let mut submit = move || {
        let text = drafts.read().get(&key).cloned().unwrap_or_default();
        let text = text.trim().to_string();
        if text.is_empty() || !ready {
            return;
        }
        drafts.write().remove(&key);
        on_send.call(text);
    };
    rsx! {
        Form {
            oneline: true,
            onsubmit: move |_| submit(),
            Field {
                // The one field a turn starts from, so it has a stable id:
                // every EmptyState in the rail answers "what would put
                // something here" by sending focus to exactly this control.
                id: COMPOSER_ID,
                r#type: "text",
                value: "{draft}",
                aria_label: "{label}",
                placeholder: match (ready, busy) {
                    (false, _) => "Set a model endpoint first",
                    (true, true) => "Steer the run — the agent reads this on its next step…",
                    (true, false) => "Ask the agent something…",
                },
                autocomplete: "off",
                disabled: !ready,
                oninput: move |e: FormEvent| {
                    drafts.write().insert(mine.clone(), e.value());
                },
            }
            Button {
                submit: true,
                disabled: !ready,
                // The word says what pressing it does. "Sending…" during a run
                // described the LAST message; this one describes this one.
                if busy { "Send to the run" } else { "Send" }
            }
        }
    }
}
