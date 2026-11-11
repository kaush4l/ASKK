//! The root of every window: assets, then the router. Which page sits at which URL is data
//! (`core/routes.rs`).
use super::views::{Home, RoutePage, Shell};
use dioxus::prelude::*;

#[derive(Debug, Clone, Routable, PartialEq)]
#[rustfmt::skip]
pub enum Route {
    #[layout(Shell)]
        // Every URL is resolved against the page folders in the store (see core/routes.rs).
        #[route("/")]
        Home {},
        #[route("/:..segments")]
        RoutePage { segments: Vec<String> },
}

const FAVICON: Asset = asset!("/assets/favicon.ico");
const GLASS_CSS: Asset = asset!("/assets/styling/glass.css");
const AMARANTE: Asset = asset!("/assets/fonts/amarante-latin-400-normal.woff2");

/// A face without the window's sidebar and top bar (the notch panel provides this).
#[derive(Clone, Copy)]
pub struct Bare;

/// A page a shell asks the window to open (a tray menu line); the layout goes there.
pub static GOTO: GlobalSignal<Option<String>> = Signal::global(|| None);

/// What every window loads before it draws.
#[component]
pub fn Assets() -> Element {
    rsx! {
        document::Link { rel: "icon", href: FAVICON }
        document::Link { rel: "preload", href: AMARANTE, r#as: "font", r#type: "font/woff2", crossorigin: "anonymous" }
        document::Style { "@font-face{{font-family:\"Amarante\";font-style:normal;font-weight:400;font-display:swap;src:url(\"{AMARANTE}\") format(\"woff2\")}}" }
        document::Link { rel: "stylesheet", href: GLASS_CSS }
    }
}

#[component]
pub fn App() -> Element {
    rsx! {
        Assets {}
        Router::<Route> {}
    }
}
