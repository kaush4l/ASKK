use dioxus::prelude::*;

mod api;
mod components;
mod compose;
// The engine runtime lives on the server; the browser build only needs the shared types.
#[cfg_attr(not(feature = "server"), allow(dead_code, unused_imports))]
mod core;
#[cfg_attr(not(feature = "server"), allow(dead_code, unused_imports))]
mod elements;
mod infer;
mod views;

use views::{ComponentsView, Dashboard, EngineView, LayoutView, ModelsView, Shell, ThemeView};

#[derive(Debug, Clone, Routable, PartialEq)]
#[rustfmt::skip]
pub enum Route {
    #[layout(Shell)]
        #[route("/")]
        Dashboard {},
        #[route("/e/:..path")]
        EngineView { path: Vec<String> },
        #[route("/models")]
        ModelsView {},
        #[route("/components")]
        ComponentsView {},
        #[route("/theme")]
        ThemeView {},
        #[route("/layout")]
        LayoutView {},
}

const FAVICON: Asset = asset!("/assets/favicon.ico");
const GLASS_CSS: Asset = asset!("/assets/styling/glass.css");

fn main() {
    #[cfg(feature = "server")]
    api::boot_now();
    dioxus::launch(App);
}

#[component]
fn App() -> Element {
    rsx! {
        document::Link { rel: "icon", href: FAVICON }
        document::Link { rel: "stylesheet", href: GLASS_CSS }
        Router::<Route> {}
    }
}
