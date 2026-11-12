//! From rust-ui.com (MIT, see LICENSE-rust-ui beside this file). The code is ours now: changed in three ways. It can be used: the original drew a box with no way to give it a value or hear what was typed (`value`, `oninput`, `onkeydown`). It has a name for a screen reader (`aria_label`). And it grows with what is typed, up to a height the caller names, in the app's own time.
use dioxus::prelude::*;
use tw_merge::tw_merge;

#[component]
pub fn Textarea(
    #[props(into, default)] class: Option<String>,
    #[props(into, optional)] id: Option<String>,
    #[props(into, default)] placeholder: Option<String>,
    #[props(into, optional)] aria_label: Option<String>,
    #[props(into, default)] value: String,
    #[props(default = false)] disabled: bool,
    #[props(default = 4)] rows: i64,
    #[props(optional)] oninput: Option<EventHandler<FormEvent>>,
    #[props(optional)] onkeydown: Option<EventHandler<KeyboardEvent>>,
) -> Element {
    let class = tw_merge!(
        "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow,border-color] duration-[var(--motion-fast)] ease-[var(--ease-out)] outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        class.as_deref().unwrap_or("")
    );
    rsx! {
        textarea {
            "data-name": "Textarea",
            class: "{class}",
            id: id.as_deref(),
            placeholder: placeholder.as_deref().unwrap_or(""),
            "aria-label": aria_label.as_deref(),
            disabled,
            rows,
            value: "{value}",
            oninput: move |e| {
                if let Some(handler) = &oninput {
                    handler.call(e);
                }
            },
            onkeydown: move |e| {
                if let Some(handler) = &onkeydown {
                    handler.call(e);
                }
            },
        }
    }
}
