//! WHAT A FAILED TURN LOOKS LIKE TO THE PERSON READING IT, and every wording
//! around it.
//!
//! `card` is the disclosure a failure is shown in; `what_to_do` picks the
//! actionable sentence from the typed error; `within_turn` reports what went
//! wrong inside a turn that still ended well; `from_worker` is the same for a
//! sub-agent's failure once it has crossed `postMessage`; `ending` folds how the
//! last turn ended and `ending_kind` names each one; `loop_note` is what the
//! machine says when it moves a turn along rather than ending it;
//! `stopped_notice` is a run a person halted; `dedupe` collapses the same
//! failure repeated; `local_network` holds the two remedies that turn on where
//! the endpoint lives, one of which has to name two browsers; `second_tab` is
//! what a tab that does not own the log says instead of taking a turn.

pub(crate) mod card;
pub(crate) mod dedupe;
pub(crate) mod ending;
mod ending_kind;
pub(crate) mod from_worker;
pub(crate) mod local_network;
pub(crate) mod loop_note;
pub(crate) mod second_tab;
pub(crate) mod stopped_notice;
pub(crate) mod what_to_do;
pub(crate) mod within_turn;
