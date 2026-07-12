//! Run identity, terminal statuses, state slices, budgets.
//! Every wait has an owner and a terminal (ADR-011).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Serialize, Deserialize)]
pub struct RunId(pub String);

impl RunId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }
}

/// Only a gate phase's pass yields `Answered`; every other stop is one of the
/// non-success terminals (ADR-008 — no false success).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    #[default]
    Running,
    Answered,
    Unverified,
    BudgetExhausted,
    Interrupted,
    Failed,
}

impl RunStatus {
    pub fn is_terminal(self) -> bool {
        self != RunStatus::Running
    }
}

/// Named slices of serialized state — selected explicitly onto the sheet.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct StateSnapshot {
    pub slices: BTreeMap<String, Value>,
}

/// Agent memory digest composed onto the sheet.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct MemoryBlock {
    pub agent_id: String,
    pub content: String,
}

/// Budgets: turns, wall clock, per-tool and stream-idle timeouts, context.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Budgets {
    pub max_turns: u32,
    pub deadline_ms: u64,
    pub tool_timeout_ms: u64,
    pub stream_idle_timeout_ms: u64,
    pub max_delegation_depth: u8,
    /// Total history chars one request may carry (see `window_history`).
    #[serde(default = "default_max_context_chars")]
    pub max_context_chars: usize,
    /// Chars of one tool result that re-enter history as an observation.
    #[serde(default = "default_max_observation_chars")]
    pub max_observation_chars: usize,
}

fn default_max_context_chars() -> usize {
    60_000
}

fn default_max_observation_chars() -> usize {
    6_000
}

impl Default for Budgets {
    fn default() -> Self {
        Self {
            max_turns: 16,
            deadline_ms: 300_000,
            tool_timeout_ms: 30_000,
            stream_idle_timeout_ms: 30_000,
            max_delegation_depth: 2,
            max_context_chars: default_max_context_chars(),
            max_observation_chars: default_max_observation_chars(),
        }
    }
}

impl Budgets {
    pub fn turns_left(&self, used: u32) -> u32 {
        self.max_turns.saturating_sub(used)
    }

    /// True on the last budgeted turn — the sheet injects "answer now".
    pub fn is_final_turn(&self, used: u32) -> bool {
        self.turns_left(used) == 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn status_terminality() {
        assert!(!RunStatus::Running.is_terminal());
        for status in [
            RunStatus::Answered,
            RunStatus::Unverified,
            RunStatus::BudgetExhausted,
            RunStatus::Interrupted,
            RunStatus::Failed,
        ] {
            assert!(status.is_terminal());
        }
    }

    #[test]
    fn status_serializes_snake_case() {
        assert_eq!(
            serde_json::to_string(&RunStatus::BudgetExhausted).unwrap(),
            "\"budget_exhausted\""
        );
    }

    #[test]
    fn snapshot_holds_named_slices() {
        let mut snap = StateSnapshot::default();
        snap.slices.insert("todo".into(), json!(["a", "b"]));
        assert_eq!(snap.slices["todo"], json!(["a", "b"]));
    }

    #[test]
    fn budgets_context_fields_default_for_old_configs() {
        // A config serialized before the context fields existed still loads.
        let old = r#"{"max_turns":4,"deadline_ms":1,"tool_timeout_ms":1,
                      "stream_idle_timeout_ms":1,"max_delegation_depth":1}"#;
        let budgets: Budgets = serde_json::from_str(old).unwrap();
        assert_eq!(budgets.max_turns, 4);
        assert_eq!(budgets.max_context_chars, 60_000);
        assert_eq!(budgets.max_observation_chars, 6_000);
    }

    #[test]
    fn budgets_final_turn_nudge() {
        let budgets = Budgets {
            max_turns: 3,
            ..Default::default()
        };
        assert!(!budgets.is_final_turn(0));
        assert!(!budgets.is_final_turn(1));
        assert!(budgets.is_final_turn(2));
        assert_eq!(budgets.turns_left(5), 0); // saturates, never underflows
    }
}
