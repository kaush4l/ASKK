//! Views: pages assembled from components. What they show comes from the backend.
//! Which view sits at which URL is data: see [`crate::core::routes`].
mod asks;
pub mod boxes;
mod bubble;
mod canvas;
pub mod canvas_math;
mod chat;
pub mod companion;
mod dashboard;
mod engine;
mod glance;
mod ide;
mod layout;
pub mod live;
pub mod loops;
mod models;
mod page;
pub mod prompt;
mod rooms;
mod sessions;
mod settings;
mod shell;
mod theme;
pub use asks::AsksView;
pub use canvas::CanvasView;
pub use chat::ChatView;
pub use dashboard::Dashboard;
pub use engine::EngineView;
pub use glance::GlanceView;
pub use ide::IdeView;
pub use layout::LayoutView;
pub use models::ModelsView;
pub use page::{Home, RoutePage};
pub use settings::SettingsView;
pub use shell::Shell;
pub use theme::ThemeView;

use dioxus::prelude::*;

/// A built-in view by name (a `view` node); the names are [`crate::core::node::VIEWS`]. `arg`
/// is the node's `label`: what the view opens with (the chat: an engine path).
#[component]
pub fn Builtin(name: String, #[props(default)] arg: String) -> Element {
    match name.as_str() {
        "chat" => rsx! { ChatView { arg } },
        "boxes" => rsx! { boxes::BoxesView {} },
        "canvas" => rsx! { CanvasView {} },
        "settings" => rsx! { SettingsView {} },
        "dashboard" => rsx! { Dashboard {} },
        "engine" => rsx! { EngineView {} },
        "ide" => rsx! { IdeView {} },
        "models" => rsx! { ModelsView {} },
        "theme" => rsx! { ThemeView {} },
        "layout" => rsx! { LayoutView {} },
        "asks" => rsx! { AsksView {} },
        "glance" => rsx! { GlanceView {} },
        "sessions" => rsx! { sessions::SessionsView {} },
        "rooms" => rsx! { rooms::RoomsView {} },
        other => rsx! { p { class: "dim", "unknown view {other}" } },
    }
}
