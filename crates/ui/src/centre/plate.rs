//! THE SUBJECT PLATE — the agent's name, set as type.
//!
//! Its own file because `panels.rs` is at the 200-line ceiling (I12).
//!
//! **IT IS NOT SPANNED, AND THAT IS THE POINT.** The Dashboard nameplate is
//! spanned to its column by an `<svg><text textLength="100%">`
//! (`core::builtins::nameplate`), and for one round this component did the
//! same. It was wrong, and it shipped: HARNESS is seven glyphs and spans at
//! 1.13x–1.91x, but an agent name is `main` — four glyphs, 179.3px of natural
//! type — and the same mechanism stretched it into a 1136px column at 1440,
//! putting **318.9px between every pair of letters**, and 350.9px at 1920.
//! It rendered as `m    a    i    n` and stopped reading as a word.
//!
//! The measurement that let it through was SPAN ERROR, which was 0.0px at
//! every width — the metric a maximally over-tracked word satisfies perfectly.
//! `scripts/layout-probe.js` compounded it by writing `summarizer` into the
//! fixture, ten glyphs, the most flattering word in the roster, so every
//! screenshot in the design loop looked fine while the app served 6.33x.
//!
//! Spanning is for the PRODUCT's name, said once, on one screen. A subject
//! plate is a heading: it takes `--tr-display`, it wraps, and it is allowed to
//! be shorter than its rule, because a four-letter word IS shorter than a
//! column and pretending otherwise is what broke it.

use dioxus::prelude::*;

/// The plate for every route but the Dashboard: the AGENT, not the view.
#[component]
pub(crate) fn SubjectPlate(word: String) -> Element {
    rsx! {
        div { class: "masthead",
            h2 { class: "plate", "{word}" }
        }
    }
}
