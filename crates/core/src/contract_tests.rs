use super::*;
use serde_json::json;

use crate::contracts;

fn reply(text: &str) -> InferenceReply {
    InferenceReply::text(text)
}

#[test]
fn json_happy_path_parses() {
    let parsed = contracts::react()
        .parse(&reply(r#"{"action": "answer", "answer": "hi"}"#))
        .unwrap();
    assert_eq!(parsed.format, ParsedFormat::Json);
    assert_eq!(parsed.action, Action::Answer("hi".into()));
}

#[test]
fn json_embedded_in_prose_is_found() {
    let text = "Sure! Here you go:\n{\"action\": \"answer\", \"answer\": \"x\"}\nDone.";
    let parsed = contracts::react().parse(&reply(text)).unwrap();
    assert_eq!(parsed.format, ParsedFormat::Json);
}

#[test]
fn truncated_json_falls_back_to_toon_recovery() {
    let text = "{\"action\": \"reply\",\n\"answer\": \"partial";
    let parsed = contracts::react().parse(&reply(text)).unwrap();
    assert_eq!(parsed.format, ParsedFormat::Toon);
    assert_eq!(parsed.fields["action"], "reply");
}

#[test]
fn malformed_reply_missing_required_yields_repair_prompt() {
    let err = contracts::react()
        .parse(&reply("just some prose"))
        .unwrap_err();
    assert_eq!(err.missing, vec!["action".to_string()]);
    assert!(err.repair_prompt.contains("action"));
    assert!(err.repair_prompt.contains("tool | reply"));
    // ...and a shape reminder from the field's curated example.
    assert!(err.repair_prompt.contains("`action: tool`"));
}

#[test]
fn repair_prompt_shape_hint_falls_back_to_kind_placeholders() {
    let contract = Contract {
        name: "c".into(),
        version: 1,
        fields: vec![
            FieldSpec::new("steps", FieldKind::List, true, ""),
            FieldSpec::new("note", FieldKind::Str, true, ""),
        ],
    };
    let err = contract.parse(&reply("prose only")).unwrap_err();
    assert_eq!(err.missing, vec!["steps".to_string(), "note".to_string()]);
    // The hint names the FIRST problem field, list-shaped.
    assert!(err
        .repair_prompt
        .contains("`steps:` followed by `- item` lines"));
}

#[test]
fn native_tool_calls_win_over_text() {
    let mut r = reply(r#"{"action": "answer", "answer": "ignored"}"#);
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
    let text = "action: tool\nanswer: {\"name\": \"search\", \"arguments\": {\"q\": \"rust\"}}";
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
fn multi_line_answer_parses_to_parallel_mcp_calls() {
    let text = "action: tool\nanswer: {\"name\": \"a\", \"arguments\": {\"x\": 1}}";
    let parsed = contracts::react().parse(&reply(text)).unwrap();
    assert!(matches!(parsed.action, Action::ToolCalls(ref c) if c.len() == 1));

    // JSON mode: several calls, one per line inside the answer string.
    let text = r#"{"action": "tool",
        "answer": "{\"name\": \"a\", \"arguments\": {\"x\": 1}}\n{\"name\": \"b\", \"arguments\": {\"y\": 2}}"}"#;
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
fn answer_as_json_array_of_calls_parses() {
    let text = r#"{"action": "tool",
        "answer": "[{\"name\": \"a\"}, {\"name\": \"b\", \"arguments\": {\"y\": 2}}]"}"#;
    let parsed = contracts::react().parse(&reply(text)).unwrap();
    match parsed.action {
        Action::ToolCalls(calls) => {
            assert_eq!(calls.len(), 2);
            assert_eq!(calls[0].args, json!({}));
            assert_eq!(calls[1].args, json!({"y": 2}));
        }
        other => panic!("expected tool calls, got {other:?}"),
    }
}

#[test]
fn tool_action_with_unparseable_answer_falls_back_to_answer() {
    let text = "action: tool\nanswer: run the thing";
    let parsed = contracts::react().parse(&reply(text)).unwrap();
    assert_eq!(parsed.action, Action::Answer("run the thing".into()));
}

#[test]
fn tool_call_on_a_bare_line_without_answer_field_is_recovered() {
    // The exact live failure: the model wrote `action: tool` then dropped the
    // MCP call on its own line instead of under `answer:`. v2 must recover it.
    let text = "observation:\n- need to make a dir\nplan:\n- run mkdir\naction: tool\n{\"name\": \"shell\", \"arguments\": {\"command\": \"mkdir -p /root/project\"}}";
    let parsed = contracts::react().parse(&reply(text)).unwrap();
    match parsed.action {
        Action::ToolCalls(calls) => {
            assert_eq!(calls.len(), 1);
            assert_eq!(calls[0].name, "shell");
            assert_eq!(calls[0].args, json!({"command": "mkdir -p /root/project"}));
        }
        other => panic!("expected recovered tool call, got {other:?}"),
    }
}

#[test]
fn named_tool_call_shape_is_recovered() {
    // The second live shape: `toolname:` then a JSON args object (no MCP
    // "name" key). Two calls in one reply -> two ToolCalls, in order.
    let text = "action: tool\nwrite_file:\n{\n  \"content\": \"#!/bin/sh\\necho hi\",\n  \"path\": \"/root/project/greet.sh\"\n}\nshell:\n{\n  \"command\": \"sh /root/project/greet.sh\"\n}";
    let parsed = contracts::react().parse(&reply(text)).unwrap();
    match parsed.action {
        Action::ToolCalls(calls) => {
            assert_eq!(calls.len(), 2);
            assert_eq!(calls[0].name, "write_file");
            assert_eq!(calls[0].args["path"], "/root/project/greet.sh");
            assert_eq!(calls[1].name, "shell");
            assert_eq!(calls[1].args["command"], "sh /root/project/greet.sh");
        }
        other => panic!("expected two recovered tool calls, got {other:?}"),
    }
}

#[test]
fn string_answer_coerced_from_dash_list_reads_as_bullets() {
    // Live gemma shape: `answer:` then markdown bullets — TOON decodes a
    // list; the answer must come back as the dash lines, not a JSON dump.
    let text = "action: answer\nanswer:\n- first finding\n- second finding";
    let parsed = contracts::react().parse(&reply(text)).unwrap();
    assert_eq!(
        parsed.action,
        Action::Answer("- first finding\n- second finding".into())
    );
}

#[test]
fn strip_scaffold_drops_working_notes_keeps_answer_and_prose() {
    let c = contracts::react();
    let raw = "observation:\n- saw the file\nplan:\n- fix it\naction: answer\nanswer: done deal\ntrailing prose";
    assert_eq!(c.strip_scaffold(raw), "done deal\ntrailing prose");
    // Nothing but scaffold: keep the original rather than an empty answer.
    let scaffold_only = "observation:\n- nothing";
    assert_eq!(c.strip_scaffold(scaffold_only), scaffold_only);
}

#[test]
fn empty_answer_fallback_is_scaffold_stripped() {
    // `action: answer` with no `answer:` — the raw reply stands in, minus the
    // observation/plan working notes (context diet).
    let text =
        "The capital is Paris.\nobservation:\n- checked the atlas\nplan:\n- reply\naction: answer";
    let parsed = contracts::react().parse(&reply(text)).unwrap();
    assert_eq!(
        parsed.action,
        Action::Answer("The capital is Paris.".into())
    );
}

#[test]
fn a_plain_answer_object_is_not_mistaken_for_a_tool_call() {
    // action: answer with a JSON object in the text must NOT be recovered as a
    // tool call (no preceding tool label, no MCP name).
    let text = "action: answer\nanswer: your config is {\"port\": 8080}";
    let parsed = contracts::react().parse(&reply(text)).unwrap();
    assert!(matches!(parsed.action, Action::Answer(_)));
}
