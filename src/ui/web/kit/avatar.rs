//! From rust-ui.com (MIT, see LICENSE-rust-ui beside this file). The code is ours now: changed in two ways. The parts this app does not use (a picture from an address, a group of faces) are left out, and with them the crate the original needed for the size names. And the root carries the `data-name` that marks it as kit.
use dioxus::prelude::*;
use tw_merge::tw_merge;

#[allow(dead_code)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum AvatarSize {
    Sm,
    #[default]
    Default,
    Lg,
}

impl AvatarSize {
    fn as_str(self) -> &'static str {
        match self {
            AvatarSize::Sm => "sm",
            AvatarSize::Default => "default",
            AvatarSize::Lg => "lg",
        }
    }
}

#[component]
pub fn Avatar(
    #[props(default)] size: AvatarSize,
    #[props(into, optional)] class: Option<String>,
    children: Element,
) -> Element {
    let merged = tw_merge!(
        "group/avatar relative flex size-8 shrink-0 rounded-full select-none data-[size=lg]:size-10 data-[size=sm]:size-6",
        class.as_deref().unwrap_or("")
    );
    rsx! {
        span {
            "data-name": "Avatar",
            class: "{merged}",
            "data-size": "{size.as_str()}",
            {children}
        }
    }
}

/// What stands in the circle: a letter, an emoji, an icon.
#[component]
pub fn AvatarFallback(#[props(into, optional)] class: Option<String>, children: Element) -> Element {
    let merged = tw_merge!(
        "absolute inset-0 flex size-full items-center justify-center overflow-hidden rounded-full border bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs",
        class.as_deref().unwrap_or("")
    );
    rsx! {
        span { "data-name": "AvatarFallback", class: "{merged}", {children} }
    }
}

/// A small dot on the circle's edge: a state.
#[component]
pub fn AvatarBadge(#[props(into, optional)] class: Option<String>, children: Element) -> Element {
    let merged = tw_merge!(
        "absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background select-none group-data-[size=sm]/avatar:size-2 group-data-[size=default]/avatar:size-2.5 group-data-[size=lg]/avatar:size-3",
        class.as_deref().unwrap_or("")
    );
    rsx! {
        span { "data-name": "AvatarBadge", class: "{merged}", {children} }
    }
}
