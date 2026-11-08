//! The loop's reply format: a TOON subset by default, JSON as the fallback (owner decision 4).
//!
//! TOON subset (one reply):
//! ```text
//! thought: <one line>
//! calls[2]{tool,args}:
//!   clock.now,{}
//!   note.write,{"text":"hi, there"}
//! answer: <text; it runs to the end of the reply, any number of lines>
//! ```
//! - Every field is optional, but a reply carries `calls` or `answer` (or both: the calls run,
//!   and the answer ends the run only when there are no calls).
//! - `calls[N]{tool,args}:` is a tabular array: N rows follow, each indented, each
//!   `<tool>,<args>` split on the first comma; `args` is a JSON object (`{}` when empty). The
//!   row count must equal N.
//! - `answer:` is the last field: everything after it is the answer.
//! - Lines before the first field and blank lines are ignored.
//!
//! JSON fallback: `{"thought": "...", "calls": [{"tool": "...", "args": {...}}], "answer": "..."}`,
//! bare or inside a ``` fence.

use anyhow::{Result, anyhow, bail};
use serde_json::{Map, Value};

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Call {
    pub tool: String,
    pub args: Value,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Reply {
    pub thought: Option<String>,
    pub calls: Vec<Call>,
    pub answer: Option<String>,
}

/// TOON first, then JSON; the error names both failures.
pub fn parse(text: &str) -> Result<Reply> {
    match parse_toon(text) {
        Ok(r) => Ok(r),
        Err(toon) => parse_json(text).map_err(|json| anyhow!("reply is neither TOON ({toon:#}) nor JSON ({json:#})")),
    }
}

pub fn parse_toon(text: &str) -> Result<Reply> {
    let mut r = Reply::default();
    let lines: Vec<&str> = text.lines().collect();
    let mut i = 0;
    let mut any = false;
    while i < lines.len() {
        let line = lines[i];
        let t = line.trim();
        if let Some(v) = t.strip_prefix("thought:") {
            r.thought = Some(v.trim().to_string());
            any = true;
        } else if let Some(rest) = t.strip_prefix("calls[") {
            let (n, tail) = rest.split_once(']').ok_or_else(|| anyhow!("calls[ is not closed"))?;
            let n: usize = n.trim().parse().map_err(|_| anyhow!("calls[{n}]: not a count"))?;
            let tail = tail.trim();
            if !(tail == "{tool,args}:" || tail == ":") {
                bail!("calls[{n}] must be followed by {{tool,args}}:");
            }
            for _ in 0..n {
                i += 1;
                let row = lines.get(i).ok_or_else(|| anyhow!("calls[{n}]: only {} row(s)", r.calls.len()))?;
                if !row.starts_with([' ', '\t']) || row.trim().is_empty() {
                    bail!("calls[{n}]: only {} row(s)", r.calls.len());
                }
                r.calls.push(row_of(row.trim())?);
            }
            // a further indented row means the count was wrong
            if let Some(next) = lines.get(i + 1)
                && next.starts_with([' ', '\t'])
                && !next.trim().is_empty()
                && !is_field(next.trim())
            {
                bail!("calls[{n}]: more rows than {n}");
            }
            any = true;
        } else if let Some(v) = t.strip_prefix("answer:") {
            let mut a = vec![v.trim_start().to_string()];
            a.extend(lines[i + 1..].iter().map(|l| l.to_string()));
            r.answer = Some(a.join("\n").trim().to_string());
            any = true;
            break;
        }
        i += 1;
    }
    if !any {
        bail!("no thought:, calls[N] or answer: field");
    }
    if r.calls.is_empty() && r.answer.is_none() {
        bail!("a reply needs calls or an answer");
    }
    Ok(r)
}

fn is_field(t: &str) -> bool {
    t.starts_with("thought:") || t.starts_with("answer:") || t.starts_with("calls[")
}

fn row_of(row: &str) -> Result<Call> {
    let (tool, args) = match row.split_once(',') {
        Some((t, a)) => (t.trim(), a.trim()),
        None => (row.trim(), ""),
    };
    if tool.is_empty() {
        bail!("a call row needs a tool name");
    }
    let args = if args.is_empty() {
        Value::Object(Map::new())
    } else {
        serde_json::from_str::<Value>(args).map_err(|e| anyhow!("args of {tool} are not JSON: {e}"))?
    };
    if !args.is_object() {
        bail!("args of {tool} must be a JSON object");
    }
    Ok(Call { tool: tool.to_string(), args })
}

pub fn parse_json(text: &str) -> Result<Reply> {
    let t = text.trim();
    let body = match t.find("```") {
        Some(start) => {
            let after = &t[start + 3..];
            let after = after.strip_prefix("json").unwrap_or(after);
            after.split("```").next().unwrap_or(after).trim()
        }
        None => t,
    };
    let v: Value = serde_json::from_str(body)?;
    let o = v.as_object().ok_or_else(|| anyhow!("not a JSON object"))?;
    let mut r = Reply {
        thought: o.get("thought").and_then(Value::as_str).map(String::from),
        answer: o.get("answer").and_then(|a| if a.is_string() { a.as_str().map(String::from) } else if a.is_null() { None } else { Some(a.to_string()) }),
        calls: vec![],
    };
    for c in o.get("calls").and_then(Value::as_array).cloned().unwrap_or_default() {
        let tool = c["tool"].as_str().ok_or_else(|| anyhow!("a call needs a tool"))?.to_string();
        let args = if c["args"].is_object() { c["args"].clone() } else { Value::Object(Map::new()) };
        r.calls.push(Call { tool, args });
    }
    if r.calls.is_empty() && r.answer.is_none() {
        bail!("a reply needs calls or an answer");
    }
    Ok(r)
}

/// The format section of a prompt. Without tools it never mentions calls.
pub fn format_help(with_tools: bool) -> String {
    if with_tools {
        "Reply in TOON:\nthought: <one line>\ncalls[N]{tool,args}:\n  <tool>,<JSON object of args>\nanswer: <final answer; only when no calls are needed>\nCalls in one reply run in parallel; their results come back on the next step. JSON is accepted too: {\"thought\", \"calls\": [{\"tool\", \"args\"}], \"answer\"}.".into()
    } else {
        "Reply in TOON:\nthought: <one line>\nanswer: <final answer>\nJSON is accepted too: {\"thought\", \"answer\"}.".into()
    }
}
