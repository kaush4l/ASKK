//! The skin switch (increment 12). The plain skin is the permanent fallback
//! (plan: "purple base theme… the AAA layer is added on top and can be switched
//! off without losing a feature"), so this owns ONE bit and nothing else:
//! whether `data-skin="plain"` is on the root element.
//!
//! The bit is expressed as the ABSENCE of the attribute for the machine layer,
//! not its presence, so `aaa.css` is what a page with no scripting yet already
//! has: nothing here runs before first paint, and a skin that depended on this
//! module having run would flash the wrong one on every load.
//!
//! No application logic in JS (I5): this is Rust, and it stores a preference —
//! it decides nothing about the system it is looking at.

use dioxus::prelude::*;

/// Its own key namespace: the app's data lives in IndexedDB, and a preference
/// about this device's screen is not app data (I2 — it never leaves either).
const KEY: &str = "askk.skin";
const PLAIN: &str = "plain";

fn storage() -> Option<web_sys::Storage> {
    web_sys::window()?.local_storage().ok().flatten()
}

/// The saved choice. Absent, unreadable, or storage denied all mean the same
/// thing — the machine layer — because that is what the page already shows.
fn saved() -> bool {
    storage()
        .and_then(|s| s.get_item(KEY).ok().flatten())
        .as_deref()
        == Some(PLAIN)
}

/// Put the bit where CSS can see it, and where a reload can find it again.
fn apply(plain: bool) {
    if let Some(root) = web_sys::window()
        .and_then(|w| w.document())
        .and_then(|d| d.document_element())
    {
        let _ = match plain {
            true => root.set_attribute("data-skin", PLAIN),
            false => root.remove_attribute("data-skin").map(|_| ()),
        };
    }
    if let Some(s) = storage() {
        let _ = match plain {
            true => s.set_item(KEY, PLAIN),
            false => s.remove_item(KEY),
        };
    }
}

/// A toggle button, which is what this is: `aria-pressed` rather than two
/// radio buttons or a checkbox styled as a switch. The label says what the
/// control DOES, so it reads the same whichever skin is on.
#[component]
pub fn SkinToggle() -> Element {
    let mut plain = use_signal(saved);
    use_effect(move || apply(plain()));
    rsx! {
        button {
            r#type: "button",
            class: "skin-toggle",
            aria_pressed: if plain() { "true" } else { "false" },
            onclick: move |_| {
                let next = !plain.peek().to_owned();
                plain.set(next);
            },
            "Simple skin"
        }
    }
}
