//! The composer: where a message is written, with what is attached to it, what waits to be
//! sent, and which model answers.
//!
//! It is given what it shows (the text, the attachments, whether the engine is at work, the
//! messages that wait, the models) and says what the person did (`on_send`, `on_stop`,
//! `on_attach`, `on_remove`, `on_unqueue`, `on_model`). Sending, stopping, queueing and
//! uploading are the view's to do.
use super::{Icon, MediaChip};
use crate::api::Chip;
use crate::ui::features::queue::{heading, Queued};
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

/// Which model answers, as the composer shows it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ModelChoice {
    /// Every model there is, by name.
    pub models: Vec<String>,
    /// The one used by every engine that names none.
    pub default: String,
    /// The one this engine names in its own file; empty when it names none.
    pub own: String,
}

/// The message box. `value` is the text being written (the view may read it too). `to`: who it
/// goes to. `working`: the engine is at work, so Stop is offered and a message sent now waits.
/// `busy`: a message is being sent or a file is still on its way, so Send waits.
#[component]
pub fn Composer(
    mut value: Signal<String>,
    to: String,
    #[props(default)] attached: Vec<Attached>,
    #[props(default)] pictures: BTreeMap<String, String>,
    #[props(default)] working: bool,
    #[props(default)] busy: bool,
    /// The messages that wait until the work is done, first to go first.
    #[props(default)] queued: Vec<Queued>,
    /// The models to choose from; `None` shows no choice.
    #[props(default)] model: Option<ModelChoice>,
    on_send: EventHandler<()>,
    #[props(optional)] on_stop: Option<EventHandler<()>>,
    /// Left out, nothing can be attached (a session with another agent takes words only).
    #[props(optional)] on_attach: Option<EventHandler<FormEvent>>,
    #[props(optional)] on_remove: Option<EventHandler<u64>>,
    /// A waiting message was taken back: `(its key, true to write on it again)`.
    #[props(optional)] on_unqueue: Option<EventHandler<(u64, bool)>>,
    /// A waiting message is to go now, into the work in hand. Left out, none can.
    #[props(optional)] on_steer: Option<EventHandler<u64>>,
    #[props(optional)] on_model: Option<EventHandler<String>>,
) -> Element {
    let nothing = value.read().trim().is_empty() && attached.iter().all(|a| a.chip.is_none());
    let waits = working || !queued.is_empty();
    rsx! {
        if !queued.is_empty() {
            QueueList { queued, steer: working && on_steer.is_some(), on_unqueue: move |x| if let Some(h) = &on_unqueue { h.call(x) }, on_steer: move |k| if let Some(h) = &on_steer { h.call(k) } }
        }
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
                            Button { variant: ButtonVariant::Ghost, size: ButtonSize::IconSm, aria_label: "Remove {a.name}", title: "Remove", onclick: move |_| if let Some(h) = &on_remove { h.call(a.key) },
                                Icon { name: "close", size: 14 }
                            }
                        }
                    }
                }
            }
            Textarea {
                class: "compose-text",
                id: "composer",
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
                if let Some(attach) = on_attach {
                    Tooltip {
                        label { class: "compose-attach",
                            Icon { name: "clip", size: 18 }
                            span { class: "visually-hidden", "Attach an image, a recording, a video or a text" }
                            input { class: "visually-hidden", r#type: "file", multiple: true, accept: "image/*,audio/*,video/*,.txt,.md,.csv,.json", onchange: move |e| attach.call(e) }
                        }
                        TooltipContent { "Attach a file" }
                    }
                }
                if let Some(choice) = model {
                    ModelPick { choice, on_pick: move |name| if let Some(h) = &on_model { h.call(name) } }
                }
                span { class: "compose-hint", "aria-hidden": "true", Kbd { "Enter" } if waits { " queues" } else { " sends" } span { class: "sep", "·" } Kbd { "Shift" } Kbd { "Enter" } " new line" }
                span { class: "grow" }
                if working {
                    if let Some(stop) = on_stop {
                        Button { variant: ButtonVariant::Outline, size: ButtonSize::Icon, class: "compose-stop", aria_label: "Stop", title: "Stop the engine", onclick: move |_| stop.call(()),
                            Icon { name: "stop", size: 16 }
                        }
                    }
                }
                Button { size: ButtonSize::Icon, class: "compose-send", button_type: "submit", disabled: busy || nothing,
                    aria_label: if busy { "Wait" } else if waits { "Queue: it is sent when the work is done" } else { "Send" },
                    title: if waits { "Queue: it is sent when the work is done" } else { "Send" },
                    Icon { name: if waits { "clock" } else { "send" }, size: 18 }
                }
            }
        }
    }
}

/// The messages that wait, above the composer: each as it will be sent, with a way to write
/// on it again and a way to take it back, and (`steer`) a way to send it now, into the work
/// in hand.
#[component]
pub fn QueueList(queued: Vec<Queued>, #[props(default)] steer: bool, on_unqueue: EventHandler<(u64, bool)>, #[props(default)] on_steer: EventHandler<u64>) -> Element {
    let n = queued.len();
    rsx! {
        section { class: "queue", "aria-label": "{heading(n)}",
            p { class: "queue-head", role: "status", Icon { name: "clock", size: 14 } "{heading(n)}" }
            ol { class: "queue-list",
                for (i, q) in queued.into_iter().enumerate() {
                    li { key: "{q.key}", class: "queue-item", "aria-label": "Waiting message {i + 1} of {n}, not sent",
                        p { class: "queue-text", "{q.text}" }
                        if steer {
                            Button { variant: ButtonVariant::Ghost, size: ButtonSize::Sm, class: "queue-steer", aria_label: "Send this message now, into the work in hand", title: "Send now: it reaches the run in hand at its next step", onclick: move |_| on_steer.call(q.key),
                                Icon { name: "send", size: 14 } span { "Send now" }
                            }
                        }
                        Button { variant: ButtonVariant::Ghost, size: ButtonSize::IconSm, aria_label: "Write on this message again", title: "Write on it again", onclick: move |_| on_unqueue.call((q.key, true)),
                            Icon { name: "pencil", size: 14 }
                        }
                        Button { variant: ButtonVariant::Ghost, size: ButtonSize::IconSm, aria_label: "Remove this waiting message", title: "Remove", onclick: move |_| on_unqueue.call((q.key, false)),
                            Icon { name: "close", size: 14 }
                        }
                    }
                }
            }
        }
    }
}

/// Which model answers. An engine that names its own model in its file shows it and offers no
/// choice here; one that names none follows the default, and the default is what is chosen.
#[component]
pub fn ModelPick(choice: ModelChoice, on_pick: EventHandler<String>) -> Element {
    if !choice.own.is_empty() {
        return rsx! {
            span { class: "model-pick is-own", title: "This engine names its model in its own file (engine.json)", Icon { name: "cube", size: 14 } "{choice.own}" }
        };
    }
    if choice.models.is_empty() {
        return rsx! {};
    }
    rsx! {
        label { class: "model-pick", title: "The model of every engine that names none",
            Icon { name: "cube", size: 14 }
            span { class: "visually-hidden", "Model (for every engine that names none)" }
            select { class: "model-select",
                onchange: move |e| {
                    let v = e.value();
                    if !v.is_empty() {
                        on_pick.call(v);
                    }
                },
                for m in choice.models.iter() {
                    option { key: "{m}", value: "{m}", selected: *m == choice.default, "{m}" }
                }
            }
        }
    }
}
