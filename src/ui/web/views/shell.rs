use crate::api::{ui_config, UiConfig};
use crate::ui::web::components::{engine_of, next_theme, Footer, Sidebar, Topbar, Wall};
use super::live::{use_live_provider, use_live_server};
use crate::core::manifest::Manifest;
use crate::Route;
use dioxus::prelude::*;

/// Layout: wall + sidebar + topbar around the routed page. Brand from `ui.json`; nav is the
/// route folders that set `nav`. Starts the tab's one live listener ([`super::live`]); brand,
/// nav and theme re-read when their keys are marked changed.
#[component]
pub fn Shell() -> Element {
    let collapsed = use_signal(|| false);
    let open = use_signal(|| false);
    let here = use_route::<Route>().to_string();
    use_live_provider();
    let mf = use_server_future(crate::api::manifest)?;
    let m: Manifest = mf.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default();
    use_context_provider(|| m.clone());
    let (ku, kr, kt) = (m.ui.clone(), m.routes.clone(), m.theme.clone());
    let ui = use_live_server(move || ku.clone(), ui_config)?;
    let cfg: UiConfig = ui().unwrap_or_default();
    use_context_provider(|| cfg.clone());
    let nav = use_live_server(move || kr.clone(), crate::api::nav_links)?;
    let links = nav().unwrap_or_default();
    let theme = use_live_server(move || kt.clone(), crate::api::theme)?;
    let vars: String = theme.read().as_ref().map(|m| m.iter().map(|(k, v)| format!("{k}:{v};")).collect()).unwrap_or_default();
    // Every engine, for the header's picker; asked again when an engine comes or goes.
    let ke = m.engines.clone();
    let engines_live = super::live::use_live(move || ke.clone());
    let engines = use_resource(move || {
        let _ = engines_live();
        crate::api::engine_paths()
    });
    let engine_list = engines.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default();
    // Light or dark: the saved choice, else the system's; read once the page is in a browser.
    let mut look = use_signal(|| "dark".to_string());
    use_effect(move || {
        spawn(async move {
            let mut ev = document::eval(
                r#"let t = localStorage.getItem('askk-theme');
                if (t !== 'light' && t !== 'dark') { t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
                document.documentElement.dataset.theme = t;
                dioxus.send(t);"#,
            );
            if let Ok(t) = ev.recv::<String>().await {
                look.set(t);
            }
        });
    });
    let go = navigator();
    use_effect(move || {
        if let Some(p) = crate::ui::web::app::GOTO() {
            go.push(p.as_str());
            *crate::ui::web::app::GOTO.write() = None;
        }
    });
    // A bare face (the notch panel) is the page alone, on a clear background.
    if try_use_context::<crate::ui::web::app::Bare>().is_some() {
        return rsx! {
            document::Style { ":root{{{vars}}} html,body{{background:transparent !important}}" }
            div { class: "face",
                SuspenseBoundary { fallback: |_| rsx! {}, Outlet::<Route> {} }
            }
        };
    }
    rsx! {
        document::Style { ":root{{{vars}}}" }
        Wall {}
        div { class: if collapsed() { "shell collapsed" } else { "shell" },
            Sidebar { brand: cfg.brand.clone(), items: links.clone(), collapsed, open }
            main { class: "main",
                Topbar {
                    brand: cfg.brand.clone(),
                    title: links.iter().find(|l| l.to == here).map(|l| l.label.clone()).unwrap_or_else(|| here.rsplit('/').find(|s| !s.is_empty()).unwrap_or_default().to_string()),
                    engines: engine_list,
                    current: engine_of(&here),
                    light: look() == "light",
                    on_engine: move |path: String| {
                        navigator().push(format!("/e/{path}"));
                    },
                    on_theme: move |_| {
                        let next = next_theme(&look());
                        look.set(next.to_string());
                        let _ = document::eval(&format!("document.documentElement.dataset.theme = '{next}'; localStorage.setItem('askk-theme', '{next}');"));
                    },
                    // What is running now, on every page.
                    super::loops::NowChip {}
                }
                // A page that suspends while loading (server futures on client navigation) shows
                // this fallback instead of blanking the whole layout.
                div { class: "page",
                    SuspenseBoundary { fallback: |_| rsx! { p { class: "dim", "loading" } },
                        Outlet::<Route> {}
                    }
                }
                Footer { items: cfg.contact_items() }
            }
        }
        // The companion is not drawn for now (a novelty; `views/companion.rs` keeps it).
    }
}
