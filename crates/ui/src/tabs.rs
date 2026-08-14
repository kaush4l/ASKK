//! The agent switcher, as a real ARIA tablist.
//!
//! It was a `<nav>` of buttons with `aria-current`: navigable, but not
//! conventional — `ArrowRight` did nothing, every tab was in the tab order, and
//! a screen-reader user heard "button, main" where the pattern promises "tab, 1
//! of 3, selected" (`ux-walker`, increment 07b). This is the WAI-ARIA tabs
//! pattern instead: roving tabindex, arrows with wrap-around, Home and End, and
//! — since R4-10 — MANUAL activation: the arrows move focus and Enter or Space
//! selects, because switching agent here re-points five surfaces at once.
//!
//! It also answers "which one am I in?" with NO STYLESHEET AT ALL. `aria-*`
//! gets no UA styling, so all three tabs looked identical in the plain
//! fallback and only the heading told you where you were; the marker and the
//! `<strong>` below are visible with every stylesheet off, permanently.

use dioxus::prelude::*;

use crate::ui::{focus, Button};

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

/// MANUAL ACTIVATION (R4-10). Arrows move FOCUS; Enter and Space select.
///
/// Selection used to follow focus, which the ARIA pattern allows only when
/// switching is cheap. Switching here re-points the header, the conversation,
/// the workspace, the shared space and the tool trace at a different agent —
/// one `ArrowRight` on a focused tab silently swapped the whole application's
/// subject, after which a first-timer concludes their history is gone. That is
/// the textbook case for manual activation.
///
/// Enter and Space need no code: these are real `<button>` elements, so both
/// keys already fire `onclick`, which is the one selection path.
fn focus_tab(next: usize, names: &[String]) {
    if let Some(name) = names.get(next) {
        focus(&format!("tab-{name}"));
    }
}

/// Route to tab `next`. Every entry is an agent now: Setup was the last tab in
/// this strip and is a VIEW (Agents, Settings), which is what took the strip
/// back to the one job its `role="tablist"` always claimed.
fn go(next: usize, names: &[String], mut selected: Signal<String>) {
    if let Some(name) = names.get(next) {
        selected.set(name.clone());
        focus(&format!("tab-{name}"));
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
    /// WHAT this strip re-points, for the two surfaces that carry it (R3-21):
    /// the conversation in Chat, the task field on the Dashboard. Exactly ONE
    /// of them is mounted at a time (`stage.rs`), so `tab-{name}` stays a
    /// unique id and the roving tabindex keeps working — a second permanent
    /// copy would give the page two elements with every one of those ids.
    controls: Option<String>,
    label: Option<String>,
) -> Element {
    let controls = controls.unwrap_or_else(|| "chat-panel".to_string());
    let label = label.unwrap_or_else(|| "Which agent to talk to".to_string());
    let names = loaded.read().clone();
    let current = selected.read().clone();
    let written = authored.read().clone();
    let count = names.len();
    rsx! {
        div {
            class: "agent-tabs",
            role: "tablist",
            // It is a ROW now — it moved out of the left panel and into the
            // Chat view (15B) — and a screen reader is told what it is, because
            // the arrow keys it announces have to be the ones on screen. Both
            // pairs still work (`target`), so the announcement is the only
            // thing that had to follow the layout.
            aria_orientation: "horizontal",
            aria_label: "{label}",
            for (index, name) in names.iter().cloned().enumerate() {
                {
                    let mine = name == current;
                    let here = written.contains(&name);
                    let (names, click_names, name_for_key) =
                        (names.clone(), names.clone(), name.clone());
                    rsx! {
                        Button {
                            key: "{name}",
                            id: "tab-{name}",
                            role: "tab",
                            class: if mine { "tab current" } else { "tab" },
                            "data-origin": if here { "authored" } else { "shipped" },
                            aria_selected: if mine { "true" } else { "false" },
                            aria_controls: "{controls}",
                            // Roving: exactly one tab is in the page's tab
                            // order, and arrows move between them.
                            tabindex: if mine { "0" } else { "-1" },
                            onkeydown: move |event: KeyboardEvent| {
                                let Some(next) = target(&event.key(), index, count) else {
                                    return;
                                };
                                event.prevent_default();
                                focus_tab(next, &names);
                            },
                            onclick: move |_| go(index, &click_names, selected),
                            // Visible with the stylesheet off: the bold name is
                            // UA-styled, `aria-selected` is not, and the
                            // fallback skin is permanent. The `▸` that used to
                            // lead it is gone — selection is not disclosure,
                            // and that glyph also marked every collapsible
                            // section on the page (F17). Selection is now what
                            // the design language already says it is: weight,
                            // fill, and an accent edge (`controls.css`).
                            if mine {
                                strong { "{name_for_key}" }
                            } else {
                                "{name_for_key}"
                            }
                            // In WORDS, so it survives the stylesheet being
                            // off and reaches a screen reader as part of the
                            // tab's own name — a coloured edge would say
                            // nothing to either.
                            if here {
                                span {
                                    class: "tab-origin",
                                    // Glossed where the phrase is EXPLAINED,
                                    // in the Agents card's own sentence
                                    // (R7-7); here it is two words on a tab.
                                    title: "You saved this agent in this browser.",
                                    " · written here"
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
