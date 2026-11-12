//! # Features: what a person can do, before any drawing
//!
//! One file per thing a person does. Each turns answers from `api/` into plain values and
//! words that every UI shows in its own way.
//!
//! | file | the feature |
//! | --- | --- |
//! | `talk.rs` | ask an engine, see what its loop did, read the conversation |
//! | `run.rs` | read one run: how it stands, its stages, its tool calls; what an engine at work is doing |
pub mod run;
pub mod talk;
