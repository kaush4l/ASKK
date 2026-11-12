//! The companion's drawing: one inline shape in the theme's colours. The mood is a class and
//! every motion is CSS on `transform` and `opacity` (`assets/styling/glass.css`), so a still
//! mood costs nothing. No image is loaded; later a pack may replace this drawing.
use crate::core::companion::{Beat, Mood};
use dioxus::prelude::*;

/// The character at `size` points, in `mood`, playing `beat` once when it changes.
#[component]
pub fn Companion(mood: Mood, beat: Option<Beat>, size: u32) -> Element {
    let name = mood.name();
    let class = match beat {
        Some(b) => format!("companion {name} beat-{}", b.name()),
        None => format!("companion {name}"),
    };
    rsx! {
        svg { class, width: "{size}", height: "{size}", view_box: "0 0 96 96", role: "img", "aria-label": "askk is {name}",
            ellipse { class: "c-shadow", cx: "48", cy: "88", rx: "22", ry: "4" }
            // Everything a beat moves at once.
            g { class: "c-all",
                // Working: an arc that circles the body.
                circle { class: "c-ring", cx: "48", cy: "48", r: "42" }
                g { class: "c-body",
                    path { class: "c-shape", d: "M48 14C70 14 82 28 82 50C82 70 68 82 48 82C28 82 14 70 14 50C14 28 26 14 48 14Z" }
                    ellipse { class: "c-shine", cx: "36", cy: "32", rx: "12", ry: "7" }
                    g { class: "c-eyes",
                        ellipse { cx: "38", cy: "50", rx: "4", ry: "5.5" }
                        ellipse { cx: "58", cy: "50", rx: "4", ry: "5.5" }
                    }
                    // Asleep: the eyes are two closed lids.
                    g { class: "c-lids",
                        path { d: "M33 51q5 4 10 0" }
                        path { d: "M53 51q5 4 10 0" }
                    }
                }
                // Asking: a dot that calls for attention.
                circle { class: "c-call", cx: "78", cy: "18", r: "7" }
            }
        }
    }
}
