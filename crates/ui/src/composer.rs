//! The composer — the one control that starts a turn. Its own file so
//! `ChatPane` stays inside the 200-line rule (I12).

use dioxus::prelude::*;

/// The composer: a real form, so Enter submits and the button is a submit
/// button — with the default navigation prevented, because the seam is the only
/// transport. That is what stops the message becoming a query string. With no
/// endpoint configured it does not send: the first-run path is a sentence, not
/// a request that cannot work.
#[component]
pub fn Composer(busy: bool, ready: bool, agent: String, on_send: EventHandler<String>) -> Element {
    // The field says who it is addressing: two panes with the same accessible
    // name would be indistinguishable to a screen reader.
    let label = match agent.is_empty() {
        true => "Message to the agent".to_string(),
        false => format!("Message to {agent}"),
    };
    let mut draft = use_signal(String::new);
    let mut submit = move || {
        let text = draft().trim().to_string();
        if text.is_empty() || busy || !ready {
            return;
        }
        draft.set(String::new());
        on_send.call(text);
    };
    rsx! {
        form {
            class: "oneline",
            onsubmit: move |e| {
                e.prevent_default();
                submit();
            },
            input {
                r#type: "text",
                value: "{draft}",
                aria_label: "{label}",
                placeholder: if ready { "Ask the agent something…" } else { "Set a model endpoint first" },
                autocomplete: "off",
                disabled: busy || !ready,
                oninput: move |e| draft.set(e.value()),
            }
            button {
                r#type: "submit",
                disabled: busy || !ready,
                if busy { "Sending…" } else { "Send" }
            }
        }
    }
}
