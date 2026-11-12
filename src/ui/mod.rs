//! # UI: everything that draws (Dioxus lives here)
//!
//! | folder | holds |
//! | --- | --- |
//! | `app.rs` | the root: assets, router |
//! | `render.rs` | the one place a `Node` becomes pixels |
//! | `figure.rs` | the one place a figure (plot, graph, sketch, table) becomes a drawing |
//! | `kit/` | standard parts (button, card, badge, tabs…), from rust-ui.com |
//! | `components/` | this app's own building blocks (pane, glass, icon, sidebar…) |
//! | `views/` | built-in views a page can place by name |
//!
//! The UI never touches the host: it asks through `api/`.
pub mod app;
pub mod components;
pub mod figure;
pub mod kit;
pub mod render;
pub mod views;
