//! Models: list, save, discover, and one direct call.
pub use crate::core::models::{Found, Models, MAX_TOKENS, METHODS, OPENAI_URL};
use dioxus::prelude::*;

// The answers are plain functions in `answers`; these are their Dioxus form (see `wire!`).
#[cfg(feature = "server")]
mod answers;
#[cfg(feature = "local")]
pub use super::tab::{discover_models, infer, list_models, save_models};

wire! {
    list_models() -> Models;
    save_models(models: Models) -> ();
    discover_models(method: String, base_url: String, token_env: String) -> Vec<Found>;
    infer(model: String, prompt: String) -> String;
}
