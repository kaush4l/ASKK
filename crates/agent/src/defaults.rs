//! The three numbers an agent file may override, in one audited place. Lifted
//! out of `state.rs` so that file holds the 200-line rule (I12) with the stage
//! cursor in it, and because these are the only constants a `serde(default)`
//! path names — keeping them together is what makes "what does absence mean?"
//! one file to read.

/// How far a turn may go before the machine stops it. Sixty-four, not four:
/// four rounds cannot finish any real task — read a file, run a build, read
/// the errors, edit, build again is already five — and the number exists to
/// stop a MODEL LOOPING, not to stop an agent working. It is still a hard
/// deterministic wall, and every agent may set its own.
pub(crate) fn default_max_rounds() -> u16 {
    64
}

/// Python `Engine.compact_at` / `keep_recent` defaults.
pub(crate) fn default_compact_at() -> usize {
    75
}

pub(crate) fn default_keep_recent() -> usize {
    24
}
