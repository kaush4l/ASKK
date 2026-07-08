//! The action gate (ADR-006): effect-tagged tool calls through ONE gate.
//! Every decision yields an `ActionRecord` — the audit trail is the log; the
//! caller wraps each record in `SignalKind::ActionVerdict`.

use std::collections::BTreeMap;

use askk_core::{
    ActionId, ActionPolicy, ActionProposal, ActionRecord, ToolCall, ToolResult, ToolSpec, Verdict,
};
use serde_json::Value;

/// Applies policy + minimal schema validation to a proposed tool call.
/// Holds the injected clock so records carry an honest timestamp while
/// everything below `web` stays clock-free (ADR-009).
pub struct ActionGate {
    now_ms: Box<dyn Fn() -> u64>,
}

impl ActionGate {
    pub fn new(now_ms: impl Fn() -> u64 + 'static) -> Self {
        Self {
            now_ms: Box::new(now_ms),
        }
    }

    /// Verdict order: args that violate the tool's schema are denied before
    /// policy runs; otherwise `ActionPolicy` decides (per-tool override, else
    /// per-effect default — pure defaults to Auto). Every path yields a
    /// record; a denial carries a first-class `ToolResult` the model reads.
    pub fn evaluate(
        &self,
        call: &ToolCall,
        spec: &ToolSpec,
        policy: &ActionPolicy,
    ) -> (Verdict, ActionRecord) {
        let verdict = match validate_args(&call.args, &spec.input_schema) {
            Err(reason) => Verdict::Denied { reason },
            Ok(()) => policy.verdict(&call.name, spec.effect),
        };
        let result = match &verdict {
            Verdict::Denied { reason } => Some(ToolResult::err(format!(
                "action '{}' denied: {reason}",
                call.name
            ))),
            _ => None,
        };
        let record = ActionRecord {
            proposal: ActionProposal {
                id: ActionId(call.id.clone()),
                tool: call.name.clone(),
                args: call.args.clone(),
                effect: spec.effect,
                rationale: String::new(),
            },
            verdict: verdict.clone(),
            result,
            ts: (self.now_ms)(),
        };
        (verdict, record)
    }
}

/// Minimal, honest validation: required top-level props present, primitive
/// type match on declared properties. Deliberately not a JSON Schema engine —
/// tools defend their own edge cases.
fn validate_args(args: &Value, schema: &Value) -> Result<(), String> {
    let mut problems = Vec::new();
    if let Some(required) = schema.get("required").and_then(Value::as_array) {
        for name in required.iter().filter_map(Value::as_str) {
            if args.get(name).is_none() {
                problems.push(format!("missing required '{name}'"));
            }
        }
    }
    if let Some(props) = schema.get("properties").and_then(Value::as_object) {
        for (name, prop) in props {
            let (Some(value), Some(kind)) =
                (args.get(name), prop.get("type").and_then(Value::as_str))
            else {
                continue;
            };
            if !type_matches(value, kind) {
                problems.push(format!("'{name}' should be a {kind}"));
            }
        }
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(format!("args rejected: {}", problems.join(", ")))
    }
}

fn type_matches(value: &Value, kind: &str) -> bool {
    match kind {
        "string" => value.is_string(),
        "number" => value.is_number(),
        "integer" => value.is_i64() || value.is_u64(),
        "boolean" => value.is_boolean(),
        "array" => value.is_array(),
        "object" => value.is_object(),
        "null" => value.is_null(),
        // Unknown kinds don't block; the tool defends itself.
        _ => true,
    }
}

/// Confirmations parked by `ActionId` until a user command resolves them
/// (ADR-006's pending futures, held as plain state — no unowned await,
/// ADR-011: the owner is the UI resolution command).
#[derive(Default)]
pub struct PendingActions {
    parked: BTreeMap<ActionId, ActionRecord>,
}

impl PendingActions {
    pub fn new() -> Self {
        Self::default()
    }

    /// Parks only `NeedsConfirmation` records — Auto executes now, Denied is
    /// already final. Returns whether the record was parked.
    pub fn park(&mut self, record: ActionRecord) -> bool {
        if record.verdict != Verdict::NeedsConfirmation {
            return false;
        }
        self.parked.insert(record.proposal.id.clone(), record);
        true
    }

    /// Approve → caller executes the returned proposal and fills `result`.
    /// Deny → the record carries a first-class denial `ToolResult` the model
    /// can read as an observation. Unknown/already-resolved id → None.
    pub fn resolve(
        &mut self,
        id: &ActionId,
        approve: bool,
    ) -> Option<(ActionProposal, ActionRecord)> {
        let mut record = self.parked.remove(id)?;
        if !approve {
            record.verdict = Verdict::Denied {
                reason: "denied by user".into(),
            };
            record.result = Some(ToolResult::err(format!(
                "action '{}' denied by user; do not retry it unchanged",
                record.proposal.tool
            )));
        }
        Some((record.proposal.clone(), record))
    }

    pub fn len(&self) -> usize {
        self.parked.len()
    }

    pub fn is_empty(&self) -> bool {
        self.parked.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use askk_core::{Effect, PolicyDecision};
    use serde_json::json;

    fn gate() -> ActionGate {
        ActionGate::new(|| 99)
    }

    fn spec(name: &str, effect: Effect) -> ToolSpec {
        ToolSpec {
            name: name.into(),
            description: "test tool".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "text": { "type": "string" },
                    "count": { "type": "number" }
                },
                "required": ["text"]
            }),
            effect,
        }
    }

    fn call(name: &str, args: Value) -> ToolCall {
        ToolCall {
            id: "c1".into(),
            name: name.into(),
            args,
        }
    }

    fn policy(pure: PolicyDecision, mutating: PolicyDecision) -> ActionPolicy {
        ActionPolicy {
            pure_default: pure,
            mutating_default: mutating,
            per_tool: BTreeMap::new(),
        }
    }

    #[test]
    fn gate_matrix_effect_by_policy() {
        use PolicyDecision::*;
        let ok_args = json!({"text": "hi"});
        for (effect, decision, want_auto, want_confirm) in [
            (Effect::Pure, Auto, true, false),
            (Effect::Pure, Confirm, false, true),
            (Effect::Pure, Deny, false, false),
            (Effect::Mutating, Auto, true, false),
            (Effect::Mutating, Confirm, false, true),
            (Effect::Mutating, Deny, false, false),
        ] {
            let p = match effect {
                Effect::Pure => policy(decision, Confirm),
                Effect::Mutating => policy(Auto, decision),
            };
            let (verdict, record) =
                gate().evaluate(&call("t", ok_args.clone()), &spec("t", effect), &p);
            match (&verdict, want_auto, want_confirm) {
                (Verdict::Auto, true, _) => {}
                (Verdict::NeedsConfirmation, _, true) => {}
                (Verdict::Denied { .. }, false, false) => {}
                other => panic!("{effect:?}/{decision:?}: unexpected {other:?}"),
            }
            assert_eq!(record.verdict, verdict); // record on every path
            assert_eq!(record.proposal.effect, effect);
        }
    }

    #[test]
    fn defaults_pure_auto_mutating_confirm() {
        let p = ActionPolicy::default();
        let args = json!({"text": "x"});
        let (v, _) = gate().evaluate(&call("r", args.clone()), &spec("r", Effect::Pure), &p);
        assert_eq!(v, Verdict::Auto);
        let (v, _) = gate().evaluate(&call("w", args), &spec("w", Effect::Mutating), &p);
        assert_eq!(v, Verdict::NeedsConfirmation);
    }

    #[test]
    fn per_tool_override_beats_effect_default() {
        let mut p = ActionPolicy::default();
        p.per_tool.insert("w".into(), PolicyDecision::Auto);
        let (v, _) = gate().evaluate(
            &call("w", json!({"text": "x"})),
            &spec("w", Effect::Mutating),
            &p,
        );
        assert_eq!(v, Verdict::Auto);
    }

    #[test]
    fn schema_mismatch_denies_and_lists_every_problem() {
        let p = ActionPolicy::default();
        // Missing required 'text' AND wrong-typed 'count'.
        let (v, record) = gate().evaluate(
            &call("t", json!({"count": "three"})),
            &spec("t", Effect::Pure),
            &p,
        );
        let Verdict::Denied { reason } = &v else {
            panic!("expected denial, got {v:?}");
        };
        assert!(reason.contains("missing required 'text'"), "{reason}");
        assert!(reason.contains("'count' should be a number"), "{reason}");
        // The denial is a first-class result the model can read.
        let result = record.result.expect("denial carries a ToolResult");
        assert!(!result.ok);
        assert!(result.content.contains("denied"));
    }

    #[test]
    fn valid_args_pass_optional_props_may_be_absent() {
        let p = ActionPolicy::default();
        let (v, record) = gate().evaluate(
            &call("t", json!({"text": "hi"})),
            &spec("t", Effect::Pure),
            &p,
        );
        assert_eq!(v, Verdict::Auto);
        assert!(record.result.is_none());
        assert_eq!(record.ts, 99); // injected clock stamps the record
        assert_eq!(record.proposal.id, ActionId("c1".into()));
        assert_eq!(record.proposal.tool, "t");
    }

    #[test]
    fn pending_parks_only_confirmations() {
        let p = ActionPolicy::default();
        let mut pending = PendingActions::new();
        let (_, confirm) = gate().evaluate(
            &call("w", json!({"text": "x"})),
            &spec("w", Effect::Mutating),
            &p,
        );
        let (_, auto) = gate().evaluate(
            &call("r", json!({"text": "x"})),
            &spec("r", Effect::Pure),
            &p,
        );
        assert!(pending.park(confirm));
        assert!(!pending.park(auto)); // Auto never parks
        assert_eq!(pending.len(), 1);
    }

    #[test]
    fn resolve_approve_hands_back_the_proposal_to_execute() {
        let p = ActionPolicy::default();
        let mut pending = PendingActions::new();
        let (_, record) = gate().evaluate(
            &call("w", json!({"text": "x"})),
            &spec("w", Effect::Mutating),
            &p,
        );
        pending.park(record);
        let id = ActionId("c1".into());
        let (proposal, record) = pending.resolve(&id, true).unwrap();
        assert_eq!(proposal.tool, "w");
        assert_eq!(record.verdict, Verdict::NeedsConfirmation);
        assert!(record.result.is_none()); // caller executes, then fills it
        assert!(pending.is_empty());
        assert!(pending.resolve(&id, true).is_none()); // resolved = gone
    }

    #[test]
    fn resolve_deny_yields_readable_denial_result() {
        let p = ActionPolicy::default();
        let mut pending = PendingActions::new();
        let (_, record) = gate().evaluate(
            &call("w", json!({"text": "x"})),
            &spec("w", Effect::Mutating),
            &p,
        );
        pending.park(record);
        let (_, record) = pending.resolve(&ActionId("c1".into()), false).unwrap();
        assert_eq!(
            record.verdict,
            Verdict::Denied {
                reason: "denied by user".into()
            }
        );
        let result = record.result.unwrap();
        assert!(!result.ok);
        assert!(result.content.contains("denied by user"));
    }

    #[test]
    fn resolve_unknown_id_is_none() {
        let mut pending = PendingActions::new();
        assert!(pending.resolve(&ActionId("ghost".into()), true).is_none());
    }
}
