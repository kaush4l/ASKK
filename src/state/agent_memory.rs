//! Per-agent-identity rolling summary: compact continuity across invocations
//! without carrying full transcripts. Persisted in the snapshot (IndexedDB).

use serde::{Deserialize, Serialize};

use super::now_iso;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct AgentMemory {
    pub agent_id: String,
    /// Plain-text rolling summary, capped by prompt instruction (~2000 chars) and
    /// hard-truncated at [`MAX_ROLLING_SUMMARY_CHARS`] on store.
    pub rolling_summary: String,
    pub updated_at: String,
}

/// Hard ceiling on a stored rolling summary. The merge prompt asks the model for
/// ~2000 characters; this guards cost and storage when a model ignores the cap.
pub const MAX_ROLLING_SUMMARY_CHARS: usize = 2400;

/// Find an agent's rolling summary (empty string when none).
pub fn rolling_summary_for(memories: &[AgentMemory], agent_id: &str) -> String {
    memories
        .iter()
        .find(|memory| memory.agent_id == agent_id)
        .map(|memory| memory.rolling_summary.clone())
        .unwrap_or_default()
}

/// Upsert an agent's rolling summary.
///
/// The stored summary is hard-truncated to [`MAX_ROLLING_SUMMARY_CHARS`] on a char
/// boundary before it lands in either the insert or update arm, so a model that
/// ignores the prompt's ~2000-char cap cannot grow storage or cost without bound.
pub fn upsert_rolling_summary(memories: &mut Vec<AgentMemory>, agent_id: &str, summary: String) {
    let summary: String = summary.chars().take(MAX_ROLLING_SUMMARY_CHARS).collect();
    if let Some(memory) = memories
        .iter_mut()
        .find(|memory| memory.agent_id == agent_id)
    {
        memory.rolling_summary = summary;
        memory.updated_at = now_iso();
        return;
    }
    memories.push(AgentMemory {
        agent_id: agent_id.to_string(),
        rolling_summary: summary,
        updated_at: now_iso(),
    });
}

/// Merge batches of agent memories into `target` in batch order, upserting each
/// entry by `agent_id`. Used by the engine to fold the per-call memory deltas
/// surfaced by the tool dispatcher back into the live snapshot.
///
/// Ordering rule: batches are applied in call order, and within a batch entries are
/// applied in iteration order; for two batches touching the same `agent_id` the
/// later batch wins (each ran on its own snapshot clone and could not see the
/// other's merge).
pub fn merge_agent_memories(target: &mut Vec<AgentMemory>, batches: Vec<Vec<AgentMemory>>) {
    for batch in batches {
        for memory in batch {
            upsert_rolling_summary(target, &memory.agent_id, memory.rolling_summary);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_inserts_then_updates() {
        let mut memories = Vec::new();
        upsert_rolling_summary(&mut memories, "researcher", "found A".to_string());
        assert_eq!(rolling_summary_for(&memories, "researcher"), "found A");
        upsert_rolling_summary(&mut memories, "researcher", "found A and B".to_string());
        assert_eq!(memories.len(), 1);
        assert_eq!(
            rolling_summary_for(&memories, "researcher"),
            "found A and B"
        );
        assert_eq!(rolling_summary_for(&memories, "coder"), "");
    }

    #[test]
    fn upsert_hard_truncates_at_max_chars() {
        let mut memories = Vec::new();
        let oversized = "x".repeat(3000);
        upsert_rolling_summary(&mut memories, "researcher", oversized);
        let stored = rolling_summary_for(&memories, "researcher");
        assert_eq!(stored.chars().count(), MAX_ROLLING_SUMMARY_CHARS);
    }

    #[test]
    fn merge_agent_memories_applies_batches_last_write_wins() {
        let mut target = Vec::new();
        let earlier = vec![AgentMemory {
            agent_id: "researcher".to_string(),
            rolling_summary: "first delegation".to_string(),
            updated_at: String::new(),
        }];
        let later = vec![AgentMemory {
            agent_id: "researcher".to_string(),
            rolling_summary: "second delegation".to_string(),
            updated_at: String::new(),
        }];
        merge_agent_memories(&mut target, vec![earlier, later]);
        // One entry (same agent_id), and the later batch wins.
        assert_eq!(target.len(), 1);
        assert_eq!(
            rolling_summary_for(&target, "researcher"),
            "second delegation"
        );
    }
}
