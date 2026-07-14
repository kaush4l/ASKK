//! askk-browser — the host seam (ADR-009/013): the ONLY wasm/web_sys crate,
//! and the only crate that imports askk-engine. Host adapters live here —
//! OPFS stores, fetch transport, DOM, cross-tab bus, VM serial, speech,
//! local LLM, config loading — plus the [`boot`] facade: frontend talks to
//! `HarnessHandle` and receives core types + plain structs only.
//!
//! May import anything below: core, inference, state, features, engine.
//! Imported by: frontend only.
//!
//! See MAP.md and docs/NAVIGATION.md.

pub mod artifacts;
pub mod boot;
pub mod browser;
pub mod bus;
pub mod config;
pub mod dom;
pub mod fetch;
pub mod jstool;
pub mod local_llm;
pub mod opfs;
pub mod profile;
pub mod speech;
pub mod vm;
