//! Sessions: conversations with other agents' harnesses (`core/session.rs`).
use crate::core::session::{HarnessInfo, Session};
use dioxus::prelude::*;

// The answers are plain functions in `answers`; these are their Dioxus form (see `wire!`).
#[cfg(feature = "server")]
mod answers;

wire! {
    harnesses() -> Vec<HarnessInfo>;
    sessions() -> Vec<Session>;
    session_open(harness: String, title: String, project: String) -> Session;
    session_prompt(id: u64, text: String) -> ();
}
