//! THE WORKSPACE SCROLLBACK: every command run in this agent's Alpine and what
//! came back.
//!
//! `pane` owns the module and its routes; `row_selection` decides which
//! commands the scrollback shows and whose they are; `row` renders one of them;
//! `panel` is the scroller and its empty state; `footnote` is the note under it
//! saying whose folder these commands ran in.

mod footnote;
pub(crate) mod pane;
mod panel;
pub(crate) mod row;
mod row_selection;
