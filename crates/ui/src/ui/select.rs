//! Select — the `select` variant of DESIGN.md §8's field. Its own file rather
//! than a third branch of `Field` because its content is CHILDREN (the
//! options), and a component whose shape changes with a flag is two components
//! sharing a name.

use dioxus::prelude::*;

#[component]
pub(crate) fn SelectField(
    label: String,
    id: String,
    onchange: EventHandler<FormEvent>,
    /// `value`, `disabled`.
    #[props(extends = global_attributes, extends = select)] attributes: Vec<Attribute>,
    /// The `<option>` list, built by the call site: which entries exist is the
    /// catalogue's business, not this component's.
    children: Element,
) -> Element {
    rsx! {
        label { r#for: "{id}", "{label}" }
        select {
            id: "{id}",
            onchange: move |e| onchange.call(e),
            ..attributes,
            {children}
        }
    }
}
