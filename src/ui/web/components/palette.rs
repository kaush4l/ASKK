//! "Go to anything", and the list of shortcuts: the two things a key opens over the page.
//!
//! [`Palette`] is given every entry there is (`ui/features/palette.rs`) and whether it is
//! open. It keeps what is typed and which line the arrows are on, and says what was chosen.
//! [`Shortcuts`] is given the keys and their words (`ui/features/keys.rs`).
//!
//! For a screen reader the palette is a combobox over a listbox: the field keeps the focus,
//! the arrows move `aria-activedescendant`, and how many lines answer is said as it changes.
use super::Icon;
use crate::ui::features::keys::{shown, ALSO, KEYS};
use crate::ui::features::palette::{find, step, Entry, Pick};
use crate::ui::web::kit::{Button, ButtonSize, ButtonVariant, Dialog, DialogTitle, Kbd};
use dioxus::prelude::*;

#[component]
pub fn Palette(open: bool, entries: Vec<Entry>, on_pick: EventHandler<Pick>, on_close: EventHandler<()>) -> Element {
    let mut typed = use_signal(String::new);
    let mut at = use_signal(|| 0usize);
    // Opened again, it starts empty.
    use_effect(use_reactive!(|open| {
        if open {
            typed.set(String::new());
            at.set(0);
        }
    }));
    let hits = find(&entries, &typed());
    let n = hits.len();
    let on = at().min(n.saturating_sub(1));
    let active = hits.get(on).map(Entry::id).unwrap_or_default();
    let chosen = hits.get(on).map(|e| e.pick.clone());
    // Keep the line the arrows are on in sight.
    let mut go = move |to: usize, id: Option<String>| {
        at.set(to);
        if let Some(id) = id {
            document::eval(&format!("document.getElementById('pal-{id}')?.scrollIntoView({{ block: 'nearest' }});"));
        }
    };
    let ids: Vec<String> = hits.iter().map(Entry::id).collect();
    rsx! {
        Dialog { open, aria_label: "Go to anything", class: "glass palette", on_close: move |_| on_close.call(()),
            div { class: "palette-field",
                Icon { name: "search", size: 18 }
                input { class: "palette-input", id: "palette-input", r#type: "text", "data-autofocus": "true", "autocomplete": "off", "spellcheck": "false",
                    role: "combobox", "aria-expanded": "true", "aria-controls": "palette-list", "aria-autocomplete": "list",
                    "aria-activedescendant": if active.is_empty() { None } else { Some(format!("pal-{active}")) },
                    "aria-label": "Go to a session, a page, or an action", placeholder: "Go to a session, a page, or do something",
                    value: "{typed}",
                    oninput: move |e| {
                        typed.set(e.value());
                        at.set(0);
                    },
                    onkeydown: move |e: KeyboardEvent| {
                        let to = match e.key() {
                            Key::ArrowDown => Some(step(on, n, true)),
                            Key::ArrowUp => Some(step(on, n, false)),
                            Key::Home => Some(0),
                            Key::End => Some(n.saturating_sub(1)),
                            Key::Enter => {
                                e.prevent_default();
                                if let Some(p) = chosen.clone() {
                                    on_pick.call(p);
                                }
                                None
                            }
                            _ => None,
                        };
                        if let Some(to) = to {
                            e.prevent_default();
                            go(to, ids.get(to).cloned());
                        }
                    },
                }
                Kbd { "Esc" }
            }
            ul { class: "palette-list", id: "palette-list", role: "listbox", "aria-label": "What answers",
                for (i, e) in hits.iter().enumerate() {
                    if i == 0 || hits[i - 1].group != e.group {
                        li { class: "palette-group", role: "presentation", "{e.group}" }
                    }
                    li { id: "pal-{e.id()}", class: if i == on { "palette-item is-on" } else { "palette-item" }, role: "option", "aria-selected": "{i == on}",
                        onpointermove: move |_| if at() != i { at.set(i) },
                        onclick: { let p = e.pick.clone(); move |_| on_pick.call(p.clone()) },
                        span { class: "palette-label", "{e.label}" }
                        if !e.hint.is_empty() { span { class: "palette-hint", "{e.hint}" } }
                        if !e.keys.is_empty() { span { class: "palette-keys", "aria-hidden": "true", for k in e.keys.iter() { Kbd { key: "{k}", "{k}" } } } }
                    }
                }
            }
            if n == 0 { p { class: "palette-empty", "Nothing answers “{typed}”." } }
            p { class: "visually-hidden", role: "status", "aria-live": "polite", if n == 1 { "1 line answers" } else { "{n} lines answer" } }
        }
    }
}

/// Every shortcut, with the keys as this machine names them.
#[component]
pub fn Shortcuts(open: bool, #[props(default)] mac: bool, on_close: EventHandler<()>) -> Element {
    rsx! {
        Dialog { open, aria_label: "Keyboard shortcuts", class: "glass shortcuts", on_close: move |_| on_close.call(()),
            header { class: "shortcuts-head",
                DialogTitle { "Keyboard shortcuts" }
                Button { variant: ButtonVariant::Ghost, size: ButtonSize::Icon, aria_label: "Close", onclick: move |_| on_close.call(()), Icon { name: "close", size: 18 } }
            }
            dl { class: "shortcuts-list",
                for s in KEYS {
                    div { key: "{s.key}",
                        dt { for k in shown(s, mac) { Kbd { key: "{k}", "{k}" } } }
                        dd { "{s.says}" }
                    }
                }
                for (keys, says) in ALSO {
                    div { key: "{keys}",
                        dt { for k in keys.split(' ') { Kbd { key: "{k}", "{k}" } } }
                        dd { "{says}" }
                    }
                }
            }
        }
    }
}
