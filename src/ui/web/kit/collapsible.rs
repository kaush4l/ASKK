//! From rust-ui.com (MIT, see LICENSE-rust-ui beside this file). The code is ours now: changed in four ways. The trigger says what it opens and whether it is open (`aria-expanded`, `aria-controls`), which the original left out. What is closed is not drawn at all, and cannot be reached with the keyboard (`inert`), so a long text behind a closed part costs nothing. It opens and closes on the app's spring (`--motion-spring`, `--ease-spring`), and it leaves the way it came. And the parent may name `open` to decide it, or leave it to the part.
use dioxus::prelude::*;
use tw_merge::tw_merge;

#[derive(Clone, Copy)]
struct CollapsibleCtx {
    open: Signal<bool>,
    /// A name of its own, so the trigger can say which content it opens.
    id: usize,
}

#[component]
pub fn Collapsible(
    #[props(default = false)] default_open: bool,
    #[props(into, optional)] open: Option<bool>,
    #[props(into, optional)] class: Option<String>,
    children: Element,
) -> Element {
    let mut state = use_signal(|| open.unwrap_or(default_open));
    // A parent that names `open` decides: when it says otherwise, the part follows.
    use_effect(use_reactive!(|open| {
        if let Some(o) = open {
            if *state.peek() != o {
                state.set(o);
            }
        }
    }));
    let id = use_hook(|| dioxus::core::current_scope_id().0);
    provide_context(CollapsibleCtx { open: state, id });

    let state = if state() { "open" } else { "closed" };
    let class = tw_merge!("", class.as_deref().unwrap_or(""));

    rsx! {
        div {
            "data-name": "Collapsible",
            "data-state": "{state}",
            class: "{class}",
            {children}
        }
    }
}

#[component]
pub fn CollapsibleTrigger(
    #[props(into, optional)] class: Option<String>,
    #[props(into, optional)] aria_label: Option<String>,
    /// Told after each press whether the part is now open.
    #[props(optional)] ontoggle: Option<EventHandler<bool>>,
    children: Element,
) -> Element {
    let CollapsibleCtx { mut open, id } = use_context::<CollapsibleCtx>();
    let state = if open() { "open" } else { "closed" };
    let class = tw_merge!(
        "group/trigger cursor-pointer select-none touch-manipulation text-left [-webkit-tap-highlight-color:transparent] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-[transform,background-color,color] duration-[var(--motion-fast)] ease-[var(--ease-out)] active:scale-[var(--press-scale)] active:duration-[var(--motion-press)]",
        class.as_deref().unwrap_or("")
    );

    rsx! {
        button {
            r#type: "button",
            "data-name": "CollapsibleTrigger",
            "data-state": "{state}",
            "aria-expanded": "{open()}",
            "aria-controls": "collapsible-{id}",
            "aria-label": aria_label.as_deref(),
            class: "{class}",
            onclick: move |_| {
                let next = !open();
                open.set(next);
                if let Some(handler) = &ontoggle {
                    handler.call(next);
                }
            },
            {children}
        }
    }
}

#[component]
pub fn CollapsibleContent(
    #[props(into, optional)] class: Option<String>,
    #[props(into, optional)] outer_class: Option<String>,
    children: Element,
) -> Element {
    let CollapsibleCtx { open, id } = use_context::<CollapsibleCtx>();
    let state = if open() { "open" } else { "closed" };
    // Kept drawn while it closes, so it leaves the way it came; then it is not drawn at all.
    let mut drawn = use_signal(|| open());
    use_effect(move || {
        if open() {
            drawn.set(true);
        }
    });

    let outer = tw_merge!(
        "[display:grid] [grid-template-columns:minmax(0,1fr)] overflow-hidden transition-[grid-template-rows,opacity] duration-[var(--motion-spring)] ease-[var(--ease-spring)] data-[state=closed]:grid-rows-[0fr] data-[state=closed]:opacity-0 data-[state=open]:grid-rows-[1fr] data-[state=open]:opacity-100",
        outer_class.as_deref().unwrap_or("")
    );

    rsx! {
        div {
            "data-name": "CollapsibleContent",
            "data-state": "{state}",
            id: "collapsible-{id}",
            class: "{outer}",
            "inert": (!open()).then_some("true"),
            ontransitionend: move |_| {
                if !open() {
                    drawn.set(false);
                }
            },
            div { class: tw_merge!("min-h-0 min-w-0", class.as_deref().unwrap_or("")),
                if open() || drawn() {
                    {children}
                }
            }
        }
    }
}
