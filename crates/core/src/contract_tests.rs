use super::*;
use serde_json::json;

use crate::contracts;

fn reply(text: &str) -> InferenceReply {
    InferenceReply::text(text)
}

#[test]
fn json_happy_path_parses() {
    let parsed = contracts::react()
        .parse(&reply(r#"{"action": "answer", "response": "hi"}"#))
        .unwrap();
    assert_eq!(parsed.format, ParsedFormat::Json);
    assert_eq!(parsed.action, Action::Answer("hi".into()));
}

#[test]
fn json_embedded_in_prose_is_found() {
    let text = "Sure! Here you go:\n{\"action\": \"answer\", \"response\": \"x\"}\nDone.";
    let parsed = contracts::react().parse(&reply(text)).unwrap();
    assert_eq!(parsed.format, ParsedFormat::Json);
}

#[test]
fn truncated_json_falls_back_to_toon_recovery() {
    let text = "{\"action\": \"answer\",\n\"response\": \"partial";
    let parsed = contracts::react().parse(&reply(text)).unwrap();
    assert_eq!(parsed.format, ParsedFormat::Toon);
    assert_eq!(parsed.fields["action"], "answer");
}

#[test]
fn malformed_reply_missing_required_yields_repair_prompt() {
    let err = contracts::react()
        .parse(&reply("just some prose"))
        .unwrap_err();
    assert_eq!(err.missing, vec!["action".to_string()]);
    assert!(err.repair_prompt.contains("action"));
    assert!(err.repair_prompt.contains("tool | answer"));
}

#[test]
fn native_tool_calls_win_over_text() {
    let mut r = reply(r#"{"action": "answer", "response": "ignored"}"#);
    r.native_tool_calls = vec![ToolCall {
        id: "1".into(),
        name: "search".into(),
        args: json!({"q": "x"}),
    }];
    let parsed = contracts::react().parse(&r).unwrap();
    assert_eq!(parsed.format, ParsedFormat::Native);
    assert!(matches!(parsed.action, Action::ToolCalls(ref c) if c[0].name == "search"));
}

#[test]
fn toon_tool_call_with_json_string_args() {
    let text = "action: tool\ntool: search\nargs: {\"q\": \"rust\"}";
    let parsed = contracts::react().parse(&reply(text)).unwrap();
    match parsed.action {
        Action::ToolCalls(calls) => assert_eq!(calls[0].args, json!({"q": "rust"})),
        other => panic!("expected tool calls, got {other:?}"),
    }
}

#[test]
fn coercion_fills_optional_defaults_and_wraps_lists() {
    let plan = contracts::plan();
    let parsed = plan.parse(&reply(r#"{"steps": "only one step"}"#)).unwrap();
    assert_eq!(parsed.fields["steps"], json!(["only one step"]));
    assert_eq!(parsed.fields["rationale"], json!(""));
}

#[test]
fn extract_json_is_quote_aware() {
    assert_eq!(
        extract_json_object(r#"x {"a": "}{"} y"#),
        Some(r#"{"a": "}{"}"#)
    );
    assert_eq!(extract_json_object("{\"a\": 1"), None);
    assert_eq!(extract_json_object("no braces"), None);
}

#[test]
fn negotiator_starts_at_the_given_mode() {
    let mut n = FormatNegotiator::with_mode(OutputMode::Json);
    assert_eq!(n.mode(), OutputMode::Json);
    n.record_success(ParsedFormat::Json); // honored from turn 1
    assert!(n.honored());
}

#[test]
fn negotiator_escalation_reset_and_honored() {
    let mut n = FormatNegotiator::default();
    assert_eq!(n.mode(), OutputMode::Toon);
    n.record_success(ParsedFormat::Json); // asked TOON, got JSON
    assert!(!n.honored());
    n.record_success(ParsedFormat::Toon);
    assert!(n.honored());
    n.record_success(ParsedFormat::Native); // native always honors
    assert!(n.honored());
    n.record_failure();
    n.record_failure();
    assert_eq!(n.mode(), OutputMode::Toon);
    n.record_failure(); // third consecutive failure escalates
    assert_eq!(n.mode(), OutputMode::Json);
    assert!(!n.honored());
    n.record_success(ParsedFormat::Json); // resets the streak...
    assert!(n.honored());
    assert_eq!(n.mode(), OutputMode::Json); // ...but escalation is sticky
}

#[test]
fn calls_array_parses_to_parallel_tool_calls() {
    let text = r#"{"action": "tool", "calls": [
        {"tool": "a", "args": {"x": 1}},
        {"tool": "b", "args": {"y": 2}}
    ]}"#;
    let parsed = contracts::react().parse(&reply(text)).unwrap();
    match parsed.action {
        Action::ToolCalls(calls) => {
            assert_eq!(calls.len(), 2);
            assert_eq!(calls[0].name, "a");
            assert_eq!(calls[0].args, json!({"x": 1}));
            assert_eq!(calls[1].name, "b");
        }
        other => panic!("expected tool calls, got {other:?}"),
    }
}

#[test]
fn toon_calls_list_items_parse_from_strings() {
    let text =
        "action: tool\ncalls:\n- {\"tool\": \"a\", \"args\": {\"x\": 1}}\n- {\"tool\": \"b\"}";
    let parsed = contracts::react().parse(&reply(text)).unwrap();
    match parsed.action {
        Action::ToolCalls(calls) => {
            assert_eq!(calls.len(), 2);
            assert_eq!(calls[1].name, "b");
            assert_eq!(calls[1].args, json!({}));
        }
        other => panic!("expected tool calls, got {other:?}"),
    }
}

#[test]
fn empty_or_malformed_calls_falls_back_to_single_tool() {
    let text = r#"{"action": "tool", "calls": ["not json"], "tool": "echo", "args": {"t": 1}}"#;
    let parsed = contracts::react().parse(&reply(text)).unwrap();
    match parsed.action {
        Action::ToolCalls(calls) => {
            assert_eq!(calls.len(), 1);
            assert_eq!(calls[0].name, "echo");
        }
        other => panic!("expected tool calls, got {other:?}"),
    }
}
