//! Form — the four hand-rolled `<form>` elements, with the one line none of
//! them may forget.
//!
//! `e.prevent_default()` is that line. The seam is the only transport in this
//! app (I4), so a form that submits natively turns the message a person typed
//! into a query string and navigates away from the conversation. Four call
//! sites each remembered it; a fifth would eventually not. It is a real form
//! — not a div with a click handler — because that is what makes Enter submit
//! and the button a submit button, which is the behaviour DESIGN.md §9 calls
//! one of the two interactions that must feel good.

use dioxus::prelude::*;

#[component]
pub(crate) fn Form(
    /// The composer and the terminal: field and button on one row.
    oneline: Option<bool>,
    /// Called after the default is prevented. Takes nothing, because no call
    /// site reads the event — they all read their own signals.
    onsubmit: EventHandler<()>,
    #[props(extends = global_attributes, extends = form)] attributes: Vec<Attribute>,
    children: Element,
) -> Element {
    rsx! {
        form {
            class: if oneline.unwrap_or(false) { "oneline" } else { "" },
            onsubmit: move |e: FormEvent| {
                e.prevent_default();
                onsubmit.call(());
            },
            ..attributes,
            {children}
        }
    }
}
