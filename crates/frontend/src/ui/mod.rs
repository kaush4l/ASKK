//! UI surfaces = fold(signals) rendered by Dioxus (MAP hop 12). These
//! modules import askk-core and the host facade only — never askk-runtime
//! or askk-inference (ADR-013). Layout is kiln's: a persistent shell
//! (header / rails / avatar bar) around one swappable stage.

pub mod actions;
pub mod agents;
pub mod app;
pub mod artifacts;
pub mod chat;
pub mod dashboard;
pub mod manifest;
pub mod markdown;
pub mod settings;
pub mod shell;
pub mod vm;
