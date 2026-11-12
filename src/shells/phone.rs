//! The phone shell (`mobile` build: iPhone, iPad). One face: the page, full screen, with the
//! companion inside it (a phone has no window outside the app to hold it).
//!
//! Like the Mac shell it is a window on a running host, so it says where the host is before
//! anything asks. A phone app is not started with the user's environment: the address is the
//! one given when the app was built (see `core/places.rs`).
pub fn launch() {
    let host: &'static str = Box::leak(crate::core::places::host_url().into_boxed_str());
    dioxus::fullstack::set_server_url(host);
    dioxus::launch(crate::ui::web::app::App);
}
