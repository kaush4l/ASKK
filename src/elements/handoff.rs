//! # handoff
//! How the model must answer, and how replies are read. Config:
//! - `format`: `toon` (default) or `json`.
//! - `fields`: custom fields the model writes first, in order, each `{name, about}` (default:
//!   `plan`: reason before acting). Set `[]` for none; add `plan`, `risks`, `confidence`, …
//!
//! Then `act: [...]` (tool calls written as signatures, all started at once; every result comes
//! back next step) and/or `answer:` (ends the run). Unparseable text is taken as the answer.
//!
//! ```text
//! plan: need the file and the test result
//! act: [read_file(path: "src/main.rs"), run(command: "cargo test")]
//! ```
//! Args: `name: value` pairs (values are JSON: "text", 3, true, [..], {..}) or one JSON object;
//! `tool()` has none. The list may span lines. JSON format: `{"act": ["tool(args)", ...]}`.
use crate::core::{read, value, Call, Component, Reply, Spec};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const DOC: &str = "Reply format (toon default | json) and the reply parser. Prompt: the format rules.";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Field {
    pub name: String,
    #[serde(default)]
    pub about: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Cfg {
    #[serde(default)]
    format: String,
    #[serde(default = "default_fields")]
    fields: Vec<Field>,
    /// One-line reminder at the very end of the prompt (empty = the built-in one; "off" = none).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    nudge: String,
}

impl Default for Cfg {
    fn default() -> Self {
        Self { format: String::new(), fields: default_fields(), nudge: String::new() }
    }
}

fn default_fields() -> Vec<Field> {
    vec![Field { name: "plan".into(), about: "what is asked, what you know, what to do next and why".into() }]
}

pub struct Response {
    name: String,
    cfg: Cfg,
    /// The custom fields of the last reply (`summary`, `plan`, ...), shown on the dashboard.
    last: serde_json::Map<String, Value>,
}

pub fn new(s: Spec) -> Result<Box<dyn Component>, String> {
    let cfg: Cfg = read(&s.config)?;
    if !["", "json", "toon"].contains(&cfg.format.as_str()) {
        return Err(format!("format must be json or toon, not '{}'", cfg.format));
    }
    if let Some(f) = cfg.fields.iter().find(|f| f.name.is_empty() || RESERVED.contains(&f.name.as_str()) || f.name.contains(char::is_whitespace)) {
        return Err(format!("field name '{}' is empty, reserved or has spaces", f.name));
    }
    let last = s.state.get("last").and_then(|v| v.as_object()).cloned().unwrap_or_default();
    Ok(Box::new(Response { name: s.name, cfg, last }))
}

/// Keys the format itself uses.
const RESERVED: &[&str] = &["calls", "answer", "await", "tool", "args"];

impl Response {
    fn toon(&self) -> bool {
        self.cfg.format != "json"
    }
    fn names(&self) -> Vec<String> {
        self.cfg.fields.iter().map(|f| f.name.clone()).collect()
    }
}

impl Component for Response {
    fn kind(&self) -> &'static str { "handoff" }
    fn unique(&self) -> bool { true }
    fn category(&self) -> &'static str { "prompt" }
    fn icon(&self) -> &'static str { "reply" }
    fn slot(&self) -> crate::core::Slot { crate::core::Slot::Format }
    fn summary(&self) -> Option<String> { self.last.get("summary").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(String::from) }
    fn name(&self) -> &str { &self.name }
    fn doc(&self) -> &'static str { DOC }
    fn config(&self) -> Value { value(&self.cfg) }
    fn state(&self) -> Value {
        if self.last.is_empty() { Value::Null } else { serde_json::json!({"last": self.last}) }
    }
    fn on(&mut self, ev: &crate::core::Event) {
        if let crate::core::Event::Reply(text) = ev {
            let r = if self.toon() { parse_toon_with(text, &self.names()) } else { parse_json_with(text, &self.names()) };
            if !r.fields.is_empty() {
                self.last = r.fields.into_iter().map(|(k, v)| (k, Value::String(v))).collect();
            }
        }
    }
    fn view(&self) -> crate::core::node::Node {
        let mut lines = vec![format!("format: {}", if self.toon() { "toon" } else { "json" })];
        lines.extend(self.cfg.fields.iter().map(|f| format!("{}: {}", f.name, f.about)));
        super::tile(&self.name, "handoff", lines)
    }
    fn nudge(&self) -> Option<String> {
        match self.cfg.nudge.as_str() {
            "off" => None,
            "" => {
                let first: Vec<&str> = self.cfg.fields.iter().map(|f| f.name.as_str()).collect();
                let lead = if first.is_empty() { String::new() } else { format!("{} first, then ", first.join(", ")) };
                Some(if self.toon() { format!("Reply now in the format above: {lead}`act: [...]` or `answer: <text>`.") } else { format!("Reply now with one JSON object: {lead}\"act\" or \"answer\".") })
            }
            n => Some(n.to_string()),
        }
    }
    fn prompt(&self) -> Option<String> {
        let fields = if self.cfg.fields.is_empty() {
            String::new()
        } else if self.toon() {
            let list: Vec<String> = self.cfg.fields.iter().map(|f| format!("{}: <{}>", f.name, f.about)).collect();
            format!("Start every reply with these fields, in order (each may span lines):\n{}\nThen:\n", list.join("\n"))
        } else {
            let list: Vec<String> = self.cfg.fields.iter().map(|f| format!("\"{}\": {}", f.name, f.about)).collect();
            format!("Put these keys first in the object: {}.\n", list.join("; "))
        };
        Some(fields + &if self.toon() {
            "Reply in this format only (no JSON object, no code fence).\nTo use tools: one line `act: [...]` listing calls as signatures, separated by commas. All of them start at once; every result arrives next step.\nact: [read_file(path: \"src/main.rs\"), run(command: \"cargo test\")]\nArgs are name: value pairs; values are JSON (\"text\", 3, true, [..], {..}). A tool without args: now().\nWhen finished, instead of act:\nanswer: <text>".to_string()
        } else {
            r#"Reply with one JSON object only. To use tools (all start at once; results arrive next step): {"act":["read_file(path: \"a.rs\")","now()"]}. When finished: {"answer":"<text>"}"#.to_string()
        })
    }
    fn parse(&self, reply: &str) -> Option<Reply> {
        let names = self.names();
        Some(if self.toon() { parse_toon_with(reply, &names) } else { parse_json_with(reply, &names) })
    }
    fn partial(&self, so_far: &str) -> Option<String> {
        Some(answer_so_far(so_far, &self.names()))
    }
}

/// The answer in a reply that is still arriving, as far as it has come; empty while what has
/// come is fields or calls. A reply that is plain prose (no key at its start) is all answer,
/// as [`parse_toon_with`] would read it whole.
pub fn answer_so_far(so_far: &str, names: &[String]) -> String {
    let t = so_far.trim_start();
    if t.is_empty() {
        return String::new();
    }
    // A JSON object (bare or fenced): the string under "answer", as far as it has come.
    if t.starts_with('{') || t.starts_with("```") {
        let Some(at) = t.find("\"answer\"") else { return String::new() };
        let rest = t[at + 8..].trim_start();
        let Some(rest) = rest.strip_prefix(':').map(str::trim_start).and_then(|r| r.strip_prefix('"')) else { return String::new() };
        let mut out = String::new();
        let mut chars = rest.chars();
        while let Some(c) = chars.next() {
            match c {
                '"' => break,
                '\\' => match chars.next() {
                    Some('n') => out.push('\n'),
                    Some('t') => out.push('\t'),
                    Some('u') => {
                        let hex: String = chars.by_ref().take(4).collect();
                        out.extend(u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32));
                    }
                    Some(other) => out.push(other),
                    None => break,
                },
                c => out.push(c),
            }
        }
        return out;
    }
    let keyed = |line: &str| {
        let l = line.trim();
        ["act:", "calls[", "answer:", "await:"].iter().any(|k| l.starts_with(k)) || names.iter().any(|n| l.starts_with(&format!("{n}:")))
    };
    let first = t.lines().next().unwrap_or_default();
    // The first line is not whole yet and could still become a key: wait for it.
    if !t.contains('\n') && !first.contains(':') && first.len() < 24 {
        return String::new();
    }
    if !keyed(first) {
        return t.to_string();
    }
    let mut out: Vec<&str> = vec![];
    let mut inside = false;
    for line in t.lines() {
        if let Some(rest) = line.trim_start().strip_prefix("answer:") {
            inside = true;
            out.push(rest.trim_start());
        } else if inside && keyed(line) {
            break;
        } else if inside {
            out.push(line);
        }
    }
    out.join("\n")
}

/// JSON replies; tolerant of code fences and prose around the object.
#[cfg_attr(not(test), allow(dead_code))]
pub fn parse_json(reply: &str) -> Reply {
    parse_json_with(reply, &[])
}

/// JSON replies with custom fields read from their keys.
pub fn parse_json_with(reply: &str, names: &[String]) -> Reply {
    let v: Option<Value> = match (reply.find('{'), reply.rfind('}')) {
        (Some(a), Some(b)) if b > a => serde_json::from_str(&reply[a..=b]).ok(),
        _ => None,
    };
    let Some(v) = v else { return Reply { answer: Some(reply.trim().into()), ..Default::default() } };
    let fields: Vec<(String, String)> = names.iter().filter_map(|n| v.get(n).map(|x| (n.clone(), crate::core::text(x)))).collect();
    let mut calls: Vec<Call> = serde_json::from_value(v["calls"].clone()).unwrap_or_default();
    for item in v["act"].as_array().into_iter().flatten() {
        match item {
            Value::String(sig) => calls.extend(signature(sig)),
            o => calls.extend(serde_json::from_value::<Call>(o.clone()).ok()),
        }
    }
    if let Some(t) = v["tool"].as_str() {
        calls.push(Call { tool: t.into(), args: v["args"].clone() });
    }
    let answer = v["answer"].as_str().map(String::from);
    let wait_any = v["await"] == "any";
    if calls.is_empty() && answer.is_none() {
        return Reply { fields, calls, answer: Some(reply.trim().into()), wait_any };
    }
    Reply { fields, calls, answer, wait_any }
}

/// TOON replies; falls back to JSON when no TOON block is found.
#[cfg_attr(not(test), allow(dead_code))]
pub fn parse_toon(reply: &str) -> Reply {
    parse_toon_with(reply, &[])
}

/// TOON replies with custom fields: `name: text` lines (continuing until the next key).
pub fn parse_toon_with(reply: &str, names: &[String]) -> Reply {
    let mut fields: Vec<(String, String)> = vec![];
    let mut in_field = false;
    let mut calls = vec![];
    let mut answer: Option<String> = None;
    let mut in_calls = false;
    let mut wait_any = false;
    let mut lines = reply.lines().peekable();
    while let Some(line) = lines.next() {
        let t = line.trim();
        if let Some((n, rest)) = names.iter().find_map(|n| t.strip_prefix(&format!("{n}:")).map(|r| (n.clone(), r.trim().to_string()))) {
            fields.push((n, rest));
            in_field = true;
            in_calls = false;
            continue;
        }
        let key = t.starts_with("act:") || t.starts_with("calls[") || t.starts_with("answer:") || t.starts_with("await:");
        if in_field && !key {
            let f = &mut fields.last_mut().unwrap().1;
            if !f.is_empty() { f.push('\n'); }
            f.push_str(line);
            continue;
        }
        in_field = false;
        if let Some(rest) = t.strip_prefix("act:") {
            // The list may span lines: read until its brackets balance.
            let mut text = rest.trim().to_string();
            while depth(&text) > 0 {
                match lines.next() {
                    Some(more) => { text.push('\n'); text.push_str(more); }
                    None => break,
                }
            }
            calls.extend(act_list(&text));
            in_calls = false;
            continue;
        }
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
    for f in fields.iter_mut() {
        f.1 = f.1.trim().to_string();
    }
    if calls.is_empty() && answer.is_none() {
        if !fields.is_empty() {
            // Only fields: the model never finished; keep what it wrote, nothing to run.
            return Reply { fields, ..Default::default() };
        }
        return parse_json_with(reply, names);
    }
    Reply { fields, calls, answer, wait_any }
}

/// Open bracket depth outside strings (`[`, `(`, `{`).
fn depth(s: &str) -> i32 {
    let (mut d, mut q, mut esc) = (0, false, false);
    for c in s.chars() {
        if esc { esc = false; continue; }
        match c {
            '\\' if q => esc = true,
            '"' => q = !q,
            '[' | '(' | '{' if !q => d += 1,
            ']' | ')' | '}' if !q => d -= 1,
            _ => {}
        }
    }
    d
}

/// Split at top-level commas (outside strings and brackets).
fn split_top(s: &str) -> Vec<String> {
    let (mut out, mut cur) = (vec![], String::new());
    let (mut d, mut q, mut esc) = (0, false, false);
    for c in s.chars() {
        if esc { esc = false; cur.push(c); continue; }
        match c {
            '\\' if q => esc = true,
            '"' => q = !q,
            '[' | '(' | '{' if !q => d += 1,
            ']' | ')' | '}' if !q => d -= 1,
            ',' if !q && d == 0 => { out.push(std::mem::take(&mut cur)); continue; }
            _ => {}
        }
        cur.push(c);
    }
    out.push(cur);
    out.into_iter().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect()
}

/// `[a(x: 1), b()]` → calls.
pub fn act_list(text: &str) -> Vec<Call> {
    let t = text.trim();
    let inner = t.strip_prefix('[').map(|x| x.strip_suffix(']').unwrap_or(x)).unwrap_or(t);
    split_top(inner).iter().filter_map(|s| signature(s)).collect()
}

/// `tool(name: value, ...)` or `tool({json})` or `tool()` → a call.
pub fn signature(s: &str) -> Option<Call> {
    let s = s.trim();
    let open = s.find('(')?;
    let tool = s[..open].trim();
    if tool.is_empty() || !tool.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '/' || c == '.') {
        return None;
    }
    let inner = s[open + 1..].trim_end().strip_suffix(')')?.trim();
    let args = if inner.is_empty() {
        Value::Null
    } else if inner.starts_with('{') {
        serde_json::from_str(inner).ok()?
    } else {
        let mut m = serde_json::Map::new();
        for pair in split_top(inner) {
            let (k, v) = pair.split_once(':').or_else(|| pair.split_once('='))?;
            let v = v.trim();
            m.insert(k.trim().trim_matches('"').into(), serde_json::from_str(v).unwrap_or_else(|_| Value::String(v.trim_matches('"').into())));
        }
        Value::Object(m)
    };
    Some(Call { tool: tool.into(), args })
}

/// `calls[i]{tool,NAME}: ARGS` → (NAME, ARGS).
fn one_call(t: &str) -> Option<(String, Value)> {
    let rest = t.strip_prefix("calls[")?;
    let (head, args) = rest.split_once("}:")?;
    let name = head.split_once("{tool,")?.1.trim();
    if name.is_empty() || name == "args" {
        return None;
    }
    // Only a JSON object (or nothing) counts as args: `calls[0]{tool,reply}: none` is not a call.
    let args = args.trim();
    let args = if args.is_empty() { Value::Null } else { serde_json::from_str::<Value>(args).ok().filter(Value::is_object)? };
    Some((name.into(), args))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_answer_is_read_while_the_reply_arrives() {
        let names = vec!["plan".to_string()];
        let read = |t: &str| answer_so_far(t, &names);
        assert_eq!(read("plan: look it up\nact: [now("), "", "fields and calls are not an answer");
        assert_eq!(read("plan: done\nanswer: It is ten"), "It is ten");
        assert_eq!(read("plan: x\nanswer: one\ntwo"), "one\ntwo", "an answer may span lines");
        assert_eq!(read("{\"plan\":\"x\",\"answer\":\"a \\\"b\\\"\\nc"), "a \"b\"\nc", "JSON, cut mid-string");
        assert_eq!(read("{\"act\":[\"now()\"]"), "");
        assert_eq!(read("pla"), "", "the first line could still become a key");
        assert_eq!(read("Hello there, here is a plain reply\nwith two lines"), "Hello there, here is a plain reply\nwith two lines", "plain prose is all answer");
    }

    #[test]
    fn the_last_reply_fields_are_kept_for_the_ui() {
        let cfg = serde_json::json!({"fields": [{"name": "summary", "about": "x"}, {"name": "plan", "about": "y"}]});
        let mut h = new(Spec { kind: "handoff".into(), name: "handoff".into(), config: cfg, ..Default::default() }).unwrap();
        assert!(h.state().is_null());
        h.on(&crate::core::Event::Reply("summary: posted the quest\nplan: wait\nanswer: ok".into()));
        assert_eq!(h.state()["last"]["summary"], "posted the quest");
        let back = new(Spec { kind: "handoff".into(), name: "handoff".into(), config: h.config(), state: h.state(), ..Default::default() }).unwrap();
        assert_eq!(back.state()["last"]["plan"], "wait", "survives a restart");
    }
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
    fn act_lists_signatures_that_all_start_at_once() {
        let r = parse_toon("thinking: x\nact: [read_file(path: \"src/a, b.rs\"), run(command: \"cargo test\", timeout: 60), now(), set({\"k\": [1, 2]})]");
        let got: Vec<(&str, Value)> = r.calls.iter().map(|c| (c.tool.as_str(), c.args.clone())).collect();
        assert_eq!(got, vec![
            ("read_file", json!({"path": "src/a, b.rs"})),
            ("run", json!({"command": "cargo test", "timeout": 60})),
            ("now", Value::Null),
            ("set", json!({"k": [1, 2]})),
        ]);
        let multi = parse_toon("act: [\n  write_file(path: \"a\", text: \"x(y)\"),\n  list_dir(path: \".\")\n]\n");
        assert_eq!(multi.calls.len(), 2);
        assert_eq!(multi.calls[0].args["text"], "x(y)");
        assert_eq!(parse_toon("act: []\nanswer: none needed").answer.as_deref(), Some("none needed"));
        assert_eq!(parse_json(r#"{"act":["now()","read_file(path: \"a\")"]}"#).calls.len(), 2);
    }

    #[test]
    fn custom_fields_come_first_and_are_read_back() {
        let r = new(Spec { kind: "handoff".into(), name: "r".into(), config: json!({"fields": [{"name": "thinking", "about": "reason"}, {"name": "plan", "about": "steps"}]}), ..Default::default() }).unwrap();
        let p = r.prompt().unwrap();
        assert!(p.starts_with("Start every reply with these fields, in order") && p.find("thinking: <reason>") < p.find("plan: <steps>"), "{p}");
        let got = r.parse("thinking: the user wants x\nso read a first\nplan: 1. read\nact: [read(path: \"a\")]").unwrap();
        assert_eq!(got.fields, vec![("thinking".into(), "the user wants x\nso read a first".into()), ("plan".into(), "1. read".into())]);
        assert_eq!(got.calls[0].tool, "read");
        let done = r.parse("thinking: easy\nanswer: 4").unwrap();
        assert_eq!((done.fields.len(), done.answer.as_deref()), (1, Some("4")));
        let json = new(Spec { kind: "handoff".into(), name: "r".into(), config: json!({"format": "json"}), ..Default::default() }).unwrap();
        assert_eq!(json.parse(r#"{"plan":"hm","answer":"ok"}"#).unwrap().fields, vec![("plan".into(), "hm".into())]);
        let none = new(Spec { kind: "handoff".into(), name: "r".into(), config: json!({"fields": []}), ..Default::default() }).unwrap();
        assert!(none.prompt().unwrap().starts_with("Reply in this format"));
        assert!(new(Spec { config: json!({"fields": [{"name": "answer"}]}), ..Default::default() }).is_err());
    }

    #[test]
    fn format_is_a_runtime_knob() {
        let toon = new(Spec { kind: "handoff".into(), name: "r".into(), config: json!({"format": "toon"}), ..Default::default() }).unwrap();
        assert!(toon.prompt().unwrap().contains("act: [read_file(path:"));
        assert_eq!(toon.parse("answer: ok").unwrap().answer.unwrap(), "ok");
        assert!(new(Spec { config: json!({"format": "xml"}), ..Default::default() }).is_err());
    }

    #[test]
    fn toon_is_the_default_and_tolerates_one_call_headers() {
        let r = new(Spec { kind: "handoff".into(), name: "r".into(), ..Default::default() }).unwrap();
        assert!(r.prompt().unwrap().starts_with("Start every reply with these fields"));
        let got = r.parse("calls[0]{tool,set_focus}: {\"text\":\"x\"}\ncalls[1]{tool,learn}: {\"section\":\"s\",\"lesson\":\"l\"}\nawait: none").unwrap();
        assert_eq!(got.calls.iter().map(|c| c.tool.as_str()).collect::<Vec<_>>(), ["set_focus", "learn"]);
        assert_eq!(got.calls[0].args, json!({"text": "x"}));
        assert!(got.answer.is_none());
        let hello = r.parse("calls[0]{tool,reply}: none\nawait: none\nanswer: Hello").unwrap();
        assert!(hello.calls.is_empty() && hello.answer.as_deref() == Some("Hello"));
    }
}
