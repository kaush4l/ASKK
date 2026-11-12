//! The composer: where a message is written, with what is attached to it, what waits to be
//! sent, which model answers and what the engine may do without asking.
//!
//! It is given what it shows (the text, the attachments, whether the engine is at work, the
//! messages that wait, the models, the permission mode, what `@` and `#` can name, the prompts
//! sent before) and says what the person did. As it is typed into, a menu opens for `/`, `@`
//! and `#` (`features/compose.rs`), moved through with the arrows. ArrowUp in an empty
//! composer brings back the last prompts; mod+S puts the text aside and brings it back;
//! mod+shift+D speaks into it where the browser can hear. Sending, stopping, queueing,
//! uploading and running a command are the view's to do.
use super::{Icon, MediaChip};
use crate::api::Chip;
use crate::ui::features::compose::{apply, menu, recall as recalled, Mention, LIMITS};
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

/// What `@` and `#` can name, and the prompts ArrowUp brings back.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Reach {
    pub mentions: Vec<Mention>,
    pub files: Vec<String>,
    /// What `$` can name: the skills on disk.
    pub skills: Vec<Mention>,
    /// What was asked before, oldest first.
    pub asked: Vec<String>,
}

/// A message sent into the run in hand, and how far it has come.
#[derive(Clone, Debug, PartialEq)]
pub struct SteerLine {
    pub id: u64,
    pub text: String,
    pub said: String,
    pub landed: bool,
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
    /// What was sent into the run in hand.
    #[props(default)] steered: Vec<SteerLine>,
    /// The models to choose from; `None` shows no choice.
    #[props(default)] model: Option<ModelChoice>,
    /// The permission mode (`ask`, `edits`, `all`); `None` shows no choice.
    #[props(default)] permit: Option<String>,
    #[props(default)] reach: Reach,
    /// How many texts are put aside (mod+S).
    #[props(default)] stashed: usize,
    /// `None`: this browser cannot hear, and nothing is shown; else whether it listens now.
    #[props(default)] voice: Option<bool>,
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
    #[props(optional)] on_permit: Option<EventHandler<String>>,
    /// The text is put aside (mod+S with words), or the last one put aside is wanted back.
    #[props(optional)] on_stash: Option<EventHandler<Option<String>>>,
    #[props(optional)] on_voice: Option<EventHandler<()>>,
) -> Element {
    let nothing = value.read().trim().is_empty() && attached.iter().all(|a| a.chip.is_none());
    let waits = working || !queued.is_empty();
    // The menu: the line chosen, and whether Escape closed it for the word being typed.
    let mut chosen = use_signal(|| 0usize);
    let mut shut = use_signal(String::new);
    // Where ArrowUp has brought the composer back to (`None`: what is being written).
    let mut back = use_signal(|| None::<usize>);
    let items = if *shut.read() == *value.read() { vec![] } else { menu(&value.read(), &reach.mentions, &reach.files, &reach.skills) };
    let open = !items.is_empty();
    let at = chosen().min(items.len().saturating_sub(1));
    let asked = reach.asked.clone();
    let picked = items.get(at).cloned();
    let keys_items = items.clone();
    rsx! {
        if !steered.is_empty() {
            section { class: "steered", "aria-label": "Sent into the run",
                for s in steered {
                    p { key: "{s.id}", class: if s.landed { "steer-line is-landed" } else { "steer-line" }, role: "status",
                        Icon { name: if s.landed { "check" } else { "send" }, size: 14 }
                        span { class: "steer-text", "{s.text}" }
                        span { class: "steer-said", "{s.said}" }
                    }
                }
            }
        }
        if !queued.is_empty() {
            QueueList { queued, steer: working && on_steer.is_some(), on_unqueue: move |x| if let Some(h) = &on_unqueue { h.call(x) }, on_steer: move |k| if let Some(h) = &on_steer { h.call(k) } }
        }
        form { class: "compose glass", "aria-label": "Message {to}",
            onsubmit: move |e| {
                e.prevent_default();
                on_send.call(());
            },
            if open {
                div { class: "compose-menu", role: "listbox", id: "compose-menu", "aria-label": "Commands, names and files",
                    for (i, item) in items.into_iter().enumerate() {
                        div { key: "{item.insert}", class: if i == at { "compose-item is-chosen" } else { "compose-item" }, role: "option", id: "compose-item-{i}",
                            "aria-selected": if i == at { "true" } else { "false" },
                            onmousedown: move |e| e.prevent_default(),
                            onclick: { let item = item.clone(); move |_| { let next = apply(&value.peek(), &item); value.set(next); chosen.set(0); } },
                            span { class: "compose-item-label", "{item.label}" }
                            span { class: "compose-item-detail", "{item.detail}" }
                        }
                    }
                }
            }
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
                placeholder: "Message {to}  ·  / commands  @ names  # files  $ skills",
                aria_label: "Message {to}",
                oninput: move |e: FormEvent| { value.set(e.value()); back.set(None); chosen.set(0); },
                onkeydown: move |e: KeyboardEvent| {
                    let m = e.modifiers();
                    let cmd = m.meta() || m.ctrl();
                    let key = e.key();
                    // mod+S puts the words aside, or brings the last ones back; mod+shift+D listens.
                    if cmd && matches!(&key, Key::Character(c) if c.eq_ignore_ascii_case("s")) && !m.shift() {
                        e.prevent_default();
                        let text = value.peek().clone();
                        if let Some(h) = &on_stash { h.call(if text.trim().is_empty() { None } else { Some(text) }) }
                        return;
                    }
                    if cmd && m.shift() && matches!(&key, Key::Character(c) if c.eq_ignore_ascii_case("d")) {
                        e.prevent_default();
                        if let Some(h) = &on_voice { h.call(()) }
                        return;
                    }
                    if open && !e.is_composing() {
                        let n = keys_items.len();
                        match key {
                            Key::ArrowDown => { e.prevent_default(); chosen.set((at + 1) % n); document::eval(&format!("document.getElementById('compose-item-{}')?.scrollIntoView({{block:'nearest'}})", (at + 1) % n)); return; }
                            Key::ArrowUp => { e.prevent_default(); chosen.set((at + n - 1) % n); document::eval(&format!("document.getElementById('compose-item-{}')?.scrollIntoView({{block:'nearest'}})", (at + n - 1) % n)); return; }
                            Key::Escape => { e.prevent_default(); shut.set(value.peek().clone()); return; }
                            Key::Enter | Key::Tab if !m.shift() => {
                                if let Some(item) = &picked {
                                    // A command that takes nothing runs at once; any other pick is written in.
                                    let next = apply(&value.peek(), item);
                                    let whole = item.insert.starts_with('/') && crate::ui::features::compose::COMMANDS.iter().any(|c| format!("/{}", c.name) == item.insert && c.takes.is_empty());
                                    e.prevent_default();
                                    value.set(if whole { next.trim_end().to_string() } else { next });
                                    chosen.set(0);
                                    if whole && key == Key::Enter { on_send.call(()); }
                                    return;
                                }
                            }
                            _ => {}
                        }
                    }
                    // ArrowUp in an empty composer: the prompts sent before, newest first.
                    if (key == Key::ArrowUp || key == Key::ArrowDown) && (value.peek().is_empty() || back.peek().is_some()) && !m.shift() {
                        let to = recalled(&asked, back(), key == Key::ArrowUp);
                        if to.is_some() || back().is_some() {
                            e.prevent_default();
                            back.set(to);
                            value.set(to.and_then(|i| asked.get(i).cloned()).unwrap_or_default());
                        }
                        return;
                    }
                    // Enter sends; Shift+Enter is a new line; Enter while a word is still being
                    // composed (an input method) belongs to that word.
                    if key == Key::Enter && !m.shift() && !e.is_composing() {
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
                            span { class: "visually-hidden", "Attach images, recordings, videos or texts. {LIMITS}" }
                            input { class: "visually-hidden", r#type: "file", multiple: true, accept: "image/*,audio/*,video/*,.txt,.md,.csv,.json", onchange: move |e| attach.call(e) }
                        }
                        TooltipContent { class: "compose-limits", "{LIMITS}" }
                    }
                }
                if let Some(word) = permit {
                    PermitPick { mode: word, on_pick: move |m| if let Some(h) = &on_permit { h.call(m) } }
                }
                if let Some(choice) = model {
                    ModelPick { choice, on_pick: move |name| if let Some(h) = &on_model { h.call(name) } }
                }
                if let Some(listening) = voice {
                    Button { variant: ButtonVariant::Ghost, size: ButtonSize::Icon, class: if listening { "compose-voice is-listening" } else { "compose-voice" }, aria_pressed: listening,
                        aria_label: if listening { "Stop listening" } else { "Speak (mod+shift+D)" }, title: if listening { "Listening… press to stop" } else { "Speak into the message (mod+shift+D)" },
                        onclick: move |_| if let Some(h) = &on_voice { h.call(()) },
                        Icon { name: "mic", size: 18 }
                    }
                }
                if stashed > 0 {
                    Button { variant: ButtonVariant::Ghost, size: ButtonSize::Sm, class: "compose-stash", title: "Bring back what was put aside (mod+S in an empty composer)", onclick: move |_| if let Some(h) = &on_stash { h.call(None) },
                        Icon { name: "archive", size: 14 } "{stashed} put aside"
                    }
                }
                span { class: "compose-hint", "aria-hidden": "true", Kbd { "Enter" } if waits { " queues" } else { " sends" } span { class: "sep", "·" } Kbd { "↑" } " last prompt" span { class: "sep", "·" } Kbd { "⌘S" } " put aside" }
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
/// on it again and a way to take it back, and (`steer`) a way to send it into the work in hand.
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
                            Button { variant: ButtonVariant::Ghost, size: ButtonSize::Sm, class: "queue-steer", aria_label: "Steer: send this into the run in hand", title: "Steer: the run in hand reads it at its very next step", onclick: move |_| on_steer.call(q.key),
                                Icon { name: "send", size: 14 } span { "Steer" }
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

/// Which model this engine uses: its own, or the default. A pick writes its own; "the default"
/// lets it follow the default again.
#[component]
pub fn ModelPick(choice: ModelChoice, on_pick: EventHandler<String>) -> Element {
    if choice.models.is_empty() {
        return rsx! {};
    }
    let follows = choice.own.is_empty();
    rsx! {
        label { class: if follows { "model-pick" } else { "model-pick is-own" }, title: if follows { "This engine follows the default model; choose one to name its own (engine.json)" } else { "This engine names its own model (engine.json)" },
            Icon { name: "cube", size: 14 }
            span { class: "visually-hidden", "Model of this engine" }
            select { class: "model-select",
                onchange: move |e| on_pick.call(e.value()),
                option { value: "", selected: follows, "Default ({choice.default})" }
                for m in choice.models.iter() {
                    option { key: "{m}", value: "{m}", selected: *m == choice.own, "{m}" }
                }
            }
        }
    }
}

/// What the engine may do without asking: ask every time, allow edits, allow all.
#[component]
pub fn PermitPick(mode: String, on_pick: EventHandler<String>) -> Element {
    rsx! {
        label { class: if mode == "all" { "model-pick permit-pick is-all" } else { "model-pick permit-pick" }, title: "What it may do without asking you (kept with this engine)",
            Icon { name: "shield", size: 14 }
            span { class: "visually-hidden", "Permission mode" }
            select { class: "model-select", id: "permit-select",
                onchange: move |e| on_pick.call(e.value()),
                for (word, says) in [("ask", "Ask every time"), ("edits", "Allow edits"), ("all", "Allow all")] {
                    option { key: "{word}", value: "{word}", selected: mode == word, "{says}" }
                }
            }
        }
    }
}
