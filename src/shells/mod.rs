//! # Shells: what holds the window
//!
//! A shell is thin: it opens faces and draws `ui::app::App` in them. It holds no engine, no
//! store, no tool; it asks the host through `api/`.
//!
//! | shell | build | faces |
//! | --- | --- | --- |
//! | `web.rs` | `web` (browser) and `server` (first HTML) | the page |
//! | `mac/` | `desktop` on macOS | window, tray, dock, notch, companion — one file each |
//! | `phone.rs` | `mobile` (iPhone, iPad) | the page, with the companion inside it |
#[cfg(all(feature = "desktop", target_os = "macos"))]
pub mod mac;
#[cfg(feature = "mobile")]
pub mod phone;
pub mod web;

/// Open the shell this build is for.
pub fn launch() {
    #[cfg(all(feature = "desktop", target_os = "macos"))]
    mac::launch();
    #[cfg(all(feature = "mobile", not(all(feature = "desktop", target_os = "macos"))))]
    phone::launch();
    #[cfg(not(any(feature = "mobile", all(feature = "desktop", target_os = "macos"))))]
    web::launch();
}
