//! The dashboard shell's own parts: the two panel switches, and how the three
//! regions answer the viewport and the keyboard. The boot plumbing is
//! `adopt.rs`, split out for the 200-line rule (I12).
//!
//! Increment 13. Both skins were a scroll of everything — the machine skin
//! stacked nine panels below 1100px and the plain skin stacked them at every
//! width — so neither had a place to STAND. A dashboard has three regions and
//! two of them are dismissable: navigation left, the surface you are working on
//! in the middle, the instruments right.
//!
//! Collapse is expressed as the `hidden` attribute, not a stylesheet class, for
//! the reason `[hidden] { display: none !important }` already exists in
//! screen.css: it works with the machine layer switched off. The plain skin is
//! the permanent fallback, and a fallback that cannot put the rail away is the
//! thing this increment was called to fix.

use dioxus::prelude::*;
use wasm_bindgen::prelude::*;

use crate::ui::Button;

/// The viewport's width, or the console breakpoint when the page has no window
/// to ask (a Worker). One reader, because `follow_width` needs the NUMBER and
/// not only the side of the threshold it falls on (R11-11).
fn viewport() -> f64 {
    web_sys::window()
        .and_then(|w| w.inner_width().ok())
        .and_then(|v| v.as_f64())
        .unwrap_or(1100.0)
}

/// Whether this screen has room for three columns at all. Read ONCE, as the
/// initial state of each panel: below the console breakpoint the regions stack,
/// so opening both by default is the scroll-of-everything by another name.
pub fn wide() -> bool {
    viewport() >= 1100.0
}

/// Keep the DEFAULT honest across a resize, and a CHOICE untouched by one
/// (R2-3).
///
/// `wide()` was read once, at first render, so that a resize could not overwrite
/// a person's decision to fold or unfold a panel. That intent is right and it
/// is kept. What it also did was freeze a default nobody had chosen: open a
/// laptop-width window, narrow it to a phone, and the seven-item sidebar was
/// still stacked down the page — 660px of furniture above the task field, which
/// sat at y=986 in an 844px viewport (measured, walk 16b).
///
/// So the width leads until the person speaks — WITHIN ONE LAYOUT. `chosen`
/// flips on the first press of either switch and this listener stops writing…
/// until the viewport crosses the breakpoint, which is a different layout with
/// different room in it, and a decision made in one is not a decision about the
/// other. Without that reset, going 1440 → 390 → 1440 left the side panel
/// folded by the narrow default and nothing brought it back, on views whose
/// header carries no rail switch at all (R3-22).
///
/// …AND A SHEET IS NOT A PANEL, SO IT DOES NOT SURVIVE A RESIZE AT ALL
/// (R11-11). Below 1100 the nav is not a column beside the page, it is an
/// overlay ON TOP of it, and `chosen` was protecting the open state of an
/// overlay across widths: opening the sheet at 390 and dragging out to 800 left
/// it covering `Run a task · main` whole, with `✕ Close` the only way to reach
/// anything. Choosing to cover THIS viewport is not choosing to cover the next
/// one — the same argument `crossed` already makes, applied one layout down. So
/// the sheet closes on any real width change, ahead of the `chosen` guard.
///
/// Only on a real WIDTH change: a mobile browser fires `resize` every time its
/// URL bar slides, and closing the sheet under someone's thumb for that would
/// be the same defect wearing the fix.
///
/// Registered once, `forget` for the same reason `listen` does it — the shell
/// outlives the document.
pub fn follow_width(mut nav: Signal<bool>, mut rail: Signal<bool>, mut chosen: Signal<bool>) {
    let Some(w) = web_sys::window() else { return };
    let mut layout = wide();
    let mut was = viewport();
    let cb = Closure::<dyn FnMut()>::new(move || {
        let width = viewport();
        if width == was {
            return;
        }
        was = width;
        let now = width >= 1100.0;
        let crossed = now != layout;
        layout = now;
        if !now && nav.peek().to_owned() {
            nav.set(false);
        }
        if chosen.peek().to_owned() && !crossed {
            return;
        }
        if crossed {
            chosen.set(false);
        }
        if *nav.peek() != now {
            nav.set(now);
        }
        if *rail.peek() != now {
            rail.set(now);
        }
    });
    let _ = w.add_event_listener_with_callback("resize", cb.as_ref().unchecked_ref());
    cb.forget();
}

/// ESCAPE CLOSES THE SHEET (R4-15).
///
/// Below 1100px the navigation is a fixed sheet over the content — it covers
/// the surface you were working on, by design, and choosing a view puts it away
/// (`views::ViewNav`). The one way out that a person tries first did nothing:
/// Escape is the universal dismissal for anything that covers the page, and
/// without it the only exit was to find the switch again behind the sheet.
///
/// On the DOCUMENT, not on the region: opening the sheet moves no focus, so a
/// handler on `<nav>` would never see the key. It closes nothing when the sheet
/// is already shut, and nothing above the breakpoint, where the nav is a column
/// in the grid rather than an overlay.
///
/// Registered once, `forget` for the same reason `follow_width` does it.
pub fn close_on_escape(mut nav: Signal<bool>) {
    let Some(w) = web_sys::window() else { return };
    let cb = Closure::<dyn FnMut(web_sys::KeyboardEvent)>::new(move |e: web_sys::KeyboardEvent| {
        if e.key() == "Escape" && !wide() && nav.peek().to_owned() {
            nav.set(false);
        }
    });
    let _ = w.add_event_listener_with_callback("keydown", cb.as_ref().unchecked_ref());
    cb.forget();
}

/// One panel switch. `aria-expanded` + `aria-controls` is the disclosure
/// pattern, and the LABEL IS A VERB naming the outcome: "▾ Views" sat beside
/// two other nouns in the header, so it read as "open a menu of views" while
/// it actually deleted the navigation, and once folded nothing on the page
/// said the word again (F4). "Hide sidebar" / "Show sidebar" says which of the
/// two presses you are about to make, and the folded state is a control that
/// is still on screen and still says what it does.
///
/// The caret is gone with the noun: `▸` now means "this expands" and nothing
/// else (F17), and a verb that names the outcome needs no marker anyway.
#[component]
pub fn PanelToggle(
    /// What the switch shows or hides, lowercase, as it reads in the sentence.
    noun: String,
    controls: String,
    open: Signal<bool>,
    /// "A person has now decided." Flipped on the first press, read by
    /// `follow_width`, which stops following the viewport once it is true.
    chosen: Option<Signal<bool>>,
) -> Element {
    // A switch for a region that is not on this view is not rendered at all
    // (R2-12). It used to render DISABLED, with the reason as its label — a
    // dead control in the header's prime space on four views of seven.
    let label = match open() {
        true => format!("Hide {noun}"),
        false => format!("Show {noun}"),
    };
    rsx! {
        Button {
            class: if open() { "panel-toggle open" } else { "panel-toggle" },
            aria_expanded: if open() { "true" } else { "false" },
            aria_controls: "{controls}",
            onclick: move |_| {
                if let Some(mut chosen) = chosen {
                    chosen.set(true);
                }
                let mut open = open;
                let next = !open.peek().to_owned();
                open.set(next);
            },
            "{label}"
        }
    }
}
