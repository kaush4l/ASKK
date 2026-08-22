//! The ACTION half of the memory faculty: the host that RUNS `keep` and
//! `discard`. `agent::Memory` decides what a call means and what it says back;
//! this performs the ONE store operation the decision asked for.

use std::cell::Cell;
use std::rc::Rc;

use agent::{Kept, MEMORY_LIMIT};
use context::Args;
use kernel::{BoxFuture, ClockPort, KvStore, StoreError, StorePort};

use crate::faculty::ToolHost;
use crate::memory::{load, PREFIX};

/// The host half of `agent::faculty::memory`'s two tools.
///
/// `writes` is a per-host counter and it is load-bearing: two `keep` calls
/// inside one turn can land in the same millisecond, and a key made of the
/// clock alone would be the SAME key for both — the second put would overwrite
/// the first and one of the lines would vanish with nobody told. The space
/// solves the same problem for its notes with two random bytes
/// (`crates/core/src/space/shared.rs:157-168`); memory is private to one
/// process, so a counter is enough and is exact WITHIN ONE PROCESS. It restarts
/// at zero on the next boot, where the clock has moved on and carries the
/// uniqueness instead.
pub(crate) struct MemoryHost {
    store: Rc<dyn StorePort>,
    clock: Rc<dyn ClockPort>,
    writes: Cell<u32>,
}

impl MemoryHost {
    pub(crate) fn new(store: Rc<dyn StorePort>, clock: Rc<dyn ClockPort>) -> MemoryHost {
        MemoryHost {
            store,
            clock,
            writes: Cell::new(0),
        }
    }

    /// The next key: the clock first so `list_prefix`'s sorted answer IS the
    /// order the lines were kept in, then the counter to break a tie inside one
    /// millisecond.
    fn stamp(&self) -> String {
        let nth = self.writes.get();
        self.writes.set(nth.wrapping_add(1));
        format!("{PREFIX}{:013}-{nth:04}", self.clock.now().0)
    }

    /// Perform the one operation the mutation asked for, and nothing else.
    async fn perform(&self, kv: &dyn KvStore, kept: Option<Kept>) -> Result<(), String> {
        let fail = |e: StoreError| format!("{e:?}");
        match kept {
            // The pure half already refused, in words the model can act on.
            // Nothing was asked for that could be done, so there is nothing to
            // write and nothing has failed.
            None => Ok(()),
            Some(Kept::Line { line }) => {
                kv.put(&self.stamp(), &line).await.map_err(fail)?;
                // The trim deletes keys that are ALREADY surplus, oldest first
                // — the same shape the space's note trim has, and the same
                // reason: a trim that computed what to keep could remove a line
                // a concurrent reader still needed.
                let keys = kv.list_prefix(PREFIX).await.map_err(fail)?;
                for stale in keys.iter().take(keys.len().saturating_sub(MEMORY_LIMIT)) {
                    kv.delete(stale).await.map_err(fail)?;
                }
                Ok(())
            }
            Some(Kept::Dropped { line }) => drop_line(kv, &line).await,
        }
    }
}

/// Delete the key holding this exact line. The line came out of a `Memory` this
/// host loaded from this store moments ago, so a miss means the store no longer
/// says what it just said — reported, never a silent success, because an agent
/// told "discarded" about a line still in its next prompt has been lied to.
async fn drop_line(kv: &dyn KvStore, line: &str) -> Result<(), String> {
    let fail = |e: StoreError| format!("{e:?}");
    for key in kv.list_prefix(PREFIX).await.map_err(fail)? {
        if kv.get(&key).await.map_err(fail)?.as_deref() == Some(line) {
            return kv.delete(&key).await.map_err(fail);
        }
    }
    Err(format!("no key in the store holds that line: {line}"))
}

/// The `note` argument, read the way `space::shared::run` reads its own: TEXT,
/// because a note is what the agent is telling itself and not an identifier —
/// `Memory::keep` (`crates/agent/src/memory.rs:68`) is the pure half that
/// decides what normalising one means, and it does it in one place.
///
/// Missing, mistyped or unreadable JSON becomes an empty string, and that pure
/// half refuses an empty note in words. Nothing here raises — the text IS the
/// correction the model gets.
fn note_of(args: &Args) -> &str {
    args.text("note").unwrap_or_default()
}

impl ToolHost for MemoryHost {
    fn handles(&self, tool: &str) -> bool {
        agent::is_memory_tool(tool)
    }

    /// Read fresh, decide in `agent::Memory`, perform the one operation.
    ///
    /// Never cached, for the reason the clock is not cached: this process may
    /// have been reloaded since the last turn, and the store is the memory.
    fn run<'a>(&'a self, tool: &'a str, args: &'a Args) -> BoxFuture<'a, Result<String, String>> {
        Box::pin(async move {
            let kv = self.store.kv();
            let mut memory = load(kv).await;
            let (said, kept) = match tool {
                "discard" => memory.discard(note_of(args)),
                _ => memory.keep(note_of(args)),
            };
            // A REFUSAL IS NOT A SUCCESS. `kept == None` is the pure half
            // saying it did nothing — *"Nothing kept: the note was empty."*,
            // *"That line is already in your memory."*, *"Nothing called that
            // in your memory."* — and `perform` answers `Ok(())` to it,
            // correctly: there was nothing to write and the STORE did not
            // fail. `run_hosted` turns that `Ok` into `ok=true`, which painted
            // all three green in the Tool trace. The words stay exactly as the
            // pure half wrote them; only the side of the `Result` changes, and
            // that is the side every projection colours by. The same fix, for
            // the same reason, as `space::shared::run`.
            let refused = kept.is_none();
            match self.perform(kv, kept).await {
                Ok(()) if refused => Err(said),
                Ok(()) => Ok(said),
                // A write nobody can read back is not something the agent kept,
                // so it is told plainly — the shape `space::shared::run` uses
                // (`crates/core/src/space/shared.rs:133`).
                Err(problem) => Err(format!(
                    "{said}\n(but your memory could not be saved: {problem})"
                )),
            }
        })
    }
}
