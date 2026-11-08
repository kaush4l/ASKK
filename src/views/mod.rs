//! Views: pages assembled from components. What they show comes from the backend.
mod components_view;
mod dashboard;
mod engine;
mod models;
mod shell;
pub use components_view::ComponentsView;
pub use dashboard::Dashboard;
pub use engine::EngineView;
pub use models::ModelsView;
pub use shell::Shell;
mod theme;
pub use theme::ThemeView;
mod layout;
pub use layout::LayoutView;
