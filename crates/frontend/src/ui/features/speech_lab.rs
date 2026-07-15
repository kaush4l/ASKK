//! Speech lab panel (U4 fills this in): STT (record → transcribe) and TTS
//! (text → speak) with curated tiny model + voice pickers. Backed by
//! `askk_browser::speech::{record_start, record_stop_transcribe, speak}`.

use dioxus::prelude::*;

#[component]
pub fn SpeechPanel() -> Element {
    rsx! {
        div { class: "feat-stub", "Speech lab — coming soon." }
    }
}
