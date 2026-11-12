//! From rust-ui.com (MIT, see LICENSE-rust-ui beside this file). The code is ours now: changed in three ways. The tip also shows for the keyboard (when what it describes has focus), not only under a pointer, and says it is a tip (`role="tooltip"`). It arrives from the side it sits on and leaves the same way, in the app's own time (`--motion-fast`). And the little arrow is gone: the tip is a small piece of glass, like every floating surface here.
use dioxus::prelude::*;
use tw_merge::tw_merge;

#[allow(dead_code)]
#[derive(Default, Clone, PartialEq, Eq)]
pub enum TooltipPosition {
    #[default]
    Top,
    Left,
    Right,
    Bottom,
}

#[component]
pub fn Tooltip(#[props(into, optional)] class: Option<String>, children: Element) -> Element {
    let merged = tw_merge!("inline-flex relative group/tooltip", class.as_deref().unwrap_or(""));
    rsx! { span { "data-name": "Tooltip", class: "{merged}", {children} } }
}

#[component]
pub fn TooltipContent(
    #[props(into, optional)] class: Option<String>,
    #[props(default = TooltipPosition::default())] position: TooltipPosition,
    children: Element,
) -> Element {
    // Where it rests, and the small step it takes from there while hidden (so it arrives from
    // the thing it describes, and leaves the same way).
    let (pos_class, pos_str) = match position {
        TooltipPosition::Top => ("left-1/2 bottom-full mb-1.5 -translate-x-1/2 translate-y-1 origin-bottom group-hover/tooltip:translate-y-0 group-focus-within/tooltip:translate-y-0", "Top"),
        TooltipPosition::Right => ("top-1/2 left-full ml-1.5 -translate-y-1/2 -translate-x-1 origin-left group-hover/tooltip:translate-x-0 group-focus-within/tooltip:translate-x-0", "Right"),
        TooltipPosition::Bottom => ("left-1/2 top-full mt-1.5 -translate-x-1/2 -translate-y-1 origin-top group-hover/tooltip:translate-y-0 group-focus-within/tooltip:translate-y-0", "Bottom"),
        TooltipPosition::Left => ("top-1/2 right-full mr-1.5 -translate-y-1/2 translate-x-1 origin-right group-hover/tooltip:translate-x-0 group-focus-within/tooltip:translate-x-0", "Left"),
    };
    let content_class = tw_merge!(
        "absolute z-50 pointer-events-none opacity-0 transition-[opacity,translate] duration-[var(--motion-fast)] ease-[var(--ease-out)] group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100",
        "rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-[var(--lift)]",
        pos_class,
        class.as_deref().unwrap_or("")
    );

    rsx! {
        span {
            "data-name": "TooltipContent",
            "data-position": "{pos_str}",
            role: "tooltip",
            class: "{content_class}",
            {children}
        }
    }
}
