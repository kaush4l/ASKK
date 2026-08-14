//! The material and the things that hold content: elevations, type scale,
//! colour roles, card variants, the message set, the empty state, the
//! skeleton, the disclosure.

use dioxus::prelude::*;

use crate::ui::{Button, Card, Disclosure, EmptyState, Skeleton};

/// E1, E2, E3 and the nesting rule, side by side. A critic checks N1–N4 here:
/// the E2 below is nested in an E1 and its blur is therefore off (N2), and the
/// E3 sample is rendered flat rather than inside a panel because an E3 under
/// an E1 is N1 and is not expressible on this page either.
pub(crate) fn material() -> Element {
    rsx! {
        Card { title: "Elevation", aria_label: "Elevation",
            p { class: "note",
                "Three elevations, not four. E1 is the app frame — header, the two panels, \
                 the stage. E2 sits inside it: a card, an agent row, a tool call. E3 floats \
                 above everything over a scrim, and is the only one with an outer shadow, \
                 because it is the only one that genuinely floats."
            }
            div { class: "ds-row",
                // Bare divs, NOT Card. A Card is a `.panel`, and `.panel` is
                // opaque content by definition — so specimens built from it
                // rendered E1, E2, E3 and FLAT as four pixel-identical
                // rectangles, and the one artifact whose job is to prove the
                // system is coherent proved the opposite. A specimen of a
                // material has to be the material and nothing else.
                div { class: "e1 ds-swatch", p { class: "ds-note", "E1 chrome" } }
                div { class: "e2 ds-swatch", p { class: "ds-note", "E2 resting" } }
                div { class: "e3 ds-swatch", p { class: "ds-note", "E3 floating" } }
                Card { variant: "flat", p { class: "ds-note", "flat · opaque, holds prose" } }
            }
            p { class: "note",
                "The E2 above is inside this panel, so its backdrop-filter is off — one rule, \
                 not a discipline. A blur behind a blur re-samples an already-blurred layer: \
                 a second full-surface composite for almost no visual difference."
            }
        }
    }
}

/// Type, ink, message variants, disclosure, empty state, skeleton.
pub(crate) fn content() -> Element {
    rsx! {
        Card { title: "Type and ink", aria_label: "Type and ink",
            p { class: "ds-note", "caption · eyebrows, uppercase only" }
            h3 { "Heading · panel titles, agent names" }
            p { "Body · replies, prose, input values. The longest text in the product lives on
                 an opaque surface inside the glass, never on it (G3)." }
            p { class: "note", "Label · metadata, form labels, buttons" }
            div { class: "ds-row",
                span { class: "speaker", "ink-2" }
                span { class: "space-path", "machine · /home/user/notes.md" }
                span { class: "note-author", "accent" }
                span { class: "error", "danger · a turn failed" }
            }
        }
        {messages()}
        {states()}
    }
}

fn messages() -> Element {
    rsx! {
        Card { title: "Message", aria_label: "Message",
            div { class: "chat-log",
                div { class: "msg user",
                    span { class: "speaker", "You: " }
                    span { class: "said", "What is in the folder?" }
                }
                div { class: "msg assistant",
                    span { class: "speaker", "main: " }
                    span { class: "said", "An Alpine root filesystem, and a notes.md you wrote last week." }
                }
                div { class: "msg tool",
                    span { class: "speaker", "main: " }
                    // The words the core emits, verbatim (R5-20): a specimen
                    // that says something the app does not is the drift the
                    // gallery exists to catch.
                    span { class: "said", "called write_file, read_file ×2 — every call is in Tool trace" }
                }
                // A NOTICE, and it says whose it is: every line in this column
                // carries a prefix now, and the page's own asides are labelled
                // "Note" so they are not read as an unattributed message (R3-17).
                div { class: "msg pending",
                    span { class: "speaker", "Note: " }
                    span { class: "said", "You stopped waiting. Nothing was cancelled — the \
                                           agent carries on working (R3-6)." }
                }
                // The shape `core::failure::card` actually emits: a <p>, not a
                // `.said` span, and NO speaker — a failure is the harness
                // talking, not the agent. The specimen carried both, so this
                // page showed the error variant in --ink with a "main:" label
                // while the chat showed it in --danger with none: the one
                // artifact whose job is to catch drift was the drift.
                div { class: "msg error",
                    // …and since F18, the word ERROR in front of it: the block
                    // must not be tellable from a reply by hue alone.
                    p { class: "error-head", "⚠ Error" }
                    p { "The endpoint refused the request." }
                    Disclosure { summary: "Technical detail — the provider refused",
                        pre { "{{\"Model\":{{\"Refused\":{{\"status\":403}}}}}}" }
                    }
                }
            }
        }
    }
}

fn states() -> Element {
    rsx! {
        Card { title: "Disclosure, empty state, skeleton", aria_label: "States",
            Disclosure { summary: "Closed by default — the signal comes first",
                p { class: "note",
                    "One implementation replaced four hand-rolled `details` blocks. Each pane \
                     had put four to six lines of explanation ABOVE two lines of signal."
                }
            }
            Disclosure { summary: "Open", open: true,
                p { class: "note", "The chevron rotates in 120ms and stops under reduced motion." }
            }
            EmptyState {
                title: "A region with nothing in it",
                sentence: "Never a bare \"No data\", and never more than one sentence: it says \
                           what the region is for, and the panel's own disclosure says how.",
                Button { variant: "secondary", "The one action" }
            }
            p { class: "ds-note", "Skeleton — a region that has not answered yet" }
            Skeleton { lines: 3, label: "Specimen" }
        }
    }
}
