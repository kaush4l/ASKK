//! A session as a box: its state mark, its row in the pill, its tile on the canvas, and its
//! head when it is open.
//!
//! Each part is given the box (`core/boxes.rs`), the mark this window shows for it, where it
//! opens and whether it is pinned (`Shown`); what the words say comes from
//! `ui/features/boxes.rs`.
use super::{AskForm, Icon};
use crate::core::boxes::SessionBox;
use crate::ui::features::asks::Ask;
use crate::ui::features::boxes::{sees, Mark};
use crate::ui::web::kit::{Badge, BadgeVariant, Button, ButtonSize, ButtonVariant};
use dioxus::prelude::*;

/// A box as one window shows it: the box, its mark here, the address that opens it in place,
/// and whether the owner pinned it to the canvas.
#[derive(Clone, Debug, PartialEq)]
pub struct Shown {
    pub b: SessionBox,
    pub mark: Mark,
    pub to: String,
    pub pinned: bool,
}

/// The state of a box as one small mark: a colour and a sign, never a colour alone.
#[component]
pub fn BoxMark(mark: Mark) -> Element {
    rsx! {
        span { class: "box-mark is-{mark.key()}", role: "img", "aria-label": "{mark.word()}", title: "{mark.word()}", "{mark.sign()}" }
    }
}

/// A box as a row of the pill. Folded, the row is its mark alone; the words stay for a screen
/// reader and come out as a tip. `open`: this is the box open on the canvas.
#[component]
pub fn BoxRow(shown: Shown, #[props(default)] open: bool, on_look: EventHandler<String>) -> Element {
    let Shown { b, mark, to, pinned } = shown;
    let id = b.id.clone();
    rsx! {
        Link { to, class: if open { "nav-item box-row is-{mark.key()} active" } else { "nav-item box-row is-{mark.key()}" }, "aria-current": open.then_some("true"),
            onclick: move |_| on_look.call(id.clone()),
            BoxMark { mark }
            span { class: "label box-row-words",
                span { class: "box-row-title", "{b.title}" }
                if !b.last.is_empty() { span { class: "box-row-last", "{b.last}" } }
            }
            if pinned { span { class: "label box-row-pin", role: "img", "aria-label": "pinned", Icon { name: "pin", size: 12 } } }
            span { class: "tip", "aria-hidden": "true", "{b.title}: {mark.word()}" }
        }
    }
}

/// The button that pins a box to the canvas, or lets it go.
#[component]
fn PinButton(pinned: bool, title: String, on_pin: EventHandler<()>) -> Element {
    rsx! {
        Button { variant: ButtonVariant::Ghost, size: ButtonSize::IconSm, class: if pinned { "box-pin is-on" } else { "box-pin" }, aria_pressed: pinned,
            aria_label: "Keep {title} on the canvas", title: if pinned { "Pinned: it stays on the canvas. Press to let it go." } else { "Pin it to the canvas" },
            onclick: move |_| on_pin.call(()),
            Icon { name: "pin", size: 16 }
        }
    }
}

/// A box as a tile on the canvas: a head (mark, name, kind, place), its last line, what askk
/// knows of it at its depth, what it waits for the owner to say, and one line to speak into it.
///
/// `asks`: its open questions, when it is blocked. `sent`: what became of the last answer.
/// `waiting`: how many messages this window holds for it until it is done.
#[component]
pub fn BoxTile(
    shown: Shown,
    #[props(default)] asks: Vec<Ask>,
    #[props(default)] sent: String,
    #[props(default)] waiting: usize,
    on_look: EventHandler<String>,
    on_say: EventHandler<(String, String)>,
    on_pin: EventHandler<String>,
    on_answer: EventHandler<(String, String, String)>,
) -> Element {
    let Shown { b, mark, to, pinned } = shown;
    let mut draft = use_signal(String::new);
    let (look_id, say_id, pin_id) = (b.id.clone(), b.id.clone(), b.id.clone());
    // A terminal takes a line at once, so nothing waits for it to be done.
    let terminal = matches!(crate::ui::features::terminals::inside(&b.id), crate::ui::features::terminals::Inside::Terminal(_));
    let working = mark == Mark::Working && !terminal;
    let more = asks.len().saturating_sub(1);
    let waits = crate::ui::features::queue::heading(waiting);
    rsx! {
        article { class: "box-tile glass is-{mark.key()}", id: "tile-{b.id}", "aria-label": "{b.title}, {mark.word()}",
            header { class: "box-head",
                BoxMark { mark }
                Link { to, class: "box-title", title: "Open {b.title} here", onclick: move |_| on_look.call(look_id.clone()),
                    if !b.icon.is_empty() { span { class: "box-icon emoji", "aria-hidden": "true", "{b.icon}" } }
                    h3 { "{b.title}" }
                    span { class: "box-open-hint", "aria-hidden": "true", Icon { name: "maximize", size: 14 } }
                }
                Badge { variant: BadgeVariant::Muted, "{b.kind}" }
                PinButton { pinned, title: b.title.clone(), on_pin: move |_| on_pin.call(pin_id.clone()) }
            }
            p { class: "box-where",
                if !b.place.is_empty() { span { "in {b.place}" } }
                span { title: "how deep askk sees into this session", "askk sees {sees(b.depth)}" }
            }
            if !b.last.is_empty() && asks.is_empty() { p { class: "box-last", "{b.last}" } }
            // What it waits for is answered here, where it is seen.
            if let Some(ask) = asks.first() {
                AskForm { ask: ask.clone(), sent, small: true,
                    on_answer: { let (id, q) = (b.id.clone(), ask.question.clone()); move |a| on_answer.call((id.clone(), q.clone(), a)) },
                }
                if more > 0 { p { class: "box-more", "and {more} more: open the box to answer them" } }
            }
            dl { class: "box-facts",
                for f in b.facts.iter() {
                    div { key: "{f.label}",
                        dt { "{f.label}" }
                        dd { "{f.value}" }
                    }
                }
            }
            form { class: "box-say",
                onsubmit: move |e| {
                    e.prevent_default();
                    let text = draft().trim().to_string();
                    if !text.is_empty() {
                        on_say.call((say_id.clone(), text));
                        draft.set(String::new());
                    }
                },
                input { class: "box-say-line", r#type: "text", "aria-label": if working { "Say to {b.title}; it is sent when it is done" } else { "Say to {b.title}" },
                    placeholder: if terminal { "type a line" } else if working { "it works: what you say waits" } else { "say something" },
                    value: "{draft}", oninput: move |e| draft.set(e.value()) }
                Button { variant: ButtonVariant::Secondary, size: ButtonSize::Sm, button_type: "submit", if terminal { "Type" } else if working { "Queue" } else { "Send" } }
            }
            if waiting > 0 { p { class: "box-waiting", role: "status", Icon { name: "clock", size: 12 } "{waits}" } }
        }
    }
}

/// The head of the box that is open on the canvas: the same mark and name as its tile, what
/// kind it is and where, and the ways back. Touching the name puts the box back, as touching
/// it opened it; so does the button, and Escape.
#[component]
pub fn OpenHead(shown: Shown, back: String, on_pin: EventHandler<String>) -> Element {
    let Shown { b, mark, pinned, .. } = shown;
    let pin_id = b.id.clone();
    rsx! {
        header { class: "open-head is-{mark.key()}",
            BoxMark { mark }
            Link { to: back.clone(), class: "box-title open-title", title: "Put {b.title} back on the canvas",
                if !b.icon.is_empty() { span { class: "box-icon emoji", "aria-hidden": "true", "{b.icon}" } }
                h2 { "{b.title}" }
            }
            Badge { variant: BadgeVariant::Muted, "{b.kind}" }
            p { class: "box-where open-where",
                if !b.place.is_empty() { span { "in {b.place}" } }
                span { "askk sees {sees(b.depth)}" }
            }
            span { class: "grow" }
            PinButton { pinned, title: b.title.clone(), on_pin: move |_| on_pin.call(pin_id.clone()) }
            Link { to: back, class: "open-back", "aria-label": "Put {b.title} back on the canvas", title: "Back to the canvas (Esc)",
                Icon { name: "minimize", size: 18 }
            }
        }
    }
}
