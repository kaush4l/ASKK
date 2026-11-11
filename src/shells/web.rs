//! The browser shell. In the `server` build the same call serves the first HTML and the API.
#[cfg_attr(any(feature = "mobile", all(feature = "desktop", target_os = "macos")), allow(dead_code))]
pub fn launch() {
    // The server also answers the same questions over plain HTTP, for other UIs (api/ask.rs).
    // The server also answers the same questions over plain HTTP, for other UIs (api/ask.rs).
    #[cfg(feature = "server")]
    dioxus::serve(|| async { Ok(crate::api::ask::routes(dioxus::server::router(crate::ui::app::App))) });
    #[cfg(not(feature = "server"))]
    dioxus::launch(crate::ui::app::App);
}
