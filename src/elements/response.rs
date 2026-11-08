//! # response
//! How the model must answer, and how replies are read. Config `format`: `toon` (default) or
//! `json`. Both carry a list of calls (run in order, results come back next step) and/or an
//! answer (ends the run). Unparseable text is taken as the answer.
//!
//! json: `{"calls":[{"tool":"t","args":{..}}]}` or `{"answer":"..."}`
//! toon:
//! ```text
//! calls[2]{tool,args}:
//!   search,{"q":"x"}
//!   read,{"path":"a"}
//! answer: text
//! ```
use crate::core::{read, value, Call, Component, Reply, Spec};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const DOC: &str = "Reply format (toon default | json) and the reply parser. Prompt: the format rules.";

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Cfg {
    #[serde(default)]
    format: String,
}

pub struct Response {
    name: String,
    cfg: Cfg,
}

pub fn new(s: Spec) -> Result<Box<dyn Component>, String> {
    let cfg: Cfg = read(&s.config)?;
    if !["", "json", "toon"].contains(&cfg.format.as_str()) {
        return Err(format!("format must be json or toon, not '{}'", cfg.format));
    }
    Ok(Box::new(Response { name: s.name, cfg }))
}

impl Response {
    fn toon(&self) -> bool {
        self.cfg.format != "json"
    }
}

impl Component for Response {
    fn kind(&self) -> &'static str { "response" }
    fn name(&self) -> &str { &self.name }
    fn doc(&self) -> &'static str { DOC }
    fn config(&self) -> Value { value(&self.cfg) }
    fn state(&self) -> Value { Value::Null }
    fn view(&self) -> crate::compose::Node {
        super::tile(&self.name, "response", [format!("format: {}", if self.toon() { "toon" } else { "json" })])
    }
    fn prompt(&self) -> Option<String> {
        Some(if self.toon() {
            "Reply in TOON only (no JSON object, no code fence).\nTo call tools: a header with the row count, then one indented row per call: tool name, comma, args as JSON. All rows run at the same time; results arrive next step.\ncalls[2]{tool,args}:\n  read_file,{\"path\":\"src/main.rs\"}\n  run,{\"command\":\"cargo test\"}\nOptional line after the rows: await: any (continue after the first result; the others are cancelled).\nWhen finished, reply with only:\nanswer: <text>".into()
        } else {
            r#"Reply with one JSON object only. To call tools (they run at the same time; results arrive next step): {"calls":[{"tool":"<name>","args":{...}}]} (add "await":"any" to continue after the first result; the others are cancelled). When finished: {"answer":"<text>"}"#.into()
        })
    }
    fn parse(&self, reply: &str) -> Option<Reply> {
        Some(if self.toon() { parse_toon(reply) } else { parse_json(reply) })
    }
}

/// JSON replies; tolerant of code fences and prose around the object.
pub fn parse_json(reply: &str) -> Reply {
    let v: Option<Value> = match (reply.find('{'), reply.rfind('}')) {
        (Some(a), Some(b)) if b > a => serde_json::from_str(&reply[a..=b]).ok(),
        _ => None,
    };
    let Some(v) = v else { return Reply { calls: vec![], answer: Some(reply.trim().into()), wait_any: false } };
    let mut calls: Vec<Call> = serde_json::from_value(v["calls"].clone()).unwrap_or_default();
    if let Some(t) = v["tool"].as_str() {
        calls.push(Call { tool: t.into(), args: v["args"].clone() });
    }
    let answer = v["answer"].as_str().map(String::from);
    let wait_any = v["await"] == "any";
    if calls.is_empty() && answer.is_none() {
        return Reply { calls, answer: Some(reply.trim().into()), wait_any };
    }
    Reply { calls, answer, wait_any }
}

/// TOON replies; falls back to JSON when no TOON block is found.
pub fn parse_toon(reply: &str) -> Reply {
    let mut calls = vec![];
    let mut answer: Option<String> = None;
    let mut in_calls = false;
    let mut wait_any = false;
    let mut lines = reply.lines().peekable();
    while let Some(line) = lines.next() {
        let t = line.trim();
        if t == "await: any" {
            wait_any = true;
            in_calls = false;
        } else if t.starts_with("calls[") && t.ends_with(':') {
            in_calls = true;
        } else if let Some((tool, args)) = one_call(t) {
            // Tolerated variant: `calls[0]{tool,NAME}: {args}` (one call per header).
            calls.push(Call { tool, args });
        } else if let Some(rest) = t.strip_prefix("answer:") {
            let mut a = rest.trim().to_string();
            for more in lines.by_ref() {
                a.push('\n');
                a.push_str(more);
            }
            answer = Some(a.trim().to_string());
        } else if in_calls && !t.is_empty() && line.starts_with(char::is_whitespace) {
            let (tool, args) = t.split_once(',').unwrap_or((t, ""));
            let args = serde_json::from_str(args.trim()).unwrap_or_else(|_| Value::String(args.trim().into()));
            calls.push(Call { tool: tool.trim().into(), args });
        } else {
            in_calls = false;
        }
    }
    if calls.is_empty() && answer.is_none() {
        return parse_json(reply);
    }
    Reply { calls, answer, wait_any }
}

/// `calls[i]{tool,NAME}: ARGS` → (NAME, ARGS).
fn one_call(t: &str) -> Option<(String, Value)> {
    let rest = t.strip_prefix("calls[")?;
    let (head, args) = rest.split_once("}:")?;
    let name = head.split_once("{tool,")?.1.trim();
    if name.is_empty() || name == "args" {
        return None;
    }
    let args = args.trim();
    Some((name.into(), if args.is_empty() { Value::Null } else { serde_json::from_str(args).unwrap_or_else(|_| Value::String(args.into())) }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn json_calls_answers_and_prose() {
        let r = parse_json("```json\n{\"calls\":[{\"tool\":\"a\",\"args\":{\"x\":1}},{\"tool\":\"b\"}]}\n```");
        assert_eq!(r.calls.len(), 2);
        assert_eq!(r.calls[0].args, json!({"x": 1}));
        assert_eq!(parse_json(r#"{"answer":"hi"}"#).answer.unwrap(), "hi");
        assert_eq!(parse_json(r#"{"tool":"a","args":{}}"#).calls[0].tool, "a");
        assert_eq!(parse_json("just text").answer.unwrap(), "just text");
    }

    #[test]
    fn toon_parallel_calls_and_multiline_answer() {
        let r = parse_toon("calls[2]{tool,args}:\n  search,{\"q\":\"x\"}\n  read,{\"path\":\"a\"}\n");
        assert_eq!(r.calls.iter().map(|c| c.tool.as_str()).collect::<Vec<_>>(), ["search", "read"]);
        assert_eq!(r.calls[0].args, json!({"q": "x"}));
        assert_eq!(parse_toon("answer: line one\nline two").answer.unwrap(), "line one\nline two");
        assert_eq!(parse_toon(r#"{"answer":"json still works"}"#).answer.unwrap(), "json still works");
        assert!(parse_toon("calls[1]{tool,args}:\n  a,{}\nawait: any").wait_any);
        assert!(parse_json(r#"{"calls":[{"tool":"a"}],"await":"any"}"#).wait_any);
        assert!(!parse_json(r#"{"calls":[{"tool":"a"}]}"#).wait_any);
    }

    #[test]
    fn format_is_a_runtime_knob() {
        let toon = new(Spec { kind: "response".into(), name: "r".into(), config: json!({"format": "toon"}), ..Default::default() }).unwrap();
        assert!(toon.prompt().unwrap().contains("calls[2]{tool,args}:"));
        assert_eq!(toon.parse("answer: ok").unwrap().answer.unwrap(), "ok");
        assert!(new(Spec { config: json!({"format": "xml"}), ..Default::default() }).is_err());
    }

    #[test]
    fn toon_is_the_default_and_tolerates_one_call_headers() {
        let r = new(Spec { kind: "response".into(), name: "r".into(), ..Default::default() }).unwrap();
        assert!(r.prompt().unwrap().starts_with("Reply in TOON"));
        let got = r.parse("calls[0]{tool,set_focus}: {\"text\":\"x\"}\ncalls[1]{tool,learn}: {\"section\":\"s\",\"lesson\":\"l\"}\nawait: none").unwrap();
        assert_eq!(got.calls.iter().map(|c| c.tool.as_str()).collect::<Vec<_>>(), ["set_focus", "learn"]);
        assert_eq!(got.calls[0].args, json!({"text": "x"}));
        assert!(got.answer.is_none());
    }
}
