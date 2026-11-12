use crate::api::{ui_config, UiConfig};
use crate::ui::web::components::{engine_of, next_theme, Footer, Pill, Topbar, Wall, PILL_WIDTH};
use super::live::{use_live_provider, use_live_server};
use crate::core::manifest::Manifest;
use crate::Route;
use dioxus::prelude::*;
#[cfg(feature = "local")]
use crate::ui::web::tab::*;

/// What a window keeps about its pill between visits: how wide, and whether in groups.
/// Read once the page is in a browser (the browser's own store for this page).
fn use_pill_kept() -> (Signal<u32>, Signal<bool>) {
    let mut width = use_signal(|| 256u32);
    let mut grouped = use_signal(|| false);
    use_effect(move || {
        spawn(async move {
            let kept = document::eval("try { return [Number(localStorage.getItem('askk-pill-w')) || 0, localStorage.getItem('askk-pill-groups') === '1']; } catch (e) { return [0, false]; }").await;
            if let Ok((w, g)) = kept.map(|v| (v[0].as_u64().unwrap_or(0) as u32, v[1].as_bool().unwrap_or(false))) {
                if w > 0 {
                    width.set(w.clamp(PILL_WIDTH.0, PILL_WIDTH.1));
                }
                grouped.set(g);
            }
        });
    });
    (width, grouped)
}

/// Keep one thing about the pill for the next visit.
fn keep(name: &str, value: String) {
    document::eval(&format!("try {{ localStorage.setItem('askk-pill-{name}', '{value}'); }} catch (e) {{}}"));
}

/// Layout: wall + the pill + topbar around the routed page. Brand from `ui.json`; nav is the
/// route folders that set `nav`. Starts the tab's one live listener ([`super::live`]); brand,
/// nav and theme re-read when their keys are marked changed. Hears the keys that work
/// anywhere ([`super::commands`]).
#[component]
pub fn Shell() -> Element {
    let collapsed = use_signal(|| false);
    let mut open = use_signal(|| false);
    // True while "go to anything" or the shortcuts are open: the page behind stands still.
    let modal = use_signal(|| false);
    let route = use_route::<Route>();
    let address = route.to_string();
    // The page, without the box the address may have open.
    let here = address.split('#').next().unwrap_or_default().to_string();
    let open_box = super::boxes::open_of(&route).unwrap_or_default();
    let live = use_live_provider();
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
    // Every session as a box, for the pill and the canvas (`views/boxes.rs`).
    let boxes = super::boxes::use_boxes_provider(m.engines.clone(), m.sessions.clone());
    let (mut pill_width, mut grouped) = use_pill_kept();
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
    let switch_theme = use_callback(move |_: ()| {
        let next = next_theme(&look());
        look.set(next.to_string());
        let _ = document::eval(&format!("document.documentElement.dataset.theme = '{next}'; localStorage.setItem('askk-theme', '{next}');"));
    });
    let go = navigator();
    use_effect(move || {
        if let Some(p) = crate::ui::web::app::GOTO() {
            go.push(p.as_str());
            *crate::ui::web::app::GOTO.write() = None;
        }
    });
    // Escape closes what is open: the dashboard's sheet first, then the open box.
    let close = {
        let (here, open_box) = (here.clone(), open_box.clone());
        use_callback(move |_: ()| {
            if open() {
                open.set(false);
            } else if !open_box.is_empty() {
                navigator().push(if here.is_empty() { "/" } else { here.as_str() });
            }
        })
    };
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
        // The pill's width is a number this window keeps: the one look written on the element.
        div { class: if collapsed() { "shell collapsed" } else { "shell" }, style: "--width-panel:{pill_width}px", "inert": modal().then_some("true"),
            Pill { brand: cfg.brand.clone(), boxes: boxes.shown(), counts: boxes.counts(), items: links.clone(), service: live.service(), open_box: open_box.clone(),
                grouped: grouped(), width: pill_width(), collapsed, open,
                on_look: move |id: String| super::boxes::from_tile(&id),
                on_group: move |g: bool| {
                    grouped.set(g);
                    keep("groups", if g { "1".into() } else { "0".into() });
                },
                on_width: move |(w, done): (u32, bool)| {
                    pill_width.set(w);
                    if done {
                        keep("w", w.to_string());
                    }
                },
            }
            main { class: "main",
                Topbar {
                    brand: cfg.brand.clone(),
                    title: links.iter().find(|l| l.to == here).map(|l| l.label.clone()).unwrap_or_else(|| here.rsplit('/').find(|s| !s.is_empty()).unwrap_or_default().to_string()),
                    engines: engine_list,
                    current: crate::ui::features::boxes::engine_of(&open_box).map(String::from).or(engine_of(&here)),
                    light: look() == "light",
                    // An engine is a box: it opens in place on the canvas.
                    on_engine: move |path: String| {
                        let id = format!("engine:{path}");
                        super::boxes::from_tile(&id);
                        navigator().push(crate::ui::features::boxes::link(&id));
                    },
                    on_theme: move |_| switch_theme.call(()),
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
        // Outside the shell, so the page can stand still under them.
        super::commands::Commands { links: links.clone(), light: look() == "light", collapsed, modal,
            on_theme: move |_| switch_theme.call(()), on_close: move |_| close.call(()),
        }
        // The companion is not drawn for now (a novelty; `views/companion.rs` keeps it).
    }
}
