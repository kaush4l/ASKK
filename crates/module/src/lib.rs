//! The Module contract (§6, ADR-004 Option B: data-first). A module IS a
//! manifest record plus a logic reference — for built-ins and forged alike —
//! so there is deliberately no `trait Module` here: a trait would let
//! built-ins exist as nameable types the rest of the system could call
//! directly, and I9 would die silently. Dispatch happens in exactly one place
//! (`core::dispatch`); this crate owns what a module *is*, the registry fold,
//! the generated affordances, and the escaping view primitives.
//!
//! G3 interface freeze: types and signatures only; bodies are `todo!()`.

// G3 freeze: private fields are unread while bodies are todo!(); lift at G4.
#![allow(dead_code)]

mod affordance;
mod error;
mod manifest;
mod registry;
pub mod view;

pub use affordance::affordances;
pub use error::ModuleError;
pub use manifest::{
    run_install_tests, Assertion, Case, DataSchema, Manifest, RouteSpec, SectionSpec, SlotSpec,
    Tier,
};
pub use registry::{Logic, Registered, Registry, RegistryEvent};
