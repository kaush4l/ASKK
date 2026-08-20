//! WHO IS LOADED: the roster of agents this browser is running, where each one
//! came from, and the routes that let a person write a new one.
//!
//! `install` puts an agent onto the running `App`; `briefs` puts the words
//! every STAGE enters with onto it; `roster` decides which copy
//! of a name wins and reconciles the app with what has been authored;
//! `authored` is the fold that says what THIS browser wrote; `authoring` is the
//! three routes that write, delete and read one back; `pane` and `card` render
//! the listing; `card_sentences` writes every derived sentence those two print.

pub(crate) mod authored;
mod authoring;
pub(crate) mod briefs;
mod card;
pub(crate) mod card_sentences;
pub(crate) mod install;
pub(crate) mod pane;
pub(crate) mod roster;
