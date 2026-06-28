//! One mental model for the crate's keyed lookups.
//!
//! Four registries live in this crate and, until now, each re-invented the same
//! shape from scratch:
//!
//! - **MCP** (`mcp::registry`) — a `RefCell<Vec<McpConnection>>` keyed by
//!   `server_id`, looked up by namespaced display name; across-run reuse.
//! - **Inference** (`inference::registry`) — a `RefCell<HashMap<_, Rc<ProviderImpl>>>`
//!   keyed by normalized `"provider/model"`; a `get_or_create` cache.
//! - **Strategy** (`strategy::registry`) — an owned `Vec<&'static dyn Strategy>`
//!   keyed by `&str` id; a static catalog.
//! - **Process** (`engine::process_registry`) — a `RefCell<Vec<Entry>>` plus a
//!   `Cell<u64>` version counter, keyed by `u64`; ephemeral, with a monotonic
//!   change-counter the UI polls.
//!
//! They have genuinely different value types and lifecycles (across-run reuse vs
//! cached vs static vs ephemeral), so forcing one concrete store would change
//! behavior. The win here is shared *vocabulary*, not a shared container:
//!
//! - [`Registry`] is the trait every keyed lookup conceptually satisfies —
//!   `get` / `insert` / `keys` / `len` / `version`. Implementing it makes the
//!   four registries legible as one family without touching their internals.
//! - [`VersionedVec`] is the concrete helper for the recurring "owned `Vec` +
//!   monotonic version counter + linear key lookup" pattern. The process
//!   registry is the canonical instance and is built on it directly; any future
//!   ephemeral, pollable store reuses it instead of re-deriving the counter
//!   discipline.
//!
//! This module is pure and host-testable: no web/transport/`thread_local!`
//! types appear here. Each registry keeps its own storage discipline (a
//! `thread_local!` cell where it needs cross-call state on single-threaded WASM);
//! this seam only standardizes how that storage is *described*.

/// The shared shape of a keyed lookup. A registry maps keys of type `K` to
/// values of type `V`, can enumerate its keys, reports how many entries it
/// holds, and exposes a monotonic [`version`](Registry::version) that advances
/// whenever its contents change.
///
/// `version` is the load-bearing common contract: a poller (today the run
/// panel) can observe *that* a registry changed without diffing its contents.
/// Registries whose contents are immutable after construction (the strategy
/// catalog) report a constant version; that still satisfies "never moves
/// backward, only advances on change".
///
/// The trait is intentionally small and side-effect-light so it fits all four
/// existing registries without bending any of their lifecycles. It is not
/// object-safe-by-design — implementors are concrete stores, not trait objects.
pub trait Registry<K, V> {
    /// Resolve a key to its value, or `None` if absent.
    fn get(&self, key: &K) -> Option<V>;

    /// Insert (or replace) the value for `key`. Implementors that own distinct
    /// insertion semantics (de-dup, fingerprint reuse) document them on their
    /// own surface; this is the plain "make `key` resolve to `value`" path.
    fn insert(&mut self, key: K, value: V);

    /// All keys currently held, in the implementor's natural order.
    fn keys(&self) -> Vec<K>;

    /// Number of entries currently held.
    fn len(&self) -> usize;

    /// Whether the registry holds no entries.
    fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// A monotonic change-counter: advances on every content change, never
    /// retreats. Pollers compare successive reads to detect mutation cheaply.
    fn version(&self) -> u64;
}

/// An owned, version-counted vector store: the recurring "list of entries plus a
/// monotonic change-counter, looked up by a key projected from each entry"
/// pattern, factored out so it is written once.
///
/// Entries keep insertion order (a `Vec`, not a map), which several callers rely
/// on for stable listings. The version counter advances on every mutation that
/// changes the set of entries — push, remove, retain-that-dropped — and uses
/// wrapping addition so it can never panic on overflow (a `u64` poll counter
/// that wraps after ~5.8e11 years of mutations is indistinguishable from
/// monotonic for any real poller).
///
/// This is deliberately *not* wrapped in a `RefCell` or `thread_local!`: callers
/// that need cross-call, single-threaded-WASM state wrap it themselves (matching
/// the existing per-registry storage discipline). Keeping the helper a plain
/// owned value makes it trivially host-testable.
#[derive(Debug)]
pub struct VersionedVec<T> {
    entries: Vec<T>,
    version: u64,
}

impl<T> Default for VersionedVec<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> VersionedVec<T> {
    /// An empty store at version 0.
    pub const fn new() -> Self {
        Self {
            entries: Vec::new(),
            version: 0,
        }
    }

    /// The current change-counter. Advances on every mutating call that altered
    /// the entry set; a no-op mutation (e.g. removing an absent key) leaves it
    /// unchanged, matching the existing registries' "bump only on real change"
    /// behavior.
    pub fn version(&self) -> u64 {
        self.version
    }

    /// Number of entries held.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the store is empty.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    fn bump(&mut self) {
        self.version = self.version.wrapping_add(1);
    }

    /// Append `entry` and advance the version.
    pub fn push(&mut self, entry: T) {
        self.entries.push(entry);
        self.bump();
    }

    /// Immutable view of all entries, in insertion order.
    pub fn iter(&self) -> std::slice::Iter<'_, T> {
        self.entries.iter()
    }

    /// First entry satisfying `pred`, if any. Read-only; never bumps.
    pub fn find<P>(&self, pred: P) -> Option<&T>
    where
        P: FnMut(&&T) -> bool,
    {
        self.entries.iter().find(pred)
    }

    /// Remove the first entry whose position matches `pred`, returning it. Bumps
    /// the version only when an entry was actually removed.
    pub fn remove_first<P>(&mut self, pred: P) -> Option<T>
    where
        P: FnMut(&T) -> bool,
    {
        let index = self.entries.iter().position(pred)?;
        let removed = self.entries.remove(index);
        self.bump();
        Some(removed)
    }

    /// Retain only entries satisfying `keep`. Bumps the version only when at
    /// least one entry was dropped, so a retain that changes nothing is a no-op
    /// for pollers — matching the per-registry change-counter contract.
    pub fn retain<P>(&mut self, keep: P)
    where
        P: FnMut(&T) -> bool,
    {
        let before = self.entries.len();
        self.entries.retain(keep);
        if self.entries.len() != before {
            self.bump();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_store_is_empty_at_version_zero() {
        let store: VersionedVec<u32> = VersionedVec::new();
        assert!(store.is_empty());
        assert_eq!(store.len(), 0);
        assert_eq!(store.version(), 0);
    }

    #[test]
    fn push_advances_version_and_preserves_order() {
        let mut store = VersionedVec::new();
        store.push("a");
        store.push("b");
        store.push("c");
        assert_eq!(store.len(), 3);
        // One bump per push.
        assert_eq!(store.version(), 3);
        let order: Vec<_> = store.iter().copied().collect();
        assert_eq!(order, vec!["a", "b", "c"]);
    }

    #[test]
    fn find_is_read_only() {
        let mut store = VersionedVec::new();
        store.push(10);
        store.push(20);
        let before = store.version();
        assert_eq!(store.find(|n| **n == 20).copied(), Some(20));
        assert_eq!(store.find(|n| **n == 99).copied(), None);
        // A lookup never moves the counter.
        assert_eq!(store.version(), before);
    }

    #[test]
    fn remove_first_bumps_only_when_something_left() {
        let mut store = VersionedVec::new();
        store.push(1);
        store.push(2);
        store.push(1);
        let after_pushes = store.version();
        // Removes the first matching entry, keeps the later duplicate.
        assert_eq!(store.remove_first(|n| *n == 1), Some(1));
        assert_eq!(store.version(), after_pushes + 1);
        let remaining: Vec<_> = store.iter().copied().collect();
        assert_eq!(remaining, vec![2, 1]);
        // Removing an absent key is a no-op: no bump.
        let before_noop = store.version();
        assert_eq!(store.remove_first(|n| *n == 99), None);
        assert_eq!(store.version(), before_noop);
    }

    #[test]
    fn retain_bumps_only_when_an_entry_is_dropped() {
        let mut store = VersionedVec::new();
        store.push(1);
        store.push(2);
        store.push(3);
        let full = store.version();
        // Retain-all changes nothing: no bump.
        store.retain(|_| true);
        assert_eq!(store.version(), full);
        // Dropping at least one entry bumps exactly once.
        store.retain(|n| *n != 2);
        assert_eq!(store.version(), full + 1);
        let remaining: Vec<_> = store.iter().copied().collect();
        assert_eq!(remaining, vec![1, 3]);
    }

    /// A tiny in-memory registry over [`VersionedVec`], exercising the
    /// [`Registry`] trait end to end (insert de-dups by key, version advances on
    /// change). This mirrors how the real registries satisfy the trait while
    /// keeping their own storage.
    struct KvRegistry {
        store: VersionedVec<(String, u32)>,
    }

    impl Registry<String, u32> for KvRegistry {
        fn get(&self, key: &String) -> Option<u32> {
            self.store.find(|(k, _)| k == key).map(|(_, v)| *v)
        }

        fn insert(&mut self, key: String, value: u32) {
            self.store.retain(|(k, _)| k != &key);
            self.store.push((key, value));
        }

        fn keys(&self) -> Vec<String> {
            self.store.iter().map(|(k, _)| k.clone()).collect()
        }

        fn len(&self) -> usize {
            self.store.len()
        }

        fn version(&self) -> u64 {
            self.store.version()
        }
    }

    #[test]
    fn registry_trait_round_trips_through_versioned_vec() {
        let mut reg = KvRegistry {
            store: VersionedVec::new(),
        };
        assert!(reg.is_empty());
        assert_eq!(reg.version(), 0);

        reg.insert("a".to_string(), 1);
        reg.insert("b".to_string(), 2);
        assert_eq!(reg.get(&"a".to_string()), Some(1));
        assert_eq!(reg.get(&"missing".to_string()), None);
        assert_eq!(reg.len(), 2);
        assert_eq!(reg.keys(), vec!["a".to_string(), "b".to_string()]);

        // Re-inserting a key replaces the value and keeps a single entry.
        let before = reg.version();
        reg.insert("a".to_string(), 9);
        assert_eq!(reg.get(&"a".to_string()), Some(9));
        assert_eq!(reg.len(), 2);
        // A replace mutates the store, so the version moves forward.
        assert!(reg.version() > before);
    }
}
