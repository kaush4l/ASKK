//! The host seam (ADR-009/013): the ONLY place in `crates/web` that imports
//! `askk-runtime` / `askk-inference`. UI components talk to [`boot`]'s
//! `HarnessHandle` facade and receive core types + plain structs only.

pub mod boot;
pub mod browser;
pub mod config;
pub mod dom;
pub mod fetch;
pub mod jstool;
pub mod opfs;
pub mod profile;
pub mod speech;
pub mod vm;
