//! THE IDENTITY OF A RENDERED DOCUMENT — content addressing, in a file of its
//! own because `render.rs` beside it is at I12's ceiling and because this asks a
//! different question: `render` knows how one provider wants to hear the paper,
//! this knows nothing about providers at all.

use crate::render::Message;

/// Content hash of a rendered document, for the per-turn event-log record
/// (ADR-009: hash + fidelities persist; full text only on request — it
/// contains everything personal). Hand-rolled FNV-style, no crypto dependency:
/// the requirement is stable identity in a diffable log, not collision
/// resistance.
pub fn content_hash(messages: &[Message]) -> String {
    // FNV-1a 64 over the serde_json bytes of the messages.
    let bytes = serde_json::to_string(messages).expect("messages serialize");
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes.bytes() {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}
