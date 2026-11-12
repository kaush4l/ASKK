//! From rust-ui.com (MIT, see LICENSE-rust-ui beside this file). The code is ours now: changed in three ways. The original drew a bar of its own that did not move; here the browser's own bar is used, made thin and in the app's colours, so it scrolls everywhere a page can be shown (wheel, finger, keys). The area can be reached and scrolled with the keyboard and says what it holds (`tabindex`, `role`, a label), which the original left out. And where the content meets the top and bottom edge it can fade instead of being cut by a line.
use dioxus::prelude::*;
use tw_merge::tw_merge;

#[component]
pub fn ScrollArea(
    #[props(into, optional)] class: Option<String>,
    #[props(into, optional)] id: Option<String>,
    /// What the area holds, for a screen reader.
    #[props(into, optional)] aria_label: Option<String>,
    /// True fades the content out at the top and bottom edge.
    #[props(default = false)] fade: bool,
    children: Element,
) -> Element {
    let merged = tw_merge!(
        "relative min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent]",
        if fade { "[mask-image:linear-gradient(transparent,var(--ink-shade)_var(--space-4),var(--ink-shade)_calc(100%-var(--space-4)),transparent)]" } else { "" },
        class.as_deref().unwrap_or("")
    );
    rsx! {
        div {
            "data-name": "ScrollArea",
            id: id.as_deref(),
            class: "{merged}",
            role: "region",
            "aria-label": aria_label.as_deref(),
            tabindex: "0",
            {children}
        }
    }
}
