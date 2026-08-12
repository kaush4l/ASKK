//! Everything you can click, type into or tab to: button, field, select, tab,
//! badge — every variant, and the states the stylesheet can paint statically.
//!
//! Hover, `:focus-visible` and `:active` are not forced with a fake class.
//! Forcing them would mean a second copy of every value in the stylesheet,
//! which is the drift this page exists to catch; they are labelled and left
//! live, so a critic checks them by pointing and by pressing Tab — which is
//! the only way a focus ring over the lit lobe can honestly be judged anyway.

use dioxus::prelude::*;

use crate::ui::{Badge, Button, Card, Field, Form, SelectField};

pub(crate) fn interactive() -> Element {
    rsx! {
        Card { title: "Button", aria_label: "Button",
            p { class: "ds-note", "default" }
            div { class: "ds-row",
                Button { "Primary" }
                Button { variant: "secondary", "Secondary" }
                Button { variant: "ghost", "Ghost" }
                Button { variant: "danger", "Danger" }
            }
            p { class: "ds-note", "disabled" }
            div { class: "ds-row",
                Button { disabled: true, "Primary" }
                Button { variant: "secondary", disabled: true, "Secondary" }
                Button { variant: "ghost", disabled: true, "Ghost" }
                Button { variant: "danger", disabled: true, "Danger" }
            }
            // Not a "small" variant: there is one button size (DESIGN §8), and
            // this row is here because it is the only control that appears
            // mid-turn — the composer is disabled, so it is the sole target.
            p { class: "ds-note", "the wait clock — the one control that appears mid-turn" }
            p { class: "wait-clock", "waiting for the model — 4s " Button { variant: "secondary", "Stop waiting" } }
            p { class: "note",
                "Hover, :focus-visible and :active are live on the row above. Every target is \
                 44×44 including padding; the focus ring is 2px accent over a dark halo, \
                 because a single outline disappears into a translucent surface."
            }
        }
        {fields()}
    }
}

fn fields() -> Element {
    rsx! {
        Card { title: "Input, textarea, select", aria_label: "Fields",
            Form { onsubmit: move |_| {},
                Field {
                    id: "ds-text", label: "Text", r#type: "text",
                    placeholder: "a placeholder is never the only label",
                    oninput: move |_: FormEvent| {},
                }
                Field {
                    id: "ds-disabled", label: "Disabled", r#type: "text",
                    value: "cannot be edited", disabled: true,
                    oninput: move |_: FormEvent| {},
                }
                SelectField {
                    id: "ds-select", label: "Select", onchange: move |_: FormEvent| {},
                    option { value: "one", "one" }
                    option { value: "two", "two" }
                }
                Field {
                    id: "ds-multiline", label: "Multiline", rows: 4,
                    value: "---\nname: note-taker\n---\n",
                    oninput: move |_: FormEvent| {},
                }
                div { class: "row",
                    Button { submit: true, "Submit" }
                    Button { variant: "secondary", "Cancel" }
                }
            }
        }
    }
}

/// Tabs and badges: the two places where a colour was once the only channel.
pub(crate) fn feedback() -> Element {
    rsx! {
        Card { title: "Tab", aria_label: "Tab",
            div { class: "agent-tabs", role: "tablist", aria_orientation: "vertical",
                aria_label: "Specimen tabs",
                Button { class: "tab current", role: "tab", aria_selected: "true", tabindex: "0",
                    span { aria_hidden: "true", "▸ " }
                    strong { "selected" }
                }
                Button { class: "tab", role: "tab", aria_selected: "false", tabindex: "-1", "default" }
                Button { class: "tab", role: "tab", aria_selected: "false", tabindex: "-1",
                    disabled: true, "disabled" }
            }
            p { class: "note",
                "The marker and the bold name are UA-styled and `aria-selected` is not, so \
                 which tab you are in survives the stylesheet being switched off entirely. \
                 Roving tabindex: exactly one tab is in the page's tab order and the arrows \
                 move between them, vertically and horizontally both."
            }
        }
        Card { title: "Badge", aria_label: "Badge",
            div { class: "ds-row",
                Badge { status: "idle", label: "idle" }
                Badge { status: "starting", label: "starting" }
                Badge { status: "waiting", label: "waiting" }
                Badge { status: "working", label: "working" }
                Badge { status: "failed", label: "failed" }
                Badge { status: "closed", label: "closed" }
            }
            p { class: "note",
                "A dot AND a label, never a dot alone. The word is the primary channel: a \
                 refused call and a successful one that differ by hue alone are identical \
                 with the stylesheet off, identical to a screen reader, and unreadable to \
                 anyone who does not see red."
            }
        }
    }
}
