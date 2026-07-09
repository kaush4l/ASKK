//! Named contract registry: `react`, `plan`, `critique`.
//! Unknown contract name at load = hard error (ADR-007).

use crate::contract::{Contract, FieldKind, FieldSpec};
use crate::error::CoreError;

pub const NAMES: &[&str] = &["react", "plan", "critique"];

pub fn lookup(name: &str) -> Result<Contract, CoreError> {
    match name {
        "react" => Ok(react()),
        "plan" => Ok(plan()),
        "critique" => Ok(critique()),
        other => Err(CoreError::UnknownContract(other.to_string())),
    }
}

/// The default turn contract (v2): explore in lists, then flip ONE switch.
/// `observation`/`plan` are string lists (as many items as the model needs);
/// `action` picks tool|answer; `answer` carries EITHER the final text OR the
/// tool call itself as one MCP-style JSON object per line.
pub fn react() -> Contract {
    Contract {
        name: "react".into(),
        version: 2,
        fields: vec![
            FieldSpec::new(
                "observation",
                FieldKind::List,
                false,
                "what you learned so far, one point per item",
            ),
            FieldSpec::new(
                "plan",
                FieldKind::List,
                false,
                "your next steps, one per item",
            ),
            FieldSpec::new(
                "action",
                FieldKind::Enum(vec!["tool".into(), "answer".into()]),
                true,
                "the switch: call a tool or give the final answer",
            ),
            FieldSpec::new(
                "answer",
                FieldKind::Str,
                true,
                "if action is tool: the call on a single line as \
                 {\"name\": \"<tool>\", \"arguments\": {...}} (MCP style; one \
                 object per line to run several in parallel). If action is \
                 answer: the final answer text.",
            ),
        ],
    }
}

pub fn plan() -> Contract {
    Contract {
        name: "plan".into(),
        version: 1,
        fields: vec![
            FieldSpec::new("steps", FieldKind::List, true, "ordered plan steps"),
            FieldSpec::new(
                "rationale",
                FieldKind::Str,
                false,
                "why this plan will work",
            ),
        ],
    }
}

pub fn critique() -> Contract {
    Contract {
        name: "critique".into(),
        version: 1,
        fields: vec![
            FieldSpec::new(
                "verdict",
                FieldKind::Enum(vec!["pass".into(), "revise".into()]),
                true,
                "does the work meet the goal",
            ),
            FieldSpec::new(
                "feedback",
                FieldKind::Str,
                false,
                "what to fix when verdict is revise",
            ),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::{Action, OutputMode};
    use crate::request::InferenceReply;
    use serde_json::json;

    #[test]
    fn lookup_finds_every_named_contract() {
        for name in NAMES {
            assert_eq!(lookup(name).unwrap().name, *name);
        }
    }

    #[test]
    fn unknown_name_is_a_typed_error() {
        assert_eq!(
            lookup("bogus").unwrap_err(),
            CoreError::UnknownContract("bogus".into())
        );
    }

    #[test]
    fn react_round_trips_toon_tool_turn() {
        let text = "observation: found it\naction: tool\nanswer: {\"name\": \"search\", \"arguments\": {\"q\": \"x\"}}";
        let parsed = react().parse(&InferenceReply::text(text)).unwrap();
        assert_eq!(parsed.fields["observation"], json!(["found it"]));
        assert!(matches!(parsed.action, Action::ToolCalls(ref c) if c[0].name == "search"));
    }

    #[test]
    fn react_round_trips_json_answer_turn() {
        let text = r#"{"plan": ["easy"], "action": "answer", "answer": "42"}"#;
        let parsed = react().parse(&InferenceReply::text(text)).unwrap();
        assert_eq!(parsed.action, Action::Answer("42".into()));
    }

    #[test]
    fn plan_round_trips_step_list() {
        let text = "steps:\n- read the file\n- edit it\nrationale: obvious";
        let parsed = plan().parse(&InferenceReply::text(text)).unwrap();
        assert_eq!(parsed.fields["steps"], json!(["read the file", "edit it"]));
        assert_eq!(parsed.fields["rationale"], json!("obvious"));
    }

    #[test]
    fn critique_round_trips_verdict() {
        let parsed = critique()
            .parse(&InferenceReply::text("verdict: PASS\nfeedback: none"))
            .unwrap();
        assert_eq!(parsed.fields["verdict"], json!("pass")); // canonicalized
    }

    #[test]
    fn instructions_name_every_field() {
        let text = react().instructions(OutputMode::Toon);
        for field in ["observation", "plan", "action", "answer"] {
            assert!(text.contains(field), "missing {field} in:\n{text}");
        }
        assert!(text.contains("one of: tool | answer"));
        let json_text = critique().instructions(OutputMode::Json);
        assert!(json_text.contains("single JSON object"));
        assert!(json_text.contains("pass | revise"));
    }

    #[test]
    fn schema_marks_required_fields() {
        let schema = react().schema();
        assert_eq!(schema["required"], json!(["action", "answer"]));
        assert_eq!(
            schema["properties"]["action"]["enum"],
            json!(["tool", "answer"])
        );
    }
}
