//! A loop: the run of its engine. `run {input}` starts a step task: render the prompt, call the
//! model, parse the reply, start its tool calls (detached), record what it waits on, end. The loop
//! is then `waiting` with no task; a call's completion wakes it (`run::wake`) and the next step
//! starts when the condition holds — until an answer or `max_steps`. The refocus workflow folds the
//! history when the context reaches `refocus` (0.9) of the budget.

use anyhow::{Result, anyhow, bail};
use serde_json::{Value, json};

use crate::engine::EngineNode;
use crate::node::{Node, badge, button, card, col, row, text, tone};
use crate::object::{Action, Kind, Obj, Phase, TaskFn, Twin, WakeFn};
use crate::run::{self, offered, render};

pub struct Loop;

fn steps(obj: &Obj) -> u64 {
    obj.state["step"].as_u64().unwrap_or(0)
}

fn context_meter(obj: &Obj) -> Node {
    let used = obj.state["context_used"].as_u64().unwrap_or(0);
    let budget = obj.state["context_budget"].as_u64().unwrap_or(0).max(1);
    let t = if used as f64 >= obj.num("refocus", run::DEFAULT_REFOCUS) * budget as f64 { "warn" } else { "neutral" };
    Node::new("Meter").p("label", "context (chars)").p("value", used).p("max", budget).p("tone", t)
}

fn refocus_line(obj: &Obj) -> Option<Node> {
    let r = &obj.state["refocus"];
    let l = &r["last"];
    (!l.is_null()).then(|| {
        text(format!(
            "refocused {}×: last {} → {} chars, {} message(s) folded, {} kept, {} lesson(s) ({})",
            r["count"],
            l["before"],
            l["after"],
            l["folded"],
            l["kept"],
            l["lessons"],
            l["mode"].as_str().unwrap_or("?")
        ))
        .p("size", "sm")
        .p("mono", true)
    })
}

/// A tool message's status: `ok | failed | cancelled | timed_out` (older messages: from `ok`).
pub fn status_of(m: &Value) -> &str {
    m["status"].as_str().unwrap_or(if m["ok"] == false { "failed" } else { "ok" })
}

fn status_tone(status: &str) -> &'static str {
    match status {
        "ok" => "neutral",
        "running" => "busy",
        "cancelled" | "timed_out" => "warn",
        _ => "error",
    }
}

/// `tool c2 web.fetch · ok`
fn tool_label(m: &Value, status: &str) -> String {
    let call = m["call"].as_str().map(|c| format!("{c} ")).unwrap_or_default();
    format!("tool {call}{} · {status}", m["tool"].as_str().unwrap_or(""))
}

/// The run's calls (while the loop runs), one badge each with its status — `c2 web.fetch · running
/// 3.2s`, `c1 clock.now · ok` — and the waiting line.
fn running_calls(obj: &Obj) -> Option<Node> {
    if !matches!(obj.phase, Phase::Running | Phase::Waiting) {
        return None;
    }
    let all = run::calls(obj);
    let wait = run::waiting_line(obj);
    if all.is_empty() && wait.is_none() {
        return None;
    }
    let now = run::now_ms();
    let n = all.iter().filter(|c| c["status"] == "running").count();
    let mut kids = vec![text(format!("{n} call(s) running")).p("size", "sm")];
    kids.extend(all.iter().map(|x| {
        let st = x["status"].as_str().unwrap_or("running");
        let line = run::running_line(x, now);
        let line = if st == "running" { line.replacen(" running ", " · running ", 1) } else { format!("{} {} · {st}", x["call"].as_str().unwrap_or("?"), x["tool"].as_str().unwrap_or("?")) };
        badge(line, status_tone(st))
    }));
    let calls = Node::new("Stack").p("dir", "row").p("gap", 2).p("wrap", true).kids(kids);
    Some(match wait {
        Some(w) => col(vec![calls, text(w).p("size", "sm").p("tone", "accent")]),
        None => calls,
    })
}

fn pending(obj: &Obj) -> Option<Node> {
    obj.state["pending_answer"]
        .as_str()
        .filter(|_| matches!(obj.phase, Phase::Running | Phase::Waiting))
        .map(|a| text(format!("answer pending (waiting for running calls): {a}")).p("size", "sm").p("tone", "neutral"))
}

fn answer(obj: &Obj) -> Option<Node> {
    obj.state["last_answer"].as_str().map(|a| text(a).p("md", true))
}

fn run_controls(obj: &Obj) -> Node {
    if matches!(obj.phase, Phase::Running | Phase::Waiting) {
        button("Cancel", "cancel")
    } else {
        Node::new("Field").p("label", "Input").p("name", "input").p("value", "").p("action", "run").p("kind", "text")
    }
}

impl Kind for Loop {
    /// The default avatar (an object may set `icon:` in its .md instead).
    fn avatar(&self) -> &'static str {
        "🔁"
    }
    fn kind(&self) -> &'static str {
        "loop"
    }
    fn about(&self) -> &'static str {
        "the engine's run: a step renders → calls the model → starts tool calls (detached) → ends waiting (await all|any|none|ids); a call's completion wakes the next step; config max_steps (8), refocus (0.9 of the context), keep (2), max_running (8)"
    }
    fn config(&self) -> &'static [(&'static str, &'static str)] {
        &[("max_steps", "number"), ("refocus", "number"), ("keep", "number"), ("max_running", "number")]
    }
    fn init(&self, _: &Obj) -> Value {
        json!({ "messages": [], "calls": {}, "waiting": null, "step": 0, "input": "", "context_used": 0, "context_budget": 0, "last_answer": null, "pending_answer": null })
    }
    fn actions(&self, obj: &Obj) -> Vec<Action> {
        if matches!(obj.phase, Phase::Running | Phase::Waiting) {
            vec![Action::new("cancel", "Cancel")]
        } else {
            vec![Action::new("run", "Run").arg("input", "text"), Action::new("clear", "Clear history")]
        }
    }
    fn act(&self, obj: &mut Obj, action: &str, args: &Value) -> Result<()> {
        let busy = matches!(obj.phase, Phase::Running | Phase::Waiting);
        match action {
            // owner input while the run goes on: recorded, and the loop wakes at once (calls keep running)
            "run" if busy => {
                let input = args["input"].as_str().map(str::trim).filter(|s| !s.is_empty()).ok_or_else(|| anyhow!("run needs input"))?.to_string();
                obj.state["messages"].as_array_mut().ok_or_else(|| anyhow!("no messages"))?.push(json!({ "role": "input", "text": input, "at": crate::now() }));
                obj.state["input"] = json!(input);
                obj.state["wake_now"] = json!(true);
            }
            "run" => {
                let input = args["input"].as_str().map(str::trim).filter(|s| !s.is_empty()).ok_or_else(|| anyhow!("run needs input"))?.to_string();
                obj.phase = Phase::Running;
                if !obj.state["messages"].is_array() {
                    obj.state["messages"] = json!([]);
                }
                obj.state["messages"].as_array_mut().expect("array").push(json!({ "role": "input", "text": input, "at": crate::now() }));
                obj.state["input"] = json!(input);
                obj.state["step"] = json!(0);
                obj.state["last_answer"] = Value::Null;
                obj.state["stop_reason"] = Value::Null;
                obj.state["calls"] = json!({});
                obj.state["waiting"] = Value::Null;
                if let Some(m) = obj.state.as_object_mut() {
                    m.remove("running"); // the older list form
                }
                obj.state["pending_answer"] = Value::Null;
                obj.state["wake_now"] = Value::Null;
                if let Some(m) = obj.state.as_object_mut() {
                    m.remove("error");
                }
            }
            "clear" if busy => bail!("{} is running", obj.id),
            "clear" => {
                let keep_refocus = obj.state["refocus"].clone();
                obj.state = self.init(obj);
                obj.state["refocus"] = keep_refocus;
            }
            "cancel" => bail!("{} is not running", obj.id),
            other => bail!("{} has no action {other}", obj.id),
        }
        Ok(())
    }
    fn task(&self, obj: &Obj, action: &str) -> Option<TaskFn> {
        let busy = matches!(obj.phase, Phase::Running | Phase::Waiting);
        (action == "run" && !busy).then_some(run::run_task as TaskFn)
    }
    fn wake(&self) -> Option<WakeFn> {
        Some(run::wake as WakeFn)
    }
    fn now(&self, obj: &Obj) -> Option<String> {
        let n = steps(obj);
        Some(match obj.phase {
            Phase::Waiting => format!("step {n} · {}", run::waiting_line(obj).unwrap_or_else(|| "waiting".into())),
            Phase::Running => match run::messages(obj).last().and_then(|m| m["role"].as_str().map(String::from)).as_deref() {
                Some("model") => format!("step {n} · starting calls"),
                _ => format!("step {} · calling model", n + 1),
            },
            Phase::Failed => format!("failed at step {n}"),
            _ if obj.state["last_answer"].is_string() => format!("answered in {n} step(s)"),
            _ => return None,
        })
    }
    fn small(&self, obj: &Obj) -> Node {
        let mut kids = vec![row(vec![text(format!("step {}", steps(obj))).p("size", "sm").p("mono", true), badge(format!("{} message(s)", run::messages(obj).len()), "neutral")]), context_meter(obj)];
        kids.extend(answer(obj).map(|a| a.p("size", "sm")));
        col(kids)
    }
    fn medium(&self, obj: &Obj) -> Node {
        self.full_in(obj, None)
    }
    fn large(&self, obj: &Obj) -> Node {
        self.conversation(obj, None)
    }
    fn focus(&self, obj: &Obj) -> Option<String> {
        Some(if matches!(obj.phase, Phase::Running | Phase::Waiting) {
            format!("working on: {}", obj.state["input"].as_str().unwrap_or(""))
        } else if let Some(a) = obj.state["last_answer"].as_str() {
            a.to_string()
        } else {
            "ready".into()
        })
    }
    fn activity(&self, before: &Obj, after: &Obj) -> Vec<(String, String, bool)> {
        let (b, a) = (run::messages(before), run::messages(after));
        let mut out = vec![];
        if before.state["refocus"]["count"] != after.state["refocus"]["count"] && !after.state["refocus"]["last"].is_null() {
            let l = &after.state["refocus"]["last"];
            out.push(("refocus".to_string(), format!("refocused {} → {} chars", l["before"], l["after"]), true));
        }
        if a.len() > b.len() {
            for m in &a[b.len()..] {
                let t = m["text"].as_str().unwrap_or("");
                out.push(match m["role"].as_str().unwrap_or("?") {
                    "model" => ("model".to_string(), format!("model replied ({} chars)", t.chars().count()), true),
                    "tool" => {
                        let st = status_of(m);
                        ("tool".to_string(), format!("tool {} {st}", m["tool"].as_str().unwrap_or("?")), st == "ok")
                    }
                    "format" => ("format".to_string(), "reply did not parse".to_string(), false),
                    "reply" => ("reply".to_string(), format!("reply from {}: {t}", m["by"].as_str().unwrap_or("owner")), true),
                    "phase" => ("phase".to_string(), format!("phase → {}", m["phase"].as_str().unwrap_or("?")), true),
                    "refocus" => continue,
                    "input" => ("input".to_string(), format!("input: {t}"), true),
                    r => (r.to_string(), t.to_string(), true),
                });
            }
        }
        if before.state["last_answer"] != after.state["last_answer"]
            && let Some(x) = after.state["last_answer"].as_str()
        {
            out.push(("answer".to_string(), format!("answer: {x}"), true));
        }
        out.extend(crate::object::phase_activity(before, after));
        out
    }
    fn prompt(&self, obj: &Obj) -> String {
        let a = obj.state["last_answer"].as_str().map(|a| format!(", last answer: {}", a.lines().next().unwrap_or(""))).unwrap_or_default();
        format!("loop \"{}\" ({}): {}, step {}, {} message(s){a}", obj.title, obj.id, json!(obj.phase).as_str().unwrap_or("?"), steps(obj), run::messages(obj).len())
    }
    fn twin_in(&self, obj: &Obj, eng: Option<&EngineNode>) -> Twin {
        let mut t = self.twin(obj);
        t.views.medium = self.full_in(obj, eng);
        t.views.large = self.conversation(obj, eng);
        t
    }
}

impl Loop {
    fn facts(&self, obj: &Obj, eng: Option<&EngineNode>) -> Node {
        let mut b = vec![badge(json!(obj.phase), tone(obj.phase)), badge(format!("step {}", steps(obj)), "neutral")];
        if let Some(e) = eng {
            b.extend(e.model_badges());
            let tools = offered(e);
            b.push(if tools.is_empty() { badge("No tools", "neutral") } else { badge(format!("tools: {}", tools.join(", ")), "neutral") });
        }
        Node::new("Stack").p("dir", "row").p("gap", 2).p("wrap", true).kids(b)
    }

    fn card_in(&self, obj: &Obj, eng: Option<&EngineNode>) -> Node {
        let mut kids = vec![self.facts(obj, eng), context_meter(obj)];
        kids.extend(refocus_line(obj));
        if let Some(e) = obj.state["error"].as_str() {
            kids.push(text(e).p("tone", "error").p("size", "sm").p("mono", true));
        }
        if let Some(r) = obj.state["stop_reason"].as_str() {
            kids.push(text(r).p("tone", "warn").p("size", "sm"));
        }
        kids.extend(running_calls(obj));
        kids.extend(pending(obj));
        kids.extend(answer(obj));
        kids.push(run_controls(obj));
        card(&obj.title, obj.phase, vec![col(kids)])
    }

    /// The large scene: the conversation as a stream, the live step and context, a composer.
    fn conversation(&self, obj: &Obj, eng: Option<&EngineNode>) -> Node {
        let mut kids = vec![self.facts(obj, eng)];
        let msgs = run::messages(obj);
        if msgs.is_empty() {
            kids.push(text("No messages yet — ask below").p("size", "sm").p("tone", "neutral"));
        }
        for m in msgs.iter().rev().take(40).collect::<Vec<_>>().into_iter().rev() {
            let role = m["role"].as_str().unwrap_or("?");
            let (label, t) = match role {
                "tool" => (tool_label(m, status_of(m)), status_tone(status_of(m))),
                "input" => ("you".to_string(), "accent"),
                "model" => ("model".to_string(), "busy"),
                "reply" => ("reply".to_string(), "accent"),
                r => (r.to_string(), "neutral"),
            };
            let body: String = m["text"].as_str().map(String::from).or_else(|| m["phase"].as_str().map(|p| format!("phase → {p}"))).unwrap_or_default().chars().take(1200).collect();
            kids.push(Node::new("Stack").p("dir", "col").p("gap", 1).kids(vec![badge(label, t), text(body).p("size", "sm").p("md", true)]));
        }
        kids.extend(running_calls(obj));
        kids.extend(pending(obj));
        kids.push(Node::new("Divider"));
        kids.push(context_meter(obj));
        kids.extend(refocus_line(obj));
        if let Some(e) = obj.state["error"].as_str() {
            kids.push(text(e).p("tone", "error").p("size", "sm").p("mono", true));
        }
        kids.push(run_controls(obj));
        card(&obj.title, obj.phase, vec![col(kids)]).p("scene", "conversation")
    }

    /// The full view: the card, the history, and exactly the prompt the next step sends.
    fn full_in(&self, obj: &Obj, eng: Option<&EngineNode>) -> Node {
        let mut c = self.card_in(obj, eng);
        let rows: Vec<Value> = run::messages(obj)
            .iter()
            .map(|m| {
                let who = match m["role"].as_str().unwrap_or("?") {
                    "tool" => tool_label(m, status_of(m)),
                    r => r.to_string(),
                };
                json!([who, m["text"].as_str().unwrap_or("").chars().take(400).collect::<String>()])
            })
            .collect();
        c.children.push(Node::new("Divider"));
        c.children.push(text("History").p("size", "lg"));
        c.children.push(if rows.is_empty() { text("No messages yet").p("size", "sm") } else { Node::new("Table").p("columns", json!(["from", "text"])).p("rows", rows) });
        if let Some(e) = eng {
            c.children.push(text("Next prompt (exactly what the next step sends)").p("size", "lg"));
            c.children.push(Node::new("Code").p("value", render(e, obj)));
        }
        if let Some(s) = obj.state["last_sent"].as_str() {
            c.children.push(text("Last prompt sent").p("size", "lg"));
            c.children.push(Node::new("Code").p("value", s));
        }
        c
    }
}
