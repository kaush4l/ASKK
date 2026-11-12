//! An attachment, drawn: its picture when it has one, what it is, what was taken from it, and
//! the steps of its sensing (how it was heard or read, how long each took).
use crate::api::Chip;
use crate::core::run::took;
use dioxus::prelude::*;

/// One attachment. `picture` is its picture as an address a page can show (a `data:` URL), or
/// empty when it has none or it has not been fetched: the view that holds the chip asks for it.
#[component]
pub fn MediaChip(chip: Chip, #[props(default)] picture: String) -> Element {
    let len = if chip.seconds > 0.0 { format!(" · {:.1}s", chip.seconds) } else { String::new() };
    let total: u64 = chip.steps.iter().map(|s| s.1).sum();
    rsx! {
        div { class: "media-chip kind-{chip.kind} st-{chip.status}",
            if !picture.is_empty() { img { class: "media-pic", src: "{picture}", alt: "{chip.name}" } }
            div { class: "media-meta",
                span { class: "media-name", title: "{chip.name}", "{chip.name}" }
                span { class: "media-state", "{chip.kind}{len} · {chip.status}" if chip.pictures > 1 { " · {chip.pictures} frames" } }
                if !chip.text.is_empty() { p { class: if chip.status == "error" { "media-text bad" } else { "media-text" }, title: "{chip.text}", "{chip.text}" } }
                if !chip.steps.is_empty() {
                    details { class: "media-steps",
                        summary { "stream · {chip.steps.len()} steps · {took(total)}" }
                        ol { for (what, ms, how) in chip.steps.iter() { li { class: if how == "ok" { "" } else { "bad" }, b { "{what}" } " {took(*ms)} · {how}" } } }
                    }
                }
            }
        }
    }
}
