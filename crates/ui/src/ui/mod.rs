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

/// Move focus to an element by id. The roving tabindex in `tabs.rs` needs it
/// (the newly selected tab is the only one in the tab order, so focus has to
/// follow it), and so does every `EmptyState` whose one action is "go and put
/// something in this region" — the composer and the agent-name field are the
/// two places anything on this page starts.
///
/// It lived in `tabs.rs` as a private fn; it is here because it now has two
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

/// The id of the composer's field. The one place a turn starts, so it is the
/// action on every empty state in the rail: a tool call, a board row, a shell
/// run and a shared fact are all things a TURN produces, and saying "send a
/// message" is the honest answer to "what would put something here".
pub(crate) const COMPOSER_ID: &str = "composer-field";

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
