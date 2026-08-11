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

/// The deck's own tab id. Its own constant rather than `tab-{name}` so an agent
/// somebody names `setup` cannot collide with it.
const DECK_ID: &str = "deck-tab";

/// Move focus to a tab by id. The roving tabindex means the newly selected tab
/// is the only one in the tab order, so focus has to follow it or the next Tab
/// press leaves the strip from a control that is no longer reachable.
fn focus(id: &str) {
    let Some(element) = web_sys::window()
        .and_then(|w| w.document())
        .and_then(|d| d.get_element_by_id(id))
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
        // The strip is a COLUMN from increment 13 (the left panel), so the
        // vertical pair is the one the ARIA pattern requires; the horizontal
        // pair stays because a person who learned it in 07b still has it.
        Key::ArrowDown | Key::ArrowRight => Some((at + 1) % count),
        Key::ArrowUp | Key::ArrowLeft => Some((at + count - 1) % count),
        Key::Home => Some(0),
        Key::End => Some(count - 1),
        _ => None,
    }
}

/// Route to tab `next`: an agent, or — one past the end — the deck.
fn go(next: usize, names: &[String], mut selected: Signal<String>, mut deck: Signal<bool>) {
    match names.get(next) {
        Some(name) => {
            deck.set(false);
            selected.set(name.clone());
            focus(&format!("tab-{name}"));
        }
        None => {
            deck.set(true);
            focus(DECK_ID);
        }
    }
}

/// Who you are talking to, and how to talk to somebody else. One tab per loaded
/// agent; the selected one is what `ChatPane` is the conversation with.
#[component]
pub fn AgentTabs(
    loaded: Signal<Vec<String>>,
    /// Which of them this browser holds rather than this deploy. A tab was a
    /// bare name, so an agent a MODEL wrote — possibly holding a `space:`,
    /// which is a real root shell — was indistinguishable from a shipped one
    /// at the point you pick it (12 walk). The sentence itself is in the
    /// conversation's own header; this is the mark that sends you to it.
    authored: ReadSignal<Vec<String>>,
    selected: Signal<String>,
    /// The fourth region. Write an agent, Agents and Settings used to be a row
    /// UNDER the console, so the page was one screen sitting on a 1400px
    /// manual: you scrolled off the instrument to reach them, in the vocabulary
    /// 12c had just spent itself replacing (12c walk, finding 1). They are a
    /// tab now — same strip, same roving tabindex, same arrows.
    deck: Signal<bool>,
) -> Element {
    let names = loaded.read().clone();
    let current = selected.read().clone();
    let written = authored.read().clone();
    let on_deck = deck();
    let count = names.len() + 1;
    rsx! {
        div {
            class: "agent-tabs",
            role: "tablist",
            // It is a column now, and a screen reader is told so — the arrow
            // keys it announces have to be the ones that actually work.
            aria_orientation: "vertical",
            aria_label: "Which agent to talk to",
            for (index, name) in names.iter().cloned().enumerate() {
                {
                    let mine = !on_deck && name == current;
                    let here = written.contains(&name);
                    let (names, click_names, name_for_key) =
                        (names.clone(), names.clone(), name.clone());
                    rsx! {
                        button {
                            r#type: "button",
                            key: "{name}",
                            id: "tab-{name}",
                            role: "tab",
                            class: if mine { "tab current" } else { "tab" },
                            "data-origin": if here { "authored" } else { "shipped" },
                            aria_selected: if mine { "true" } else { "false" },
                            aria_controls: "chat-panel",
                            // Roving: exactly one tab is in the page's tab
                            // order, and arrows move between them.
                            tabindex: if mine { "0" } else { "-1" },
                            onkeydown: move |event: KeyboardEvent| {
                                let Some(next) = target(&event.key(), index, count) else {
                                    return;
                                };
                                event.prevent_default();
                                go(next, &names, selected, deck);
                            },
                            onclick: move |_| go(index, &click_names, selected, deck),
                            // Visible with the stylesheet off: the marker and
                            // the bold name are UA-styled, `aria-selected` is
                            // not, and the fallback skin is permanent.
                            if mine {
                                span { aria_hidden: "true", "▸ " }
                                strong { "{name_for_key}" }
                            } else {
                                "{name_for_key}"
                            }
                            // In WORDS, so it survives the stylesheet being
                            // off and reaches a screen reader as part of the
                            // tab's own name — a coloured edge would say
                            // nothing to either.
                            if here {
                                span { class: "tab-origin", " · written here" }
                            }
                        }
                    }
                }
            }
            // The fourth region, last in the strip because it is what you do
            // BETWEEN turns. Same roving tabindex, same arrows, same Home/End —
            // `count` above already includes it.
            {
                let names = names.clone();
                rsx! {
                    button {
                        r#type: "button",
                        id: DECK_ID,
                        role: "tab",
                        class: if on_deck { "tab current" } else { "tab" },
                        aria_selected: if on_deck { "true" } else { "false" },
                        aria_controls: "deck-panel",
                        tabindex: if on_deck { "0" } else { "-1" },
                        onkeydown: move |event: KeyboardEvent| {
                            let Some(next) = target(&event.key(), count - 1, count) else {
                                return;
                            };
                            event.prevent_default();
                            go(next, &names, selected, deck);
                        },
                        onclick: move |_| {
                            let mut deck = deck;
                            deck.set(true);
                        },
                        if on_deck {
                            span { aria_hidden: "true", "▸ " }
                            strong { "Setup" }
                        } else {
                            "Setup"
                        }
                    }
                }
            }
        }
    }
}
