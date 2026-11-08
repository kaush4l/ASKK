//! The loop's reply format: a TOON subset by default, JSON as the fallback (owner decision 4).
//! The full standard is docs/tools.md §Reply format.
//!
//! TOON subset (one reply):
//! ```text
//! thought: <one line>
//! calls[2]{id,tool,args}:
//!   c1,web.fetch,{"url":"https://example.org"}
//!   c2,clock.now,{}
//! await: all | any | none | c1,c3
//! cancel: c2
//! answer: <text; it runs to the end of the reply, any number of lines>
//! ```
//! - Every field is optional, but a reply carries at least one of `calls[N]` (even `calls[0]`),
//!   `await`, `cancel` or `answer`.
//! - `calls[N]{id,tool,args}:` is a tabular array: N indented rows `<id>,<tool>,<args>`; the header
//!   `{tool,args}` (or a bare `:`) takes rows `<tool>,<args>` and the loop assigns ids. `args` is a
//!   JSON object (`{}` when empty). The row count must equal N. The calls start at once, in parallel.
//! - `await` (default `all`): when the next step comes — `all` after every call of this reply
//!   finished, `any` as soon as one of them finished, `none` right away (they keep running), or a
//!   list of call ids. With no calls in the reply, `all` / `any` refer to every running call.
//! - `cancel: c2, c4` aborts running calls (status `cancelled`).
//! - `answer:` is the last field: everything after it is the answer. It ends the run once no call
//!   is running; until then it is held (`pending_answer`) and the loop waits for the running calls.
//! - Lines before the first field and blank lines are ignored.
//!
//! JSON fallback: `{"thought", "calls": [{"id"?, "tool", "args"}], "await", "cancel", "answer"}`
//! (`await` a string or a list of ids, `cancel` a list or a comma-separated string), bare or
//! inside a ``` fence.

use anyhow::{Result, anyhow, bail};
use serde_json::{Map, Value};

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Call {
    /// The model's id for it; `None`: the loop assigns the next free `c<n>`.
    pub id: Option<String>,
    pub tool: String,
    pub args: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Await {
    #[default]
    All,
    Any,
    None,
    Ids(Vec<String>),
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Reply {
    pub thought: Option<String>,
    pub calls: Vec<Call>,
    pub wait: Await,
    pub cancel: Vec<String>,
    pub answer: Option<String>,
}

/// TOON first, then JSON; the error names both failures.
pub fn parse(text: &str) -> Result<Reply> {
    match parse_toon(text) {
        Ok(r) => Ok(r),
        Err(toon) => parse_json(text).map_err(|json| anyhow!("reply is neither TOON ({toon:#}) nor JSON ({json:#})")),
    }
}

fn ids(s: &str) -> Vec<String> {
    s.split(',').map(str::trim).filter(|x| !x.is_empty()).map(String::from).collect()
}

fn await_of(s: &str) -> Result<Await> {
    Ok(match s.trim() {
        "" | "all" => Await::All,
        "any" => Await::Any,
        "none" => Await::None,
        list => {
            let v = ids(list);
            if v.iter().any(|i| !valid_id(i)) {
                bail!("await: {list} is not all | any | none | call ids");
            }
            Await::Ids(v)
        }
    })
}

/// A call id: a letter then letters, digits, `_` or `-` (`c1`, `fetch-2`).
pub fn valid_id(s: &str) -> bool {
    let mut c = s.chars();
    c.next().is_some_and(|f| f.is_ascii_alphabetic()) && c.all(|x| x.is_ascii_alphanumeric() || x == '_' || x == '-')
}

pub fn parse_toon(text: &str) -> Result<Reply> {
    let mut r = Reply::default();
    let lines: Vec<&str> = text.lines().collect();
    let mut i = 0;
    let mut any = false;
    let mut acts = false;
    while i < lines.len() {
        let t = lines[i].trim();
        if let Some(v) = t.strip_prefix("thought:") {
            r.thought = Some(v.trim().to_string());
            any = true;
        } else if let Some(rest) = t.strip_prefix("calls[") {
            let (n, tail) = rest.split_once(']').ok_or_else(|| anyhow!("calls[ is not closed"))?;
            let n: usize = n.trim().parse().map_err(|_| anyhow!("calls[{n}]: not a count"))?;
            let with_id = match tail.trim() {
                "{id,tool,args}:" => true,
                "{tool,args}:" | ":" => false,
                _ => bail!("calls[{n}] must be followed by {{id,tool,args}}:"),
            };
            for _ in 0..n {
                i += 1;
                let row = lines.get(i).ok_or_else(|| anyhow!("calls[{n}]: only {} row(s)", r.calls.len()))?;
                if !row.starts_with([' ', '\t']) || row.trim().is_empty() {
                    bail!("calls[{n}]: only {} row(s)", r.calls.len());
                }
                r.calls.push(row_of(row.trim(), with_id)?);
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
            acts = true;
        } else if let Some(v) = t.strip_prefix("await:") {
            r.wait = await_of(v)?;
            any = true;
            acts = true;
        } else if let Some(v) = t.strip_prefix("cancel:") {
            r.cancel = ids(v);
            any = true;
            acts = true;
        } else if let Some(v) = t.strip_prefix("answer:") {
            let mut a = vec![v.trim_start().to_string()];
            a.extend(lines[i + 1..].iter().map(|l| l.to_string()));
            r.answer = Some(a.join("\n").trim().to_string());
            any = true;
            acts = true;
            break;
        }
        i += 1;
    }
    if !any {
        bail!("no thought:, calls[N], await:, cancel: or answer: field");
    }
    if !acts {
        bail!("a reply needs calls, await, cancel or an answer");
    }
    Ok(r)
}

fn is_field(t: &str) -> bool {
    ["thought:", "answer:", "calls[", "await:", "cancel:"].iter().any(|f| t.starts_with(f))
}

fn row_of(row: &str, with_id: bool) -> Result<Call> {
    let (id, row) = if with_id {
        let (id, rest) = row.split_once(',').ok_or_else(|| anyhow!("a call row needs id,tool,args: {row}"))?;
        let id = id.trim();
        if !valid_id(id) {
            bail!("{id} is not a call id");
        }
        (Some(id.to_string()), rest.trim())
    } else {
        (None, row)
    };
    let (tool, args) = match row.split_once(',') {
        Some((t, a)) => (t.trim(), a.trim()),
        None => (row.trim(), ""),
    };
    if tool.is_empty() {
        bail!("a call row needs a tool name");
    }
    let args = if args.is_empty() { Value::Object(Map::new()) } else { serde_json::from_str::<Value>(args).map_err(|e| anyhow!("args of {tool} are not JSON: {e}"))? };
    if !args.is_object() {
        bail!("args of {tool} must be a JSON object");
    }
    Ok(Call { id, tool: tool.to_string(), args })
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
    let list = |k: &str| -> Vec<String> {
        match o.get(k) {
            Some(Value::String(s)) => ids(s),
            Some(Value::Array(a)) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
            _ => vec![],
        }
    };
    let wait = match o.get("await") {
        None | Some(Value::Null) => Await::All,
        Some(Value::String(s)) => await_of(s)?,
        Some(Value::Array(_)) => Await::Ids(list("await")),
        Some(x) => bail!("await {x} is not all | any | none | ids"),
    };
    let mut r = Reply {
        thought: o.get("thought").and_then(Value::as_str).map(String::from),
        answer: o.get("answer").and_then(|a| {
            if a.is_string() {
                a.as_str().map(String::from)
            } else if a.is_null() {
                None
            } else {
                Some(a.to_string())
            }
        }),
        calls: vec![],
        wait,
        cancel: list("cancel"),
    };
    for c in o.get("calls").and_then(Value::as_array).cloned().unwrap_or_default() {
        let tool = c["tool"].as_str().ok_or_else(|| anyhow!("a call needs a tool"))?.to_string();
        let id = c["id"].as_str().map(String::from);
        if let Some(i) = &id
            && !valid_id(i)
        {
            bail!("{i} is not a call id");
        }
        let args = if c["args"].is_object() { c["args"].clone() } else { Value::Object(Map::new()) };
        r.calls.push(Call { id, tool, args });
    }
    let acts = o.contains_key("calls") || o.contains_key("await") || !r.cancel.is_empty() || r.answer.is_some();
    if !acts {
        bail!("a reply needs calls, await, cancel or an answer");
    }
    Ok(r)
}

/// The REPLY FORMAT section of a prompt, generated from the format above. Without tools it
/// never mentions calls.
pub fn format_help(with_tools: bool) -> String {
    if with_tools {
        [
            "Reply in TOON:",
            "thought: <one line>",
            "calls[N]{id,tool,args}:",
            "  c1,<tool>,<JSON object of args>",
            "await: all | any | none | <ids>",
            "cancel: <ids of running calls>",
            "answer: <final answer>",
            "Calls start at once and run in parallel; ids are yours (c1, c2, …, unique in this run). await says when your next step comes: all (default) when every call of this reply is done, any when one is, none right away while they keep running, or when the listed ids are. Calls still running are listed under RUNNING; their results arrive as tool messages. cancel stops running calls. An answer ends the run once no call is running (cancel what you no longer need).",
            "JSON is accepted too: {\"thought\", \"calls\": [{\"id\", \"tool\", \"args\"}], \"await\", \"cancel\", \"answer\"}.",
        ]
        .join("\n")
    } else {
        "Reply in TOON:\nthought: <one line>\nanswer: <final answer>\nJSON is accepted too: {\"thought\", \"answer\"}.".into()
    }
}
