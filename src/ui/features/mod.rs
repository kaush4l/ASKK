//! # Features: what a person can do, before any drawing
//!
//! One file per thing a person does. Each turns answers from `api/` into plain values and
//! words that every UI shows in its own way.
//!
//! | file | the feature |
//! | --- | --- |
//! | `talk.rs` | ask an engine, see what its loop did, read the conversation |
//! | `run.rs` | read one run: how it stands, its stages, its tool calls; what an engine at work is doing |
//! | `service.rs` | tell whether the service is the same, restarted, rebuilt or gone; say its status |
//! | `boxes.rs` | every session as a box: the order, what "done" is for one window, a box as one line |
//! | `terminals.rs` | a box that is a screen: what a key sends, what a pane shows, the keys that work the panes |
pub mod boxes;
pub mod run;
pub mod service;
pub mod talk;
pub mod terminals;
