//! Views: pages assembled from components. What they show comes from the backend.
//! Which view sits at which URL is data: see [`crate::routes`].
mod chat;
mod components_view;
mod dashboard;
mod engine;
mod layout;
mod models;
mod page;
mod pr;
mod shell;
mod theme;
pub use chat::ChatView;
pub use components_view::ComponentsView;
pub use dashboard::Dashboard;
pub use engine::EngineView;
pub use layout::LayoutView;
pub use models::ModelsView;
pub use page::{Home, RoutePage};
pub use pr::PrView;
pub use shell::Shell;
pub use theme::ThemeView;

use dioxus::prelude::*;

/// A built-in view by name (a `view` node); the names are [`crate::compose::VIEWS`].
#[component]
pub fn Builtin(name: String) -> Element {
    match name.as_str() {
        "chat" => rsx! { ChatView {} },
        "pr" => rsx! { PrView {} },
        "dashboard" => rsx! { Dashboard {} },
        "engine" => rsx! { EngineView {} },
        "models" => rsx! { ModelsView {} },
        "components" => rsx! { ComponentsView {} },
        "theme" => rsx! { ThemeView {} },
        "layout" => rsx! { LayoutView {} },
        other => rsx! { p { class: "dim", "unknown view {other}" } },
    }
}
