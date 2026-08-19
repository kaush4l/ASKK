//! LONG-RUNNING PROCESSES: the convention they are kept in, the four tools that
//! supervise them, and the pane that shows what is running.
//!
//! `convention` is what all four tools share — the directory layout and the
//! dispatch; `start` writes it, `table` lists every process, `watch` reads and
//! stops one; `pane` owns the module and its routes and `rows` is the
//! projection those routes render.

pub(crate) mod convention;
pub(crate) mod pane;
mod rows;
mod start;
mod table;
mod watch;
