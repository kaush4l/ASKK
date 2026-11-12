//! # Web: the UI drawn as a page (Dioxus lives here)
//!
//! One source for every place a page can be shown: a browser, the Mac app, a phone or tablet.
//!
//! | folder | holds |
//! | --- | --- |
//! | `app.rs` | the root: assets, router |
//! | `render.rs` | the one place a `Node` becomes pixels |
//! | `figure.rs` | the one place a figure (plot, graph, sketch, table) becomes a drawing |
//! | `kit/` | standard parts (button, card, badge, tabs…), from rust-ui.com |
//! | `components/` | this app's own building blocks (pane, glass, icon, sidebar…) |
//! | `views/` | built-in views a page can place by name |
//! | `tab.rs` | in the tab build (no server), what a server would give: its first answers |
//!
//! The UI never touches the host: it asks through `api/`.
pub mod app;
pub mod components;
pub mod figure;
pub mod kit;
pub mod render;
#[cfg(feature = "local")]
pub mod tab;
pub mod views;
