//! Sensors & media panel (U2 fills this in): webcam/screen frame capture, mic
//! record + playback, geolocation, clipboard, notification, and browser TTS,
//! each with tunable parameters. Backed by
//! `askk_browser::capabilities::{media, system}`.

use dioxus::prelude::*;

#[component]
pub fn SensorsPanel() -> Element {
    rsx! {
        div { class: "feat-stub", "Sensors & media panel — coming soon." }
    }
}
