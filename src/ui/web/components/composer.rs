//! The composer: where a message is written, with what is attached to it.
//!
//! It is given what it shows (the text, the attachments, whether the engine is at work) and
//! says what the person did (`on_send`, `on_stop`, `on_attach`, `on_remove`). Sending, stopping
//! and uploading are the view's to do.
use super::{Icon, MediaChip};
use crate::api::Chip;
use crate::ui::web::kit::{Button, ButtonSize, ButtonVariant, Kbd, Textarea, Tooltip, TooltipContent};
use dioxus::prelude::*;
use std::collections::BTreeMap;

/// A file on its way into the next message.
#[derive(Clone, Debug, PartialEq)]
pub struct Attached {
    pub key: u64,
    pub name: String,
    /// What is happening to it: `sending 40%`, `sensing…`, `ready`, or the error.
    pub status: String,
    /// The attachment as the service knows it, once it is whole.
    pub chip: Option<Chip>,
}

impl Attached {
    /// Still on its way (not whole yet, and not failed).
    pub fn sending(&self) -> bool {
        self.chip.is_none() && !self.status.starts_with("error")
    }
}

/// The message box. `value` is the text being written (the view may read it too). `to`: who it
/// goes to. `working`: the engine is at work, so Stop is offered. `busy`: a message is being
/// sent or a file is still on its way, so Send waits.
#[component]
pub fn Composer(
    mut value: Signal<String>,
    to: String,
    #[props(default)] attached: Vec<Attached>,
    #[props(default)] pictures: BTreeMap<String, String>,
    #[props(default)] working: bool,
    #[props(default)] busy: bool,
    on_send: EventHandler<()>,
    on_stop: EventHandler<()>,
    on_attach: EventHandler<FormEvent>,
    on_remove: EventHandler<u64>,
) -> Element {
    let nothing = value.read().trim().is_empty() && attached.iter().all(|a| a.chip.is_none());
    rsx! {
        form { class: "compose glass", "aria-label": "Message {to}",
            onsubmit: move |e| {
                e.prevent_default();
                on_send.call(());
            },
            if !attached.is_empty() {
                div { class: "media-row compose-media",
                    for a in attached {
                        div { class: "media-chip pending", key: "{a.key}",
                            match a.chip.clone() {
                                Some(c) => rsx! { MediaChip { picture: pictures.get(&c.id).cloned().unwrap_or_default(), chip: c } },
                                None => rsx! {
                                    span { class: "media-name", "{a.name}" }
                                    span { class: if a.status.starts_with("error") { "media-state bad" } else { "media-state" }, "{a.status}" }
                                },
                            }
                            Button { variant: ButtonVariant::Ghost, size: ButtonSize::IconSm, aria_label: "Remove {a.name}", title: "Remove", onclick: move |_| on_remove.call(a.key),
                                Icon { name: "close", size: 14 }
                            }
                        }
                    }
                }
            }
            Textarea {
                class: "compose-text",
                rows: 1,
                value: value(),
                placeholder: "Message {to}",
                aria_label: "Message {to}",
                oninput: move |e: FormEvent| value.set(e.value()),
                // Enter sends; Shift+Enter is a new line; Enter while a word is still being
                // composed (an input method) belongs to that word.
                onkeydown: move |e: KeyboardEvent| {
                    if e.key() == Key::Enter && !e.modifiers().shift() && !e.is_composing() {
                        e.prevent_default();
                        on_send.call(());
                    }
                },
            }
            div { class: "compose-bar",
                Tooltip {
                    label { class: "compose-attach",
                        Icon { name: "clip", size: 18 }
                        span { class: "visually-hidden", "Attach an image, a recording, a video or a text" }
                        input { class: "visually-hidden", r#type: "file", multiple: true, accept: "image/*,audio/*,video/*,.txt,.md,.csv,.json", onchange: move |e| on_attach.call(e) }
                    }
                    TooltipContent { "Attach a file" }
                }
                span { class: "compose-hint", "aria-hidden": "true", Kbd { "Enter" } " sends" span { class: "sep", "·" } Kbd { "Shift" } Kbd { "Enter" } " new line" }
                span { class: "grow" }
                if working {
                    Button { variant: ButtonVariant::Outline, size: ButtonSize::Icon, class: "compose-stop", aria_label: "Stop", title: "Stop the engine", onclick: move |_| on_stop.call(()),
                        Icon { name: "stop", size: 16 }
                    }
                }
                Button { size: ButtonSize::Icon, class: "compose-send", button_type: "submit", disabled: busy || nothing, aria_label: if busy { "Wait" } else { "Send" }, title: "Send",
                    Icon { name: "send", size: 18 }
                }
            }
        }
    }
}
