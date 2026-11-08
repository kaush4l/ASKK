use dioxus::prelude::*;

mod api;
mod components;
mod compose;
// The engine runtime lives on the server; the browser build only needs the shared types.
#[cfg_attr(not(feature = "server"), allow(dead_code, unused_imports))]
mod core;
#[cfg(feature = "server")]
mod devtools;
#[cfg_attr(not(feature = "server"), allow(dead_code, unused_imports))]
mod elements;
mod infer;
#[cfg_attr(not(feature = "server"), allow(dead_code))]
mod routes;
mod pr;
mod views;

use views::{Home, RoutePage, Shell};

#[derive(Debug, Clone, Routable, PartialEq)]
#[rustfmt::skip]
pub enum Route {
    #[layout(Shell)]
        // Every URL is resolved against the folders in data/routes (see routes.rs).
        #[route("/")]
        Home {},
        #[route("/:..segments")]
        RoutePage { segments: Vec<String> },
}

const FAVICON: Asset = asset!("/assets/favicon.ico");
const GLASS_CSS: Asset = asset!("/assets/styling/glass.css");
const AMARANTE: Asset = asset!("/assets/fonts/amarante-latin-400-normal.woff2");

fn main() {
    #[cfg(feature = "server")]
    {
        // `--desk <dir>`: load engines, models, routes and theme from another folder.
        let args: Vec<String> = std::env::args().collect();
        if let Some(i) = args.iter().position(|a| a == "--desk") {
            if let Some(d) = args.get(i + 1) {
                std::env::set_var("ASKK_DATA", d);
            }
        }
        api::boot_now();
    }
    dioxus::launch(App);
}

#[component]
fn App() -> Element {
    rsx! {
        document::Link { rel: "icon", href: FAVICON }
        document::Link { rel: "preload", href: AMARANTE, r#as: "font", r#type: "font/woff2", crossorigin: "anonymous" }
        document::Style { "@font-face{{font-family:\"Amarante\";font-style:normal;font-weight:400;font-display:swap;src:url(\"{AMARANTE}\") format(\"woff2\")}}" }
        document::Link { rel: "stylesheet", href: GLASS_CSS }
        Router::<Route> {}
    }
}
