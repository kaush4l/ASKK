//! Platform / Safari panel (U5 fills this in): WebKit/iOS-relevant surfaces
//! pulled from the capability probe (standalone PWA, permissions, battery)
//! plus interactive Web Share and vibration tests. Backed by
//! `askk_browser::capabilities::{probe, system}`.

use dioxus::prelude::*;

#[component]
pub fn PlatformPanel() -> Element {
    rsx! {
        div { class: "feat-stub", "Platform / Safari panel — coming soon." }
    }
}
