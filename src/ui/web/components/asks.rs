//! What waits for the owner, answered where it is seen.
//!
//! [`AskForm`] is given one open question (`ui/features/asks.rs`) and draws it with a field
//! for the answer. It says what was answered (`on_answer`); sending it is the view's to do.
//! A blocked box shows these in its tile and when it is open, so the owner need not go to
//! another page to let an engine go on.
use crate::ui::features::asks::Ask;
use crate::ui::web::kit::{Button, ButtonSize, Textarea};
use dioxus::prelude::*;

/// One question and a field to answer it. `sent`: what became of the last answer (`Sent`, or
/// the error), shown beside the button. `small`: the tile's size, one line to begin with.
#[component]
pub fn AskForm(ask: Ask, #[props(default)] sent: String, #[props(default)] small: bool, on_answer: EventHandler<String>) -> Element {
    let mut answer = use_signal(String::new);
    let mut give = move || {
        let a = answer().trim().to_string();
        if !a.is_empty() {
            on_answer.call(a);
            answer.set(String::new());
        }
    };
    let failed = sent.starts_with("error");
    rsx! {
        form { class: if small { "ask-form is-small" } else { "ask-form" }, "aria-label": "Answer: {ask.question}",
            onsubmit: move |e| {
                e.prevent_default();
                give();
            },
            p { class: "ask-form-q",
                // Never a colour alone: the sign and the word say it waits.
                span { class: "ask-form-sign", role: "img", "aria-label": "waits for you", "?" }
                span { "{ask.question}" }
            }
            if !ask.asked_by.is_empty() && !small { p { class: "ask-form-by", "Asked by {ask.asked_by}" } }
            div { class: "ask-form-row",
                Textarea { class: "ask-form-text", rows: if small { 1 } else { 2 }, value: answer(), placeholder: "Your answer", aria_label: "Your answer to: {ask.question}",
                    oninput: move |e: FormEvent| answer.set(e.value()),
                    // Enter answers; Shift+Enter is a new line.
                    onkeydown: move |e: KeyboardEvent| {
                        if e.key() == Key::Enter && !e.modifiers().shift() && !e.is_composing() {
                            e.prevent_default();
                            give();
                        }
                    },
                }
                Button { size: ButtonSize::Sm, button_type: "submit", disabled: answer.read().trim().is_empty(), "Answer" }
            }
            if !sent.is_empty() { p { class: if failed { "ask-form-sent bad" } else { "ask-form-sent" }, role: if failed { "alert" } else { "status" }, "{sent}" } }
        }
    }
}
