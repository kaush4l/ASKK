//! askk-features — self-contained feature folders. [`config`] parses
//! agent/team/skill/env config (config is data; nothing hardcodes an
//! agent); [`tools`] is the tool surface: a registry plus one folder per
//! feature, each folder owning its own tools. Delegation (incl. `spawn`)
//! is NOT here — it lives in askk-engine under `run/delegation/`.
//!
//! Imports: core, state, inference (MCP/search transports) — never the
//! engine or browser. May be imported by: engine, browser.
//!
//! See MAP.md and docs/NAVIGATION.md.

pub mod config;
pub mod tools;

#[cfg(test)]
pub(crate) use askk_state::testutil;
