//! UI surfaces = fold(signals) rendered by Dioxus (MAP hop 12). These
//! modules import askk-core and the host facade only — never askk-runtime
//! or askk-inference (ADR-013).

pub mod actions;
pub mod app;
pub mod settings;
pub mod timeline;
