//! Agent memory (MODELS.md §State model): per-agent digest entries over a
//! [`KvStore`], key `memory/<agent_id>` → JSON array of entry strings,
//! oldest first, bounded drop-oldest (default 64, [`DEFAULT_MAX_ENTRIES`]).
//! Written by the absorb path after each run; read back onto the sheet as a
//! [`MemoryBlock`] (entries joined by newlines).
//!
//! Distinct from the note tools (`tools/memory_tools.rs`), which own
//! `notes/<slug>`: this store is the agent's automatic digest, notes are
//! explicit tool writes.

use std::rc::Rc;

use askk_core::state::MemoryBlock;
use serde_json::Value;

use super::store::{KvStore, StoreError};

const MEMORY_PREFIX: &str = "memory/";

/// Default entry bound; callers can inject their own via `new`.
pub const DEFAULT_MAX_ENTRIES: usize = 64;

/// Storage shape: `memory/<agent_id>` → JSON array of entry strings,
/// oldest first. `MemoryBlock.content` is the entries joined by newlines.
pub struct MemoryStore {
    kv: Rc<dyn KvStore>,
    max_entries: usize,
}

impl MemoryStore {
    pub fn new(kv: Rc<dyn KvStore>, max_entries: usize) -> Self {
        Self { kv, max_entries }
    }

    fn key(agent_id: &str) -> String {
        format!("{MEMORY_PREFIX}{agent_id}")
    }

    async fn entries(&self, agent_id: &str) -> Result<Vec<String>, StoreError> {
        let Some(value) = self.kv.get(&Self::key(agent_id)).await? else {
            return Ok(Vec::new());
        };
        // Tolerant read: non-string entries are dropped, not fatal.
        Ok(value
            .as_array()
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|e| e.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default())
    }

    async fn store(&self, agent_id: &str, mut entries: Vec<String>) -> Result<(), StoreError> {
        // Drop-oldest beyond the bound.
        if entries.len() > self.max_entries {
            entries.drain(..entries.len() - self.max_entries);
        }
        self.kv
            .set(&Self::key(agent_id), Value::from(entries))
            .await
    }

    /// Missing memory loads as an empty block — a new agent has no past.
    pub async fn load(&self, agent_id: &str) -> Result<MemoryBlock, StoreError> {
        Ok(MemoryBlock {
            agent_id: agent_id.to_string(),
            content: self.entries(agent_id).await?.join("\n"),
        })
    }

    /// Replace the whole memory: each content line becomes one entry
    /// (bounded, drop-oldest).
    pub async fn save(&self, block: &MemoryBlock) -> Result<(), StoreError> {
        let entries: Vec<String> = block
            .content
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(String::from)
            .collect();
        self.store(&block.agent_id, entries).await
    }

    /// Append one digest entry, dropping the oldest beyond the bound.
    pub async fn append(&self, agent_id: &str, entry: &str) -> Result<(), StoreError> {
        let mut entries = self.entries(agent_id).await?;
        entries.push(entry.to_string());
        self.store(agent_id, entries).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::block_on;
    use crate::state::store::MemKv;

    fn store(max: usize) -> MemoryStore {
        MemoryStore::new(Rc::new(MemKv::new()), max)
    }

    #[test]
    fn load_save_roundtrip_per_agent() {
        let memory = store(DEFAULT_MAX_ENTRIES);
        block_on(async {
            let empty = memory.load("coder").await.unwrap();
            assert_eq!(empty.agent_id, "coder");
            assert_eq!(empty.content, "");

            let block = MemoryBlock {
                agent_id: "coder".into(),
                content: "likes rust\nhates yaml".into(),
            };
            memory.save(&block).await.unwrap();
            assert_eq!(memory.load("coder").await.unwrap(), block);
            // Other agents are untouched.
            assert_eq!(memory.load("critic").await.unwrap().content, "");
        });
    }

    #[test]
    fn append_accumulates_in_order() {
        let memory = store(DEFAULT_MAX_ENTRIES);
        block_on(async {
            memory.append("coder", "first").await.unwrap();
            memory.append("coder", "second").await.unwrap();
            assert_eq!(memory.load("coder").await.unwrap().content, "first\nsecond");
        });
    }

    #[test]
    fn append_drops_oldest_beyond_bound() {
        let memory = store(3);
        block_on(async {
            for entry in ["a", "b", "c", "d", "e"] {
                memory.append("coder", entry).await.unwrap();
            }
            assert_eq!(memory.load("coder").await.unwrap().content, "c\nd\ne");
        });
    }

    #[test]
    fn save_applies_the_bound_too() {
        let memory = store(2);
        block_on(async {
            let block = MemoryBlock {
                agent_id: "coder".into(),
                content: "one\ntwo\nthree".into(),
            };
            memory.save(&block).await.unwrap();
            assert_eq!(memory.load("coder").await.unwrap().content, "two\nthree");
        });
    }
}
