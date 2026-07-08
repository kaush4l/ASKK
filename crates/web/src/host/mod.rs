//! The host seam (ADR-009/013): the ONLY place in `crates/web` that imports
//! `askk-runtime` / `askk-inference`. UI components talk to [`boot`]'s
//! `HarnessHandle` facade and receive core types + plain structs only.

pub mod boot;
pub mod browser;
pub mod fetch;
pub mod opfs;
