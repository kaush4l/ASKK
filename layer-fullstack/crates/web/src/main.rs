//! WASM entry point for the web shell.
//!
//! On `wasm32-unknown-unknown` this launches the Dioxus app in the
//! browser. On any native target it is a stub, so that
//! `cargo build --workspace` (native) stays green — the native side
//! renders this same `App` through the Actix server with dioxus-ssr.

#[cfg(target_arch = "wasm32")]
fn main() {
    dioxus::launch(layer_web::App);
}

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    eprintln!("layer-web is a WASM binary: build it with");
    eprintln!("  cargo build -p layer-web --target wasm32-unknown-unknown");
    eprintln!("On native targets, the Actix server (layer-server) renders this App with dioxus-ssr.");
}
