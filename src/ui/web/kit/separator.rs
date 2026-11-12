//! From rust-ui.com (MIT, see LICENSE-rust-ui beside this file). The code is ours now: changed in two ways. The root carries the `data-name` that marks it as kit, and the line says which way it runs (`aria-orientation`), which the original left out.
use dioxus::prelude::*;
use tw_merge::tw_merge;

#[allow(dead_code)]
#[derive(Default, Clone, PartialEq, Eq)]
pub enum SeparatorOrientation {
    #[default]
    Horizontal,
    Vertical,
}

#[component]
pub fn Separator(
    #[props(into, optional)] class: Option<String>,
    #[props(default = SeparatorOrientation::default())] orientation: SeparatorOrientation,
) -> Element {
    let (orientation_class, way) = match orientation {
        SeparatorOrientation::Horizontal => ("w-full h-[1px]", "horizontal"),
        SeparatorOrientation::Vertical => ("h-full w-[1px]", "vertical"),
    };
    let merged_class = tw_merge!("shrink-0 bg-border", orientation_class, class.as_deref().unwrap_or(""));

    rsx! {
        div { "data-name": "Separator", class: "{merged_class}", role: "separator", "aria-orientation": way }
    }
}
