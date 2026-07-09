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

/// The default turn contract: observe, think, plan, then act (tool or answer).
pub fn react() -> Contract {
    Contract {
        name: "react".into(),
        version: 1,
        fields: vec![
            FieldSpec::new(
                "observation",
                FieldKind::Str,
                false,
                "what you learned from the last result",
            ),
            FieldSpec::new("thinking", FieldKind::Str, false, "your reasoning"),
            FieldSpec::new("plan", FieldKind::Str, false, "what you will do next"),
            FieldSpec::new(
                "action",
                FieldKind::Enum(vec!["tool".into(), "answer".into()]),
                true,
                "call a tool or answer",
            ),
            FieldSpec::new(
                "tool",
                FieldKind::Str,
                false,
                "tool name when action is tool",
            ),
            FieldSpec::new(
                "args",
                FieldKind::Str,
                false,
                "JSON object of tool arguments when action is tool",
            ),
            FieldSpec::new(
                "calls",
                FieldKind::List,
                false,
                "to run SEVERAL tools at once (they execute in parallel): one \
                 JSON object per item, {\"tool\": name, \"args\": {...}}; \
                 overrides tool/args",
            ),
            FieldSpec::new(
                "response",
                FieldKind::Str,
                false,
                "final answer when action is answer",
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
        let text = "observation: found it\naction: tool\ntool: search\nargs: {\"q\": \"x\"}";
        let parsed = react().parse(&InferenceReply::text(text)).unwrap();
        assert_eq!(parsed.fields["observation"], json!("found it"));
        assert!(matches!(parsed.action, Action::ToolCalls(ref c) if c[0].name == "search"));
    }

    #[test]
    fn react_round_trips_json_answer_turn() {
        let text = r#"{"thinking": "easy", "action": "answer", "response": "42"}"#;
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
        for field in ["observation", "action", "tool", "response"] {
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
        assert_eq!(schema["required"], json!(["action"]));
        assert_eq!(
            schema["properties"]["action"]["enum"],
            json!(["tool", "answer"])
        );
    }
}
