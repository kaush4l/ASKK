use super::{Glass, Icon};
use dioxus::prelude::*;

/// The page header: where you are (the current page's title) under the brand, and on the right
/// a picker of every engine and the switch between light and dark.
///
/// It is given everything it shows: `engines` (every engine's path), `current` (the one this
/// page is about, if any) and `light` (which theme is on). It says what the person chose
/// (`on_engine`, `on_theme`); going there and changing the theme are the shell's to do. What
/// the shell wants shown between the title and the picker (what is running now) goes inside.
#[component]
pub fn Topbar(
    brand: String,
    title: String,
    #[props(default)] engines: Vec<String>,
    #[props(default)] current: Option<String>,
    #[props(default)] light: bool,
    on_engine: EventHandler<String>,
    on_theme: EventHandler<()>,
    children: Element,
) -> Element {
    rsx! {
        Glass { class: "topbar",
            div { class: "crumbs grow", span { class: "dim", "{brand}" } span { class: "sep", "aria-hidden": "true", "/" } h1 { "{title}" } }
            {children}
            select { class: "engine-pick", "aria-label": "Open an engine",
                onchange: move |e| {
                    let v = e.value();
                    if !v.is_empty() { on_engine.call(v); }
                },
                option { value: "", selected: current.is_none(), disabled: true, "Engines…" }
                for p in engines {
                    option { key: "{p}", value: "{p}", selected: current.as_deref() == Some(p.as_str()), "{p}" }
                }
            }
            button { class: "icon-btn theme-toggle", r#type: "button", "aria-label": "Switch to light or dark theme", "aria-pressed": "{light}",
                onclick: move |_| on_theme.call(()),
                Icon { name: if light { "sun" } else { "moon" } }
            }
        }
    }
}

/// The theme a click on the toggle switches to.
pub fn next_theme(current: &str) -> &'static str {
    if current == "light" { "dark" } else { "light" }
}

/// The engine a URL shows (`/e/<path>`), if any.
pub fn engine_of(url: &str) -> Option<String> {
    let p = url.split(['?', '#']).next().unwrap_or_default();
    p.strip_prefix("/e/").map(|s| s.trim_end_matches('/').to_string()).filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    #[test]
    fn toggle_flips_between_light_and_dark() {
        assert_eq!(super::next_theme("dark"), "light");
        assert_eq!(super::next_theme("light"), "dark");
        assert_eq!(super::next_theme(""), "light");
    }

    #[test]
    fn engine_urls_name_their_engine() {
        let e = super::engine_of;
        assert_eq!(e("/e/askk/developer"), Some("askk/developer".into()));
        assert_eq!(e("/e/askk/?x=1"), Some("askk".into()));
        assert_eq!(e("/e/"), None);
        assert_eq!(e("/canvas"), None);
    }
}
