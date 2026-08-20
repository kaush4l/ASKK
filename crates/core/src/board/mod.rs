//! THE STATUS BOARD: one row per loaded agent, the tiles that summarise the
//! fleet above it, and the reading each row takes off the log.
//!
//! `pane` owns the module and its route; `row` lays one card out and `row/`
//! decides what that card says; `tiles` is the strip above the grid. The other
//! three are the folds those two read, one subject each: `stage` answers which
//! part of a turn is running, `errand` answers what this agent was asked to do
//! and what it answered, and `offer` answers what there is to give it at all —
//! the first two off the log, the third off the roster.

mod errand;
mod offer;
pub(crate) mod pane;
mod row;
mod stage;
mod tiles;
