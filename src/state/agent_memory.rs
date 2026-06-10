//! Per-agent-identity rolling summary: compact continuity across invocations
//! without carrying full transcripts. Persisted in the snapshot (IndexedDB).

use serde::{Deserialize, Serialize};

use super::now_iso;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct AgentMemory {
    pub agent_id: String,
    /// Plain-text rolling summary, capped by prompt instruction (~2000 chars).
    pub rolling_summary: String,
    pub updated_at: String,
}

/// Find an agent's rolling summary (empty string when none).
pub fn rolling_summary_for(memories: &[AgentMemory], agent_id: &str) -> String {
    memories
        .iter()
        .find(|memory| memory.agent_id == agent_id)
        .map(|memory| memory.rolling_summary.clone())
        .unwrap_or_default()
}

/// Upsert an agent's rolling summary.
pub fn upsert_rolling_summary(memories: &mut Vec<AgentMemory>, agent_id: &str, summary: String) {
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
}
