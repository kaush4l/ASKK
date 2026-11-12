//! The root of every window: assets, then the router. Which page sits at which URL is data
//! (`core/routes.rs`).
//!
//! What follows the `#` of an address names the box that is open on the canvas
//! (`/#engine:askk/developer`; `ui/features/boxes.rs`, `opened`). It is part of the route, so
//! a reload, a link and the back button all open the same box, and the page under it is not
//! asked for again when a box opens or closes.
use super::views::{Home, RoutePage, Shell};
use dioxus::prelude::*;

#[derive(Debug, Clone, Routable, PartialEq)]
#[rustfmt::skip]
pub enum Route {
    #[layout(Shell)]
        // Every URL is resolved against the page folders in the store (see core/routes.rs).
        #[route("/#:open")]
        Home { open: String },
        #[route("/:..segments#:open")]
        RoutePage { segments: Vec<String>, open: String },
}

#[cfg(not(feature = "local"))]
const FAVICON: Asset = asset!("/assets/favicon.ico");
#[cfg(not(feature = "local"))]
const GLASS_CSS: Asset = asset!("/assets/styling/glass.css");
/// The talk screen and how things arrive; it names glass tokens only, so it is loaded after.
#[cfg(not(feature = "local"))]
const TALK_CSS: Asset = asset!("/assets/styling/talk.css");
/// The kit's looks, written by `dx` from `tailwind.css` (see `ui/kit/mod.rs`).
#[cfg(not(feature = "local"))]
const KIT_CSS: Asset = asset!("/assets/tailwind.css");
#[cfg(not(feature = "local"))]
const AMARANTE: Asset = asset!("/assets/fonts/amarante-latin-400-normal.woff2");

/// A face without the window's sidebar and top bar (the notch panel provides this).
#[derive(Clone, Copy)]
pub struct Bare;

/// A page a shell asks the window to open (a tray menu line); the layout goes there.
pub static GOTO: GlobalSignal<Option<String>> = Signal::global(|| None);

/// What every window loads before it draws.
#[cfg(not(feature = "local"))]
#[component]
pub fn Assets() -> Element {
    rsx! {
        document::Link { rel: "icon", href: FAVICON }
        document::Link { rel: "preload", href: AMARANTE, r#as: "font", r#type: "font/woff2", crossorigin: "anonymous" }
        document::Style { "@font-face{{font-family:\"Amarante\";font-style:normal;font-weight:400;font-display:swap;src:url(\"{AMARANTE}\") format(\"woff2\")}}" }
        document::Link { rel: "stylesheet", href: KIT_CSS }
        document::Link { rel: "stylesheet", href: GLASS_CSS }
        document::Link { rel: "stylesheet", href: TALK_CSS }
    }
}

/// The tab is built without dx, which is what bundles `asset!` files: `scripts/local.sh` copies
/// `assets/` beside the page instead, and the page names them under its base path (the
/// `DIOXUS_ASSET_ROOT` meta; `/ASKK` on GitHub Pages).
#[cfg(feature = "local")]
#[component]
pub fn Assets() -> Element {
    let base = dioxus::cli_config::base_path().unwrap_or_default();
    let base = base.trim_end_matches('/');
    rsx! {
        document::Link { rel: "icon", href: "{base}/assets/favicon.ico" }
        document::Link { rel: "stylesheet", href: "{base}/assets/styling/tab.css" }
        document::Link { rel: "stylesheet", href: "{base}/assets/tailwind.css" }
        document::Link { rel: "stylesheet", href: "{base}/assets/styling/glass.css" }
        document::Link { rel: "stylesheet", href: "{base}/assets/styling/talk.css" }
    }
}

#[component]
pub fn App() -> Element {
    rsx! {
        Assets {}
        Router::<Route> {}
    }
}
