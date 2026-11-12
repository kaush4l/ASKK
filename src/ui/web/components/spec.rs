//! An engine's spec, drawn: what it is made to do, what it learnt, what it may use.
//!
//! An engine is the deepest kind of box (`docs/concept.md`): askk built it, so its goal, its
//! learnings and its tools are all known. [`SpecView`] is given the three texts as the
//! engine holds them (Markdown) and draws them one under the other. An opened box shows it
//! behind one touch.
use super::Prose;
use dioxus::prelude::*;

/// The three parts of a spec. An empty text says so instead of leaving a gap.
#[component]
pub fn SpecView(goal: String, learnings: String, tools: String) -> Element {
    rsx! {
        div { class: "spec",
            for (name, text, none) in [("Goal", goal, "No goal is written."), ("Learnings", learnings, "Nothing learnt yet."), ("Tools", tools, "It has no tools.")] {
                section { key: "{name}", class: "spec-part", "aria-label": "{name}",
                    h3 { class: "spec-name", "{name}" }
                    if text.trim().is_empty() { p { class: "dim", "{none}" } } else { Prose { text } }
                }
            }
        }
    }
}
