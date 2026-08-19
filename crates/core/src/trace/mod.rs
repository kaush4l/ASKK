//! THE TOOL TRACE: what the agent called, what came back, and who asked for it.
//!
//! `pane` owns which calls a trace holds and in what order; `row` renders one of
//! them and `row/args` renders what it was asked to do; `requested_by` answers
//! who asked — page, agent or sub-agent; `from_worker` is a sub-agent's trace as
//! its own Worker reported it; `inflight` is the call that has not come back
//! yet; `trustworthy` decides whether a row may print "ok"; `row_location`
//! answers which view a row ended up in.

mod from_worker;
pub(crate) mod inflight;
pub(crate) mod pane;
pub(crate) mod requested_by;
mod row;
pub(crate) mod row_location;
pub(crate) mod trustworthy;
