//! `/design-system` — every component in DESIGN.md §8, in every variant and
//! every state, over the real ground.
//!
//! It exists because there was no way to see the system whole, so drift was
//! invisible until a screen shipped: `.rail` was styled from four files across
//! nine rule blocks and nothing on any screen showed that. Critics open this
//! first, which is the point — a mockup is rejected against this page, not
//! against a memory of the app.
//!
//! Two switches, and they are the reason this is a route rather than a
//! screenshot. The SKIN switch is the product's own (the header's, reused
//! here), and the GLASS switch re-points the same tokens `@supports not
//! (backdrop-filter)` does — so the fallback is inspectable beside the
//! material instead of being trusted on a browser nobody here has. DESIGN.md
//! §2's claim is that those are one code path; this is where that claim is
//! checkable in one second.
//!
//! It is reachable with NO model endpoint configured, because it renders no
//! projection and calls the seam not once — it is markup and tokens only.
//! `#design-system` in the URL opens it directly at boot.

mod controls;
mod surfaces;

use dioxus::prelude::*;

use crate::skin::SkinToggle;
use crate::ui::{Button, Card};

/// The route's own attribute on the root element, and the whole mechanism.
/// `tokens.css` gives it the same body as `[data-skin="plain"]`, so this is
/// not a second code path being maintained beside the first.
const GLASS_OFF: &str = "off";

/// Whether the page was opened straight at this route. The app has no URL
/// router — it routes by the `hidden` attribute between regions (increment
/// 13) — so this is the one line that makes the page linkable, which a critic
/// asked to "open /design-system" needs.
pub(crate) fn wanted() -> bool {
    web_sys::window()
        .and_then(|w| w.location().hash().ok())
        .is_some_and(|h| h.contains("design-system"))
}

fn set_glass(off: bool) {
    let Some(root) = web_sys::window()
        .and_then(|w| w.document())
        .and_then(|d| d.document_element())
    else {
        return;
    };
    let _ = match off {
        true => root.set_attribute("data-glass", GLASS_OFF),
        false => root.remove_attribute("data-glass").map(|_| ()),
    };
}

#[component]
pub fn DesignSystem(hidden: bool) -> Element {
    let mut glass_off = use_signal(|| false);
    use_effect(move || set_glass(glass_off()));
    rsx! {
        section {
            class: "deck",
            id: "design-system",
            aria_label: "Design system",
            hidden,
            Card { title: "Design system", variant: "flat",
                p { class: "note",
                    "Every component in DESIGN.md §8, in every variant and every state, over \
                     the real ground. Nothing on this page calls the seam, so it renders with \
                     no model endpoint configured and no agent loaded."
                }
                div { class: "ds-row",
                    SkinToggle {}
                    Button {
                        class: "skin-toggle",
                        aria_pressed: if glass_off() { "true" } else { "false" },
                        onclick: move |_| {
                            let next = !glass_off.peek().to_owned();
                            glass_off.set(next);
                        },
                        "No backdrop-filter"
                    }
                }
                p { class: "note",
                    "The two switches are independent and land on the same tokens: the skin is \
                     a person's choice and persists, the other simulates a browser with no \
                     backdrop-filter for as long as this page is open. Turning either on must \
                     leave every boundary readable and every surface legible — if it does not, \
                     the fallback is broken, and the fallback is a product."
                }
            }
            {surfaces::material()}
            {surfaces::content()}
            {controls::interactive()}
            {controls::feedback()}
        }
    }
}
