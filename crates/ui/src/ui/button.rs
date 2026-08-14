//! Button — DESIGN.md §8. Four variants, two behaviours (submit or not), and
//! every state the stylesheet paints: hover, `:focus-visible`, `:active`,
//! `:disabled`. Minimum target 44×44, which `controls.css` sets on the element
//! and this component therefore cannot lose.
//!
//! Fifteen raw `<button>` elements went through here. The one thing worth
//! stating about the props: `disabled` is a real prop rather than an extended
//! attribute because every call site sets it from a signal and a disabled
//! control that still looks live is the defect this repo already fixed once.

use dioxus::prelude::*;

#[component]
pub(crate) fn Button(
    /// `primary` (accent fill) · `secondary` (glass fill + `--control` border)
    /// · `ghost` (no fill) · `danger`.
    ///
    /// `None` paints as the primary too — `controls.css` gives every bare
    /// `button` the accent fill — but the four actions this product is FOR now
    /// say so in a class (R3-16): `Start agent`, `Send`, `Run command` and
    /// `Save agent` carried no design-system class at all, while the loudest
    /// button on the page was `Save endpoint` in Settings.
    variant: Option<String>,
    /// Extra classes the call site owns — `tab`, `panel-toggle`,
    /// `skin-toggle`. Merged, never replacing the variant class.
    class: Option<String>,
    /// A submit button inside a form, so Enter submits. Default `false`: a
    /// bare `<button>` in a form defaults to submit and that has been the
    /// source of an accidental navigation in every framework ever written.
    submit: Option<bool>,
    disabled: Option<bool>,
    onclick: Option<EventHandler<MouseEvent>>,
    /// The tablist's arrow keys (`tabs.rs`). Optional so nothing else pays
    /// for it.
    onkeydown: Option<EventHandler<KeyboardEvent>>,
    /// `id`, `role`, `aria-selected`, `aria-controls`, `aria-expanded`,
    /// `aria-pressed`, `tabindex` — the roving-tabindex tab strip needs all of
    /// them and loses none.
    #[props(extends = global_attributes, extends = button)] attributes: Vec<Attribute>,
    children: Element,
) -> Element {
    let mut classes: Vec<&str> = Vec::new();
    if let Some(v) = variant.as_deref() {
        classes.push(match v {
            "primary" => "btn-primary",
            "secondary" => "btn-secondary",
            "ghost" => "btn-ghost",
            "danger" => "btn-danger",
            _ => "",
        });
    }
    if let Some(extra) = class.as_deref() {
        classes.push(extra);
    }
    let class = classes.join(" ");
    rsx! {
        button {
            r#type: if submit.unwrap_or(false) { "submit" } else { "button" },
            class: "{class}",
            disabled: disabled.unwrap_or(false),
            onclick: move |e| { if let Some(h) = &onclick { h.call(e) } },
            onkeydown: move |e| { if let Some(h) = &onkeydown { h.call(e) } },
            ..attributes,
            {children}
        }
    }
}
