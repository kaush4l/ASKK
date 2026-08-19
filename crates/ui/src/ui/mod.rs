//! The component library (DESIGN.md §8). One implementation each, one file
//! each, and every screen goes through them.
//!
//! Before this module the shell hand-rolled 8 `section.panel`, 15 raw
//! `button`, 4 raw `details`, 4 raw `form` and 6 raw `input` (audit.md,
//! "Component inventory"). Nothing was WRONG with any one of them; the problem
//! is that a change to what a card is costs eight edits, so it never happens
//! and the eight drift. These components emit exactly the class names the
//! stylesheet and `scripts/layout-audit.js` already key off — `panel`, `msg`,
//! `agent-row`, `tool-call`, `tab` — they just emit them from one place.
//!
//! Every component takes `#[props(extends = ...)]`, so a call site keeps every
//! accessibility affordance it already had: `role`, `aria-selected`,
//! `aria-expanded`, `aria-controls`, `aria-label`, `tabindex` and the `hidden`
//! attribute that IS the app's fold and route mechanism all pass straight
//! through. Not one of them was dropped in the consolidation; each was won by
//! a walk and the props are shaped so losing one takes an edit, not an
//! omission.

use dioxus::prelude::{Key, KeyboardEvent, ModifiersInteraction};

mod badge;
mod button;
mod card;
mod disclose;
mod empty;
mod field;
mod form;
mod select;
mod skeleton;

pub(crate) use badge::Badge;
pub(crate) use button::Button;
pub(crate) use card::Card;
pub(crate) use disclose::Disclosure;
pub(crate) use empty::EmptyState;
pub(crate) use field::Field;
pub(crate) use form::Form;
pub(crate) use select::SelectField;
pub(crate) use skeleton::Skeleton;

/// Move focus to an element by id. The roving tabindex in `shell/agent_switcher.rs` needs it
/// (the newly selected tab is the only one in the tab order, so focus has to
/// follow it), and so does every `EmptyState` whose one action is "go and put
/// something in this region" — the composer and the agent-name field are the
/// two places anything on this page starts.
///
/// It lived in `shell/agent_switcher.rs` as a private fn; it is here because it now has two
/// callers, and a second copy is how the first one starts drifting.
pub(crate) fn focus(id: &str) {
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

/// ENTER SENDS, SHIFT+ENTER BREAKS THE LINE (R4-4).
///
/// The two fields a turn starts from are `<textarea>` now — the product's
/// primary input was a 44px single-line box in which a 3,000-character
/// instruction scrolled sideways to 21,598px and showed about ninety
/// characters. A textarea in a form does not submit on Enter, so the Enter
/// behaviour a form gave for free has to be given back by hand; this is the
/// one place it is spelled, so the two fields cannot drift apart.
///
/// Returns true when the caller should submit and swallow the key.
pub(crate) fn enter_submits(event: &KeyboardEvent) -> bool {
    event.key() == Key::Enter && !event.modifiers().shift()
}

/// THE KEYBINDING, ON SCREEN (R5-5). Enter starts a real run from a field
/// whose own placeholder asks for a multi-line instruction, and nothing said
/// so — a critic launched one by accident. One `<p>` under both fields that
/// bind `enter_submits`, next to the fn that decides it, so a change to the
/// binding and a change to the sentence are one edit.
pub(crate) fn key_hint() -> dioxus::prelude::Element {
    use dioxus::prelude::*;
    rsx! {
        p { class: "hint",
            kbd { "⏎" }
            " starts it · "
            kbd { "⇧⏎" }
            " for a new line"
        }
    }
}

/// Bring the LAST match of a selector into view, aligned to the bottom of
/// whichever ancestor is scrolling it. `route::newest_turn` does exactly this
/// for the conversation; R4-12 needed it for the tool trace, and the second
/// copy is how the first one starts drifting.
///
/// THE LIST FIRST, THE PAGE ONLY IF IT MUST (R8-5). `scrollIntoView` moves
/// EVERY scrolling ancestor, so the trace bringing its newest call into view
/// also dragged the rail 257px down and cut the heading off the panel above it.
/// When the list is a scrollport of its own — which `#tool-trace` and
/// `#terminal` both are in the rail — scrolling it to its end shows the same
/// row and moves nothing outside the panel. When it is not (the Trace VIEW,
/// where the stage scrolls), this is the call it always was.
/// Put the newest output where it can be read (10 walk, finding 1): the pane
/// is a fixed-height scroller and nothing ever moved it, so a command's answer
/// was LESS visible after it finished than while it ran — 1300px below the
/// fold, with `scrollTop` still 0. Not application logic (I5): it is a scroll
/// position, set from Rust. Takes the element by id because the conversation
/// became a scroller of its own in 12c with exactly the same problem.
pub(crate) fn show_newest(id: &str) {
    if let Some(pane) = web_sys::window()
        .and_then(|w| w.document())
        .and_then(|d| d.get_element_by_id(id))
    {
        pane.set_scroll_top(pane.scroll_height());
    }
}

/// …ONCE THE DOM HAS CAUGHT UP, and on every change rather than on the ones a
/// person caused (R14-P1-5). Both traces render the log oldest-first — the rule
/// `core::terminal::row_selection` states — and they still read in opposite directions,
/// because the Tool trace scrolled to its newest row whenever its projection
/// changed while the Commands pane scrolled only for a command the PERSON
/// typed: `scrollTop: 0` over 1416px of scrollback after a reload, measured, so
/// the only rows reliably in view there were the user's own. That was the
/// exception, and this is both panes following one rule instead.
pub(crate) fn show_newest_soon(id: &'static str) {
    dioxus::prelude::spawn(async move {
        let _ = adapters_web::sleep(30).await;
        show_newest(id);
    });
}

pub(crate) fn show_last(selector: &str) {
    let Some(last) = web_sys::window()
        .and_then(|w| w.document())
        .and_then(|d| d.query_selector(selector).ok().flatten())
    else {
        return;
    };
    if let Some(list) = last.parent_element() {
        if list.scroll_height() > list.client_height() {
            list.set_scroll_top(list.scroll_height());
            return;
        }
    }
    last.scroll_into_view_with_bool(false);
}

/// The id of the composer's field. The one place a turn starts, so it is the
/// action on every empty state in the rail: a tool call, a board row, a shell
/// run and a shared fact are all things a TURN produces, and saying "send a
/// message" is the honest answer to "what would put something here".
pub(crate) const COMPOSER_ID: &str = "composer-field";

/// A SENTENCE QUOTED INSIDE A SENTENCE (R8-11).
///
/// `"{who} is on it: “{task}”."` produced `“Say hello.”.` and `…their sum”.` —
/// a double full stop in every run-status string the product writes, because
/// the quoted text is a whole sentence carrying its own terminal mark and the
/// format string added a second one regardless. The CONSTRUCTION was the
/// defect, not the instances, so the stop is decided once, here: it belongs to
/// whichever of the two needs it.
pub(crate) fn quoted(said: &str) -> String {
    let said = said.trim();
    match said.ends_with(['.', '!', '?', '…', '"', '”']) {
        true => format!("“{said}”"),
        false => format!("“{said}”."),
    }
}

/// Whether a projection from the core contains any row at all. The core
/// renders its own sentence for an empty region; this is how a pane knows to
/// show the EmptyState — which says what the region is FOR — in its place,
/// rather than printing two different sentences about the same nothing.
///
/// It reads a CLASS NAME the core already writes and the stylesheet already
/// keys off, the same way `terminal::commands_in` reads `data-commands`. That
/// is not the view-scraping this codebase refuses: it is one bit, and the
/// alternative is a second copy of every empty sentence.
pub(crate) fn has_rows(html: &str, row_class: &str) -> bool {
    html.contains(row_class)
}

#[cfg(test)]
mod tests {
    /// R8-11: one terminal stop, whoever owns it.
    #[test]
    fn a_quoted_sentence_takes_one_full_stop() {
        assert_eq!(super::quoted("Say hello."), "“Say hello.”");
        assert_eq!(super::quoted("Say hello"), "“Say hello”.");
        assert_eq!(super::quoted("  Are you there?  "), "“Are you there?”");
        assert_eq!(super::quoted("… their sum"), "“… their sum”.");
    }
}
