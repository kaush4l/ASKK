//! THE WORKSPACE'S FILES, as a person browses them.
//!
//! `pane` owns the module and its two routes; `listing` folds the newest folder
//! listing out of the log and `rows` turns it into one line per entry;
//! `empty_states` says what an empty or missing folder shows; `permitted`
//! answers whether this pane may show a folder at all; `find` is the
//! `find_files` tool, which is the same subject reached from the agent's side.

pub(crate) mod empty_states;
pub(crate) mod find;
pub(crate) mod listing;
pub(crate) mod pane;
pub(crate) mod permitted;
pub(crate) mod rows;
