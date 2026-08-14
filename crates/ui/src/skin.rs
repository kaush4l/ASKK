//! The background switch (increment 12, redefined in R5-C). The plain ground
//! is the permanent fallback AND, since R5-C, the product's default; this
//! module owns ONE bit and nothing else: whether the tinted glow is on.
//!
//! The bit used to be expressed as the ABSENCE of `data-skin` meaning glow,
//! with `plain` opted in to. That was the wrong way round. Two blurred
//! gradient blobs were the only ornament in this product and the only thing
//! that dated it, and every side-by-side — including a critic's who was
//! arguing for more ornament, not less — found the plain ground cleaner and
//! more focused. So the attribute is present by default and the STORED value
//! is now `glow`, which also makes the default and the no-JS / no-storage /
//! no-`backdrop-filter` fallback the same picture for the first time.
//!
//! NOTHING HERE RUNS BEFORE THE FIRST PAINT, and it cannot: this crate is Wasm
//! and the bundle arrives after the first frame. Worse, this component mounts
//! only while Settings is the current view, so a reload onto the Dashboard
//! painted the wrong ground until you visited Settings and came back (R3-7).
//! The saved bit is therefore applied by four lines in `web/index.html`, in
//! the `<head>`, before the body exists; this module owns the SWITCH and the
//! storage, and re-applies the same attribute on every press.
//!
//! No application logic in JS (I5): this is Rust, and it stores a preference —
//! it decides nothing about the system it is looking at.

use dioxus::prelude::*;

use crate::ui::{Button, Card};

/// Its own key namespace: the app's data lives in IndexedDB, and a preference
/// about this device's screen is not app data (I2 — it never leaves either).
const KEY: &str = "askk.skin";
const PLAIN: &str = "plain";
const GLOW: &str = "glow";

fn storage() -> Option<web_sys::Storage> {
    web_sys::window()?.local_storage().ok().flatten()
}

/// Whether the glow is on. Absent, unreadable, or storage denied all mean the
/// same thing — the plain ground — because that is what the page already
/// shows and what `index.html` painted before this component existed.
fn saved() -> bool {
    storage()
        .and_then(|s| s.get_item(KEY).ok().flatten())
        .as_deref()
        == Some(GLOW)
}

/// Put the bit where CSS can see it, and where a reload can find it again.
fn apply(glow: bool) {
    if let Some(root) = web_sys::window()
        .and_then(|w| w.document())
        .and_then(|d| d.document_element())
    {
        let _ = match glow {
            true => root.remove_attribute("data-skin").map(|_| ()),
            false => root.set_attribute("data-skin", PLAIN),
        };
    }
    if let Some(s) = storage() {
        let _ = match glow {
            true => s.set_item(KEY, GLOW),
            false => s.remove_item(KEY),
        };
    }
}

/// A toggle button, which is what this is: `aria-pressed` rather than two
/// radio buttons or a checkbox styled as a switch.
///
/// IT LOOKS LIKE ONE NOW (R5-16). It was a full-width, centre-aligned button
/// whose whole visible state was its own label — `Plain background: off`, a
/// noun phrase that changes meaning as you press it, in a shape no other
/// control in the product has. `aria-pressed` was correct underneath and
/// carried none of that to anybody looking at it. So: a real switch track with
/// the knob on the side the state is on (`controls.css`), the label a stable
/// noun, and the state as a word beside the track rather than inside the
/// label — the same rule R5-15 applied to the workspace editor's Save.
///
/// IN SETTINGS, not in the header (R2-14). The bit and its storage key are
/// unchanged, so `?skin=plain` and `data-skin="plain"` — what
/// `scripts/check-layout.sh` selects with — still reach exactly the same CSS.
#[component]
pub fn Appearance() -> Element {
    let mut glow = use_signal(saved);
    use_effect(move || apply(glow()));
    rsx! {
        // A CARD THAT HOLDS ONLY A READING COLUMN STOPS AT ONE (R7-6b). It was
        // 1136px wide round 494px of text with an empty right half — the same
        // defect the Dashboard's launcher had before it got a companion, and
        // this card has nothing to put beside itself. `reading` caps it at
        // `--column` (layout.css), which is what `--column` is for.
        Card { title: "Appearance", aria_label: "Appearance", variant: "flat reading",
            p { class: "note",
                "This page has a plain background. Turning the glow on puts a tinted light \
                 behind the panels — nothing else changes: every control, word and number is \
                 the same either way."
            }
            Button {
                class: "skin-toggle",
                variant: "secondary",
                aria_pressed: if glow() { "true" } else { "false" },
                onclick: move |_| {
                    let next = !glow.peek().to_owned();
                    glow.set(next);
                },
                span { "Background glow" }
                span { class: "toggle-state", if glow() { "on" } else { "off" } }
            }
        }
    }
}
