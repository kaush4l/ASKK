//! ONE AGENT'S OWN LOG: what compaction guarantees about it, and the bytes.
//!
//! `decisions` is the pure half — what to append, what to keep, what a
//! compaction must leave behind; `store` is the I/O half that moves those
//! decisions through `StorePort`.

pub(crate) mod decisions;
pub(crate) mod store;
