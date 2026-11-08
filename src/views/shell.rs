use crate::api::{ui_config, UiConfig};
use crate::components::{Sidebar, Topbar, Wall};
use crate::Route;
use dioxus::prelude::*;

/// Layout: wall + sidebar + topbar around the routed page. Brand from `ui.json`; nav is the
/// route folders that set `nav`.
#[component]
pub fn Shell() -> Element {
    let collapsed = use_signal(|| false);
    let open = use_signal(|| false);
    let here = use_route::<Route>().to_string();
    let ui = use_server_future(ui_config)?;
    let cfg: UiConfig = ui.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default();
    use_context_provider(|| cfg.clone());
    let nav = use_server_future(crate::routes::nav_links)?;
    let links = nav.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default();
    let theme = use_server_future(crate::api::theme)?;
    let vars: String = theme.read().as_ref().and_then(|r| r.as_ref().ok()).map(|m| m.iter().map(|(k, v)| format!("{k}:{v};")).collect()).unwrap_or_default();
    rsx! {
        document::Style { ":root{{{vars}}}" }
        Wall {}
        div { class: if collapsed() { "shell collapsed" } else { "shell" },
            Sidebar { brand: cfg.brand.clone(), items: links.clone(), collapsed, open }
            main { class: "main",
                Topbar { brand: cfg.brand.clone(), title: links.iter().find(|l| l.to == here).map(|l| l.label.clone()).unwrap_or_else(|| here.trim_start_matches('/').to_string()) }
                Outlet::<Route> {}
            }
        }
    }
}
