//! THE SUBJECT PLATE — one word, spanned to the width of its own box.
//!
//! Its own file because `panels.rs` is at the 200-line ceiling (I12) and this
//! is a whole mechanism with a whole reason, not two more lines of a component.
//!
//! **Why an `<svg>` and not letter-spacing.** The plate must span its column
//! exactly. `--tr-nameplate` did it by solving `tr = (column - 4.74em·size)/6`
//! for HARNESS's seven glyphs — a fit through two widths, measured on the app
//! at eleven: exact at 390 and 1440, and out by -21.8px at 1024, +87.1px at
//! 1280 and -87.7px at 1920. The column STEPS, because the nav and the rail
//! arrive at breakpoints, and no clamp models a step; a second linear term was
//! tried and left 1280 at +87. `textLength="100%"` spans the box BY
//! CONSTRUCTION — every width, and for a word of any length, which is the half
//! the constant never had: `main` is four glyphs and `summarizer` is ten.
//! `lengthAdjust="spacing"` moves the GAPS and never the letterforms;
//! `spacingAndGlyphs` distorts them and is forbidden (DESIGN.md §1).
//!
//! **The name.** `role="img"` + `aria-label` gives the `<svg>` the word as its
//! accessible name, and the `<h2>` around it takes that name from its contents
//! — verified in Chrome's accessibility tree, which reads
//! `heading "main" → img "main"`. NOT an SVG `<title>`: `dioxus_elements::title`
//! is the HTML one and would be built in the wrong namespace.
//!
//! `core::builtins::nameplate` writes the same three elements for HARNESS on
//! the other side of the seam, and `scripts/layout-probe.html` writes them a
//! third time. Three spellings of one shape: change one, change all three.

use dioxus::prelude::*;

/// The plate for every route but the Dashboard: the AGENT, not the view.
#[component]
pub(crate) fn SubjectPlate(word: String) -> Element {
    rsx! {
        div { class: "masthead",
            h2 { class: "plate",
                svg { role: "img", "aria-label": "{word}", "focusable": "false",
                    text {
                        x: "0", y: "50%",
                        text_length: "100%", length_adjust: "spacing",
                        "{word}"
                    }
                }
            }
        }
    }
}
