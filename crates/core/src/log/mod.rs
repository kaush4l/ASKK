//! ONE AGENT'S OWN LOG: what compaction guarantees about it, and the bytes.
//!
//! `decisions` is the pure half — what to append, what to keep, what a
//! compaction must leave behind; `store` is the I/O half that moves those
//! decisions through `StorePort`; `writership` decides whether this context is
//! allowed to move anything through it at all, which is the question two tabs
//! of one page made real.

pub(crate) mod decisions;
pub(crate) mod store;
pub(crate) mod writership;
