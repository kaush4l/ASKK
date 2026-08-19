//! THE STATUS BOARD: one row per loaded agent, the tiles that summarise the
//! fleet above it, and the reading each row takes off the log.
//!
//! `pane` owns the module and its route; `row` lays one card out and `row/`
//! decides what that card says; `tiles` is the strip above the grid; `stage`
//! answers which part of a turn is running, which is what a row's live line
//! reports and its only reader.

pub(crate) mod pane;
mod row;
mod stage;
mod tiles;
