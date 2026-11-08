use crate::api::{ui_config, UiConfig};
use crate::components::{Sidebar, Topbar, Wall};
use crate::Route;
use dioxus::prelude::*;

/// Layout: wall + sidebar + topbar around the routed page. Brand and nav from `ui.json`.
#[component]
pub fn Shell() -> Element {
    let mut collapsed = use_signal(|| false);
    let ui = use_server_future(ui_config)?;
    let cfg: UiConfig = ui.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default();
    use_context_provider(|| cfg.clone());
    let theme = use_server_future(crate::api::theme)?;
    let vars: String = theme.read().as_ref().and_then(|r| r.as_ref().ok()).map(|m| m.iter().map(|(k, v)| format!("{k}:{v};")).collect()).unwrap_or_default();
    rsx! {
        document::Style { ":root{{{vars}}}" }
        Wall {}
        div { class: if collapsed() { "shell collapsed" } else { "shell" },
            Sidebar { brand: cfg.brand.clone(), items: cfg.nav.clone(), collapsed: collapsed() }
            main { class: "main",
                Topbar { title: cfg.brand.clone(), on_toggle: move |_| collapsed.toggle() }
                Outlet::<Route> {}
            }
        }
    }
}
