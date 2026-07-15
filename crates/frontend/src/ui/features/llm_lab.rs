//! LLM lab panel (U3 fills this in): curated tiny WebGPU model picker, prompt
//! box, streamed output via `askk_browser::local_llm::generate_once`, a
//! max-tokens control, and a "use as default provider" button that calls
//! `on_use_default` with the chosen model id.

use dioxus::prelude::*;

#[component]
pub fn LlmPanel(on_use_default: EventHandler<String>) -> Element {
    let _ = on_use_default;
    rsx! {
        div { class: "feat-stub", "LLM lab — coming soon." }
    }
}
