//! Action gate + pending confirmations (MAP hop 8, ADR-006). The model just
//! calls tools; the harness classifies by declared effect, applies
//! `ActionPolicy`, and audits every verdict as an `ActionRecord` signal.

pub mod gate;

pub use gate::{ActionGate, PendingActions};
