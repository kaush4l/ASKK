//! UI surfaces = fold(signals) rendered by Dioxus (MAP hop 12). These
//! modules import askk-core and the host facade only — never askk-engine
//! or askk-inference (ADR-013). Layout (ADR-043, the eliza-style UI
//! package): `app.rs` is the composition root; `components/` holds shared
//! primitives; `features/` holds one module per stage.

pub mod app;
pub mod components;
pub mod features;
