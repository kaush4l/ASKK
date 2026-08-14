//! Input / Textarea — DESIGN.md §8, "Input / Textarea / Select". Anatomy:
//! `<label class="field-label">` + control. The fill is `--surface-1`, opaque,
//! because it holds TYPED TEXT (G3), and the border is `--control` at 4.4:1
//! because a field with no fill of its own is drawn by its border (WCAG
//! 1.4.11) — both set on the element in `controls.css`, so no call site can
//! lose them.
//!
//! Six raw `<input>` elements and one `<textarea>` went through here. The
//! label is the point: a placeholder is never the only label, and the two
//! fields that had only an `aria-label` (the composer, the terminal) keep it
//! through `attributes` rather than growing a visible one they never wanted.

use dioxus::prelude::*;

#[component]
pub(crate) fn Field(
    /// The visible label. `None` means the call site labels the control
    /// another way — `aria-label` on the composer, which addresses the agent
    /// by name so two panes are never indistinguishable to a screen reader.
    label: Option<String>,
    /// Required whenever `label` is set: the `for`/`id` pair is what makes
    /// the label a label rather than a sentence above a box.
    id: Option<String>,
    /// Rows. `Some(n)` renders a `<textarea>` — the `multiline` variant. The
    /// `cols` below is a MINIMUM, not a cap: with no stylesheet a textarea
    /// falls back to 20 columns, and the agent editor was a 20×14 comment box
    /// in the plain skin for a whole increment.
    rows: Option<u32>,
    oninput: EventHandler<FormEvent>,
    /// Keys the call site owns. The two multiline fields a turn starts from
    /// need it: a `<textarea>` in a form does NOT submit on Enter the way an
    /// `<input>` does, and the composer's Enter has to keep working (R4-4).
    onkeydown: Option<EventHandler<KeyboardEvent>>,
    /// `type`, `value`, `placeholder`, `autocomplete`, `disabled`,
    /// `spellcheck`, `aria-label`.
    #[props(extends = global_attributes, extends = input)] attributes: Vec<Attribute>,
) -> Element {
    let head: Element = match (&label, &id) {
        (Some(text), Some(target)) => rsx! { label { r#for: "{target}", "{text}" } },
        (Some(text), None) => rsx! { label { "{text}" } },
        _ => rsx! {},
    };
    let control: Element = match rows {
        Some(n) => rsx! {
            textarea {
                id: id.clone().unwrap_or_default(),
                rows: "{n}",
                cols: 72,
                oninput: move |e| oninput.call(e),
                onkeydown: move |e| { if let Some(h) = &onkeydown { h.call(e) } },
                ..attributes,
            }
        },
        None => rsx! {
            input {
                id: id.clone().unwrap_or_default(),
                oninput: move |e| oninput.call(e),
                onkeydown: move |e| { if let Some(h) = &onkeydown { h.call(e) } },
                ..attributes,
            }
        },
    };
    rsx! {
        {head}
        {control}
    }
}
