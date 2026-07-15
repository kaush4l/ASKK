//! Probe panel (U1 fills this in): full browser-capability sweep, grouped by
//! section with status dots + detail and a re-probe button. Backed by
//! `askk_browser::capabilities::probe`.

use dioxus::prelude::*;

#[component]
pub fn ProbePanel() -> Element {
    rsx! {
        div { class: "feat-stub", "Probe panel — coming soon." }
    }
}
