//! Features stage — a lab to test every browser-provided capability and tune
//! each one's parameters, WITHOUT wiring anything into the agent engine
//! (ADR-041). Each sub-tab is its own panel module backed by free functions in
//! `askk_browser::{capabilities, speech, local_llm}` (the frontend has no
//! web-sys of its own; all browser reach lives in the browser crate).
//!
//! Add a panel = one module + one `Tab` variant + one match arm here.

use dioxus::prelude::*;

mod llm_lab;
mod platform;
mod probe;
mod sensors;
mod speech_lab;

/// The lab's sub-tabs, in display order.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Tab {
    Probe,
    Sensors,
    Llm,
    Speech,
    Platform,
}

impl Tab {
    fn label(self) -> &'static str {
        match self {
            Tab::Probe => "Probe",
            Tab::Sensors => "Sensors & Media",
            Tab::Llm => "LLM Lab",
            Tab::Speech => "Speech Lab",
            Tab::Platform => "Platform / Safari",
        }
    }
}

const TABS: &[Tab] = &[
    Tab::Probe,
    Tab::Sensors,
    Tab::Llm,
    Tab::Speech,
    Tab::Platform,
];

/// The Features stage: a tab strip over the capability panels. `on_use_default`
/// forwards a chosen in-browser model id up to `app.rs`, which writes it as the
/// active provider profile (the LLM lab's "use as default" button).
#[component]
pub fn FeaturesStage(on_use_default: EventHandler<String>) -> Element {
    let mut tab = use_signal(|| Tab::Probe);
    rsx! {
        div { class: "features-wrap",
            div { class: "settings-title", "Features lab" }
            div { class: "feat-sub",
                "Test the browser's own inputs and in-browser models. Nothing here touches the agent — it's a probe bench."
            }
            div { class: "feat-tabs",
                for t in TABS.iter().copied() {
                    button {
                        class: if tab() == t { "preset on" } else { "preset" },
                        onclick: move |_| tab.set(t),
                        "{t.label()}"
                    }
                }
            }
            div { class: "feat-body",
                match tab() {
                    Tab::Probe => rsx! { probe::ProbePanel {} },
                    Tab::Sensors => rsx! { sensors::SensorsPanel {} },
                    Tab::Llm => rsx! { llm_lab::LlmPanel { on_use_default } },
                    Tab::Speech => rsx! { speech_lab::SpeechPanel {} },
                    Tab::Platform => rsx! { platform::PlatformPanel {} },
                }
            }
        }
    }
}
