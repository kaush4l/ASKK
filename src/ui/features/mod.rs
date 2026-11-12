//! # Features: what a person can do, before any drawing
//!
//! One file per thing a person does. Each turns answers from `api/` into plain values and
//! words that every UI shows in its own way.
//!
//! | file | the feature |
//! | --- | --- |
//! | `talk.rs` | ask an engine, see what its loop did, read the conversation |
//! | `service.rs` | tell whether the service is the same, restarted, rebuilt or gone; say its status |
pub mod boxes;
pub mod service;
pub mod talk;
