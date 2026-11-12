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
//! | `boxes.rs` | every session as a box: the order, what "done" is for one window, a box as one line; which box a window has open, which it pinned, how the pill is grouped and searched |
//! | `markdown.rs` | an answer's Markdown as plain values, with what is safe decided once |
//! | `code.rs` | a block of code as pieces to colour (six languages, one small reader) |
//! | `keys.rs` | what a press of the keyboard does anywhere in a window |
//! | `palette.rs` | "go to anything": every box, page and action in one list, found by typing |
//! | `queue.rs` | messages written while a box works: they wait, in order, and can be taken back |
//! | `asks.rs` | what an engine waits for the owner to say, and the answer as a message |
//! | `terminal.rs` | a terminal's screen as cells to draw; a key as the bytes a program reads |
pub mod asks;
pub mod boxes;
pub mod code;
pub mod keys;
pub mod markdown;
pub mod palette;
pub mod queue;
pub mod run;
pub mod service;
pub mod talk;
pub mod terminal;
