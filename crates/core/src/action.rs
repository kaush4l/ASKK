//! Actions = effect-tagged tool calls through one gate (ADR-006).
//! The model proposes; the harness applies policy, executes, and audits.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::tool::{Effect, ToolResult};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Default, Serialize, Deserialize)]
pub struct ActionId(pub String);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActionProposal {
    pub id: ActionId,
    pub tool: String,
    pub args: Value,
    pub effect: Effect,
    pub rationale: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    Auto,
    NeedsConfirmation,
    Denied { reason: String },
}

/// Every gate decision appends one of these — the audit trail is the log itself.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActionRecord {
    pub proposal: ActionProposal,
    pub verdict: Verdict,
    pub result: Option<ToolResult>,
    pub ts: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PolicyDecision {
    Auto,
    Confirm,
    Deny,
}

impl PolicyDecision {
    fn as_str(self) -> &'static str {
        match self {
            PolicyDecision::Auto => "auto",
            PolicyDecision::Confirm => "confirm",
            PolicyDecision::Deny => "deny",
        }
    }
}

/// Per-effect default policy plus per-tool overrides.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActionPolicy {
    pub pure_default: PolicyDecision,
    pub mutating_default: PolicyDecision,
    pub per_tool: BTreeMap<String, PolicyDecision>,
}

impl Default for ActionPolicy {
    fn default() -> Self {
        Self {
            pure_default: PolicyDecision::Auto,
            mutating_default: PolicyDecision::Confirm,
            per_tool: BTreeMap::new(),
        }
    }
}

impl ActionPolicy {
    pub fn verdict(&self, tool: &str, effect: Effect) -> Verdict {
        let decision = self.per_tool.get(tool).copied().unwrap_or(match effect {
            Effect::Pure => self.pure_default,
            Effect::Mutating => self.mutating_default,
        });
        match decision {
            PolicyDecision::Auto => Verdict::Auto,
            PolicyDecision::Confirm => Verdict::NeedsConfirmation,
            PolicyDecision::Deny => Verdict::Denied {
                reason: format!("policy denies tool '{tool}'"),
            },
        }
    }

    /// Rendered onto the sheet so the model knows what will be gated.
    pub fn summary(&self) -> String {
        let mut out = format!(
            "Pure tools: {}. Mutating tools: {}.",
            self.pure_default.as_str(),
            self.mutating_default.as_str()
        );
        for (tool, decision) in &self.per_tool {
            out.push_str(&format!(" {tool}: {}.", decision.as_str()));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defaults_auto_pure_confirm_mutating() {
        let policy = ActionPolicy::default();
        assert_eq!(policy.verdict("read", Effect::Pure), Verdict::Auto);
        assert_eq!(
            policy.verdict("write", Effect::Mutating),
            Verdict::NeedsConfirmation
        );
    }

    #[test]
    fn per_tool_override_beats_effect_default() {
        let mut policy = ActionPolicy::default();
        policy.per_tool.insert("shell".into(), PolicyDecision::Deny);
        policy
            .per_tool
            .insert("file_write".into(), PolicyDecision::Auto);
        match policy.verdict("shell", Effect::Pure) {
            Verdict::Denied { reason } => assert!(reason.contains("shell")),
            other => panic!("expected denial, got {other:?}"),
        }
        assert_eq!(
            policy.verdict("file_write", Effect::Mutating),
            Verdict::Auto
        );
    }

    #[test]
    fn record_round_trips_through_serde() {
        let record = ActionRecord {
            proposal: ActionProposal {
                id: ActionId("a1".into()),
                tool: "write".into(),
                args: json!({"path": "x"}),
                effect: Effect::Mutating,
                rationale: "save the file".into(),
            },
            verdict: Verdict::Denied {
                reason: "nope".into(),
            },
            result: None,
            ts: 42,
        };
        let text = serde_json::to_string(&record).unwrap();
        let back: ActionRecord = serde_json::from_str(&text).unwrap();
        assert_eq!(back, record);
    }

    #[test]
    fn summary_names_overrides() {
        let mut policy = ActionPolicy::default();
        policy.per_tool.insert("shell".into(), PolicyDecision::Deny);
        let text = policy.summary();
        assert!(text.contains("auto"));
        assert!(text.contains("confirm"));
        assert!(text.contains("shell: deny"));
    }
}
