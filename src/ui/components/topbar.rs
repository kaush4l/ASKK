use super::{Glass, Icon};
use dioxus::prelude::*;

/// The page header: where you are (the current page's title) under the brand, and on the right
/// a picker of every engine that opens its page.
#[component]
pub fn Topbar(brand: String, title: String) -> Element {
    let m = crate::ui::views::live::use_manifest();
    let live = crate::ui::views::live::use_live(move || m.engines.clone());
    let engines = use_resource(move || {
        let _ = live();
        crate::api::engine_paths()
    });
    let here = use_route::<crate::Route>().to_string();
    let current = engine_of(&here);
    let list = engines.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default();
    let mut theme = use_signal(|| "dark".to_string());
    // On mount: apply the saved choice, else the OS preference, and sync the button to it.
    use_effect(move || {
        spawn(async move {
            let mut ev = document::eval(
                r#"let t = localStorage.getItem('askk-theme');
                if (t !== 'light' && t !== 'dark') { t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
                document.documentElement.dataset.theme = t;
                dioxus.send(t);"#,
            );
            if let Ok(t) = ev.recv::<String>().await { theme.set(t); }
        });
    });
    let is_light = theme() == "light";
    rsx! {
        Glass { class: "topbar",
            div { class: "crumbs grow", span { class: "dim", "{brand}" } span { class: "sep", "aria-hidden": "true", "/" } h1 { "{title}" } }
            // What is running now, on every page.
            crate::ui::views::loops::NowChip {}
            select { class: "engine-pick", "aria-label": "Open an engine",
                onchange: move |e| {
                    let v = e.value();
                    if !v.is_empty() { navigator().push(format!("/e/{v}")); }
                },
                option { value: "", selected: current.is_none(), disabled: true, "Engines…" }
                for p in list {
                    option { key: "{p}", value: "{p}", selected: current.as_deref() == Some(p.as_str()), "{p}" }
                }
            }
            button { class: "icon-btn theme-toggle", r#type: "button", "aria-label": "Switch to light or dark theme", "aria-pressed": "{is_light}",
                onclick: move |_| {
                    let next = next_theme(&theme());
                    theme.set(next.to_string());
                    let _ = document::eval(&format!("document.documentElement.dataset.theme = '{next}'; localStorage.setItem('askk-theme', '{next}');"));
                },
                Icon { name: if is_light { "sun" } else { "moon" } }
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
