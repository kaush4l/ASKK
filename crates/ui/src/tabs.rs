//! The agent switcher, as a real ARIA tablist.
//!
//! It was a `<nav>` of buttons with `aria-current`: navigable, but not
//! conventional — `ArrowRight` did nothing, every tab was in the tab order, and
//! a screen-reader user heard "button, main" where the pattern promises "tab, 1
//! of 3, selected" (`ux-walker`, increment 07b). This is the WAI-ARIA tabs
//! pattern instead: roving tabindex, arrows with wrap-around, Home and End, and
//! automatic activation (selection follows focus, which is what a tab strip
//! this small should do).
//!
//! It also answers "which one am I in?" with NO STYLESHEET AT ALL. `aria-*`
//! gets no UA styling, so all three tabs looked identical in the plain
//! fallback and only the heading told you where you were; the marker and the
//! `<strong>` below are visible with every stylesheet off, permanently.

use dioxus::prelude::*;

/// Move focus to a tab by id. The roving tabindex means the newly selected tab
/// is the only one in the tab order, so focus has to follow it or the next Tab
/// press leaves the strip from a control that is no longer reachable.
fn focus(name: &str) {
    let Some(element) = web_sys::window()
        .and_then(|w| w.document())
        .and_then(|d| d.get_element_by_id(&format!("tab-{name}")))
    else {
        return;
    };
    use wasm_bindgen::JsCast;
    if let Some(html) = element.dyn_ref::<web_sys::HtmlElement>() {
        let _ = html.focus();
    }
}

/// Where a key press lands, given where it started. `None` is a key this strip
/// does not own — every other key must reach the browser untouched.
fn target(key: &Key, at: usize, count: usize) -> Option<usize> {
    match key {
        Key::ArrowRight => Some((at + 1) % count),
        Key::ArrowLeft => Some((at + count - 1) % count),
        Key::Home => Some(0),
        Key::End => Some(count - 1),
        _ => None,
    }
}

/// Who you are talking to, and how to talk to somebody else. One tab per loaded
/// agent; the selected one is what `ChatPane` is the conversation with.
#[component]
pub fn AgentTabs(loaded: Signal<Vec<String>>, selected: Signal<String>) -> Element {
    let names = loaded.read().clone();
    let current = selected.read().clone();
    rsx! {
        div { class: "agent-tabs", role: "tablist", aria_label: "Which agent to talk to",
            for (index, name) in names.iter().cloned().enumerate() {
                {
                    let mine = name == current;
                    let (names, name_for_key, name_for_click) =
                        (names.clone(), name.clone(), name.clone());
                    rsx! {
                        button {
                            r#type: "button",
                            key: "{name}",
                            id: "tab-{name}",
                            role: "tab",
                            class: if mine { "tab current" } else { "tab" },
                            aria_selected: if mine { "true" } else { "false" },
                            aria_controls: "chat-panel",
                            // Roving: exactly one tab is in the page's tab
                            // order, and arrows move between them.
                            tabindex: if mine { "0" } else { "-1" },
                            onkeydown: move |event: KeyboardEvent| {
                                let Some(next) = target(&event.key(), index, names.len()) else {
                                    return;
                                };
                                event.prevent_default();
                                let mut selected = selected;
                                selected.set(names[next].clone());
                                focus(&names[next]);
                            },
                            onclick: move |_| {
                                let mut selected = selected;
                                selected.set(name_for_click.clone());
                            },
                            // Visible with the stylesheet off: the marker and
                            // the bold name are UA-styled, `aria-selected` is
                            // not, and the fallback skin is permanent.
                            if mine {
                                span { aria_hidden: "true", "▸ " }
                                strong { "{name_for_key}" }
                            } else {
                                "{name_for_key}"
                            }
                        }
                    }
                }
            }
        }
    }
}
