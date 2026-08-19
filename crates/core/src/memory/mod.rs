//! MEMORY, HOSTED: where one agent's own kept lines actually live, and the one
//! reader both halves of the faculty share. `agent::memory` decides; this
//! directory moves the bytes, exactly as `crate::space` does for the space.
//!
//! **It lives in `Ports::store`, not in `Ports::spaces`, and that is the whole
//! placement decision.** `store` is THIS agent's own database — `harness` for
//! the page and `harness-agent-<name>` inside a sub-agent's Worker
//! (`crates/adapters_web/src/lib.rs`, `crates/adapters_web/src/worker.rs`) —
//! so a line kept by one agent is unreachable from another's process without
//! anybody enforcing it. `spaces` is the opposite by construction: ONE database
//! every Worker opens (`crate::space::shared`), which is what a shared space
//! needs and precisely what private memory must not have.
//!
//! **The key layout is `memory/<stamp>`, one key per line.** One mutation is
//! therefore one store operation, with no half of a single put and no
//! read-modify-write of a whole document — the rule
//! `crate::space::shared` states at `crates/core/src/space/shared.rs:11-14`
//! and the reason it states it. The prefix is free: the only other things this
//! store holds are `meta/schema_version` and `events/`
//! (`crates/core/src/boot.rs:13`, `crates/core/src/boot.rs:102`) and
//! `log/<agent>/` (`crates/core/src/log/decisions.rs`, `prefix`).
//!
//! Two halves sit beside this index: [`sense`] fills the prompt block before
//! every model call, [`host`] runs `keep` and `discard`. Both read through
//! [`load`], and neither caches.

pub(crate) mod host;
pub(crate) mod sense;

use kernel::KvStore;

/// The one prefix this subject owns in `Ports::store`.
const PREFIX: &str = "memory/";

/// Every line this agent has kept, oldest first. A key that will not read costs
/// that line and nothing else — refusing the turn over it would cost the
/// conversation instead (the rule `crates/core/src/space/shared.rs:30-32`
/// states for the space, and the reason is the same one).
pub(crate) async fn load(kv: &dyn KvStore) -> agent::Memory {
    let mut memory = agent::Memory::default();
    for key in kv.list_prefix(PREFIX).await.unwrap_or_default() {
        let Ok(Some(line)) = kv.get(&key).await else {
            continue;
        };
        memory.notes.push(line);
    }
    // `list_prefix` comes back sorted and the stamp is time-first, so the lines
    // arrive in the order they were kept. The cap applies on READ as well as on
    // write, so a reader that arrives between a keep and its trim still sees
    // `MEMORY_LIMIT` lines and not one more.
    memory.trim();
    memory
}
