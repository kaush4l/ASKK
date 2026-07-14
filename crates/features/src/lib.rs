//! Feature layer: agent/team/skill config parsing and the tool surface
//! (registry + one folder per feature). Depends on core, state, and
//! inference (MCP/search transports) — never on the engine or browser.

pub mod config;
pub mod tools;

#[cfg(test)]
pub(crate) use askk_state::testutil;
