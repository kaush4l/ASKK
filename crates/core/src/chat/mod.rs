//! ONE AGENT'S CONVERSATION: the route that starts a turn, the transcript that
//! projects it out of the log, and every sentence the page says about it.
//!
//! `pane` owns the module and its routes; `transcript` renders the fold and its
//! neighbours split it by what wrote each line; `fold` answers what the log says
//! about itself; `clear` starts again; `heading`, `memory_line`, `steer_notice`
//! and `call_announcement` are the page's own lines around the messages;
//! `markdown` is the small subset a reply may carry.

pub(crate) mod call_announcement;
pub(crate) mod clear;
pub(crate) mod fold;
mod heading;
pub(crate) mod markdown;
mod memory_line;
pub(crate) mod pane;
mod steer_notice;
mod transcript;
