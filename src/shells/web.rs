//! The browser shell. In the `server` build the same call serves the first HTML and the API.
#[cfg_attr(any(feature = "mobile", all(feature = "desktop", target_os = "macos")), allow(dead_code))]
pub fn launch() {
    // The server also answers the same questions over plain HTTP, for other UIs (api/ask.rs).
    // Every request, to a page or to a question, is first held against who may ask (`guarded`).
    #[cfg(feature = "server")]
    dioxus::serve(|| async { Ok(crate::api::ask::guarded(crate::api::ask::routes(dioxus::server::router(crate::ui::web::app::App)))) });
    #[cfg(not(feature = "server"))]
    dioxus::launch(crate::ui::web::app::App);
}
