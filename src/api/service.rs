//! Service: who the running askk is, reading the home again, and asking it to finish.
use crate::core::reread::Reloaded;
use crate::core::service::Hello;
use crate::core::settings::Settings;
use dioxus::prelude::*;

// The answers are plain functions in `answers`; these are their Dioxus form (see `wire!`).
#[cfg(any(feature = "server", feature = "local"))]
mod answers;
#[cfg(feature = "local")]
pub use answers::*;

wire! {
    hello() -> Hello;
    reload() -> Reloaded;
    service_settings() -> Settings;
    stop_service() -> String;
}
