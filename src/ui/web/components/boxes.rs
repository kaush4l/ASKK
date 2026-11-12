//! A session as a box: its state mark, its row in the pill, its tile on the canvas.
//!
//! Each part is given the box (`core/boxes.rs`), the mark this window shows for it and where
//! it opens (`Shown`); what the words say comes from `ui/features/boxes.rs`.
use crate::core::boxes::SessionBox;
use crate::ui::features::boxes::{sees, Mark};
use crate::ui::web::kit::{Badge, BadgeVariant, Button, ButtonSize, ButtonVariant};
use dioxus::prelude::*;

/// A box as one window shows it: the box, its mark here, and the page it opens to.
#[derive(Clone, Debug, PartialEq)]
pub struct Shown {
    pub b: SessionBox,
    pub mark: Mark,
    pub to: String,
}

/// The state of a box as one small mark: a colour and a sign, never a colour alone.
#[component]
pub fn BoxMark(mark: Mark) -> Element {
    rsx! {
        span { class: "box-mark is-{mark.key()}", role: "img", "aria-label": "{mark.word()}", title: "{mark.word()}", "{mark.sign()}" }
    }
}

/// A box as a row of the pill. Folded, the row is its mark alone; the words stay for a screen
/// reader and come out as a tip.
#[component]
pub fn BoxRow(shown: Shown, on_look: EventHandler<String>) -> Element {
    let Shown { b, mark, to } = shown;
    let id = b.id.clone();
    rsx! {
        Link { to, class: "nav-item box-row is-{mark.key()}", active_class: "active", onclick: move |_| on_look.call(id.clone()),
            BoxMark { mark }
            span { class: "label box-row-words",
                span { class: "box-row-title", "{b.title}" }
                if !b.last.is_empty() { span { class: "box-row-last", "{b.last}" } }
            }
            span { class: "tip", "aria-hidden": "true", "{b.title}: {mark.word()}" }
        }
    }
}

/// A box as a tile on the canvas: a head (mark, name, kind, place), its last line, what askk
/// knows of it at its depth, and one line to speak into it.
#[component]
pub fn BoxTile(shown: Shown, on_look: EventHandler<String>, on_say: EventHandler<(String, String)>) -> Element {
    let Shown { b, mark, to } = shown;
    let mut draft = use_signal(String::new);
    let (look_id, say_id) = (b.id.clone(), b.id.clone());
    let working = mark == Mark::Working;
    rsx! {
        article { class: "box-tile glass is-{mark.key()}", "aria-label": "{b.title}, {mark.word()}",
            header { class: "box-head",
                BoxMark { mark }
                Link { to, class: "box-title", onclick: move |_| on_look.call(look_id.clone()),
                    if !b.icon.is_empty() { span { class: "box-icon", "aria-hidden": "true", "{b.icon}" } }
                    h3 { "{b.title}" }
                }
                Badge { variant: BadgeVariant::Muted, "{b.kind}" }
            }
            p { class: "box-where",
                if !b.place.is_empty() { span { "in {b.place}" } }
                span { title: "how deep askk sees into this session", "askk sees {sees(b.depth)}" }
            }
            if !b.last.is_empty() { p { class: "box-last", "{b.last}" } }
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
                input { class: "box-say-line", r#type: "text", "aria-label": "Say to {b.title}", placeholder: if working { "working…" } else { "say something" },
                    disabled: working, value: "{draft}", oninput: move |e| draft.set(e.value()) }
                Button { variant: ButtonVariant::Secondary, size: ButtonSize::Sm, button_type: "submit", disabled: working, "Send" }
            }
        }
    }
}
