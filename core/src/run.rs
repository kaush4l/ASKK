//! The run of a `loop` element: render → model call → parse → tools in parallel → repeat, with
//! the refocus workflow when the context reaches its threshold. `render` and `offered` are pure
//! functions of the engine as it is; the loop's full view shows exactly what `render` sends.

use anyhow::{Result, anyhow, bail};
use serde_json::{Value, json};
use std::{sync::Arc, time::Instant};

use crate::connector::{Connector, ModelCall, ModelSpec, Purpose};
use crate::engine::{EngineNode, element_twin};
use crate::object::{Obj, Phase};
use crate::tools::{self, ToolCtx};
use crate::{Hub, TaskCtx, TaskFuture, toon};

pub const DEFAULT_MAX_STEPS: u64 = 8;
pub const DEFAULT_REFOCUS: f64 = 0.9;
pub const DEFAULT_KEEP: usize = 2;
/// How much of one message the prompt shows.
pub const MESSAGE_CLIP: usize = 2_000;

/// The first loadable element of a kind in an engine.
pub fn first<'a>(eng: &'a EngineNode, kind: &str) -> Option<&'a Obj> {
    eng.elements.iter().find(|e| e.kind == kind && e.error.is_none())
}

/// A list config value: a list, or its comma-separated text.
pub fn list_of(v: Option<&Value>) -> Vec<Value> {
    match v {
        Some(Value::Array(a)) => a.clone(),
        Some(Value::String(s)) => s.split(',').map(str::trim).filter(|s| !s.is_empty()).map(|s| json!(s)).collect(),
        _ => vec![],
    }
}

fn strings(v: Option<&Value>) -> Vec<String> {
    list_of(v).iter().filter_map(|x| x.as_str().map(String::from)).collect()
}

/// The tools a tools element lists that the registry knows, in its order.
pub fn listed(eng: &EngineNode) -> Vec<String> {
    match first(eng, "tools") {
        None => vec![],
        Some(t) => strings(t.config.get("list")).into_iter().filter(|n| tools::find(n).is_some()).collect(),
    }
}

/// One phase of a phases element: `{id, title?, icon?, tools?, instructions?}` (a bare name is `{id}`; an older
/// `exit:` text is still read and shown). The phase the owner selects and stays in is the engine's mode; a
/// workflow (the `workflows` kind) runs phases in a fixed order.
#[derive(Debug, Clone, PartialEq)]
pub struct PhaseDef {
    pub id: String,
    pub title: Option<String>,
    pub icon: Option<String>,
    pub tools: Option<Vec<String>>,
    pub instructions: Option<String>,
    pub exit: Option<String>,
}

impl PhaseDef {
    pub fn title(&self) -> String {
        self.title.clone().unwrap_or_else(|| self.id.clone())
    }
    /// `💬 Chat` (icon and title), else the title.
    pub fn label(&self) -> String {
        match &self.icon {
            Some(i) => format!("{i} {}", self.title()),
            None => self.title(),
        }
    }
}

pub fn phase_defs(obj: &Obj) -> Vec<PhaseDef> {
    list_of(obj.config.get("list"))
        .iter()
        .filter_map(|p| match p {
            Value::String(s) => Some(PhaseDef { id: s.clone(), title: None, icon: None, tools: None, instructions: None, exit: None }),
            Value::Object(m) => {
                let text = |k: &str| m.get(k).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(String::from);
                Some(PhaseDef {
                    id: m.get("id")?.as_str()?.to_string(),
                    title: text("title"),
                    icon: text("icon"),
                    tools: m.get("tools").map(|t| strings(Some(t))),
                    instructions: text("instructions"),
                    exit: text("exit"),
                })
            }
            _ => None,
        })
        .collect()
}

/// The current phase: `state.current` when it names one, else the first.
pub fn current_phase(obj: &Obj) -> Option<PhaseDef> {
    let defs = phase_defs(obj);
    let cur = obj.state["current"].as_str();
    defs.iter().find(|d| Some(d.id.as_str()) == cur).cloned().or_else(|| defs.first().cloned())
}

/// The tools offered now: the tools element's list narrowed by the current phase's `tools`. An engine with no tools
/// element offers the current phase's `tools` itself (registry tools only), so phases alone can be its modes.
pub fn offered(eng: &EngineNode) -> Vec<String> {
    let phase = first(eng, "phases").and_then(current_phase).and_then(|p| p.tools);
    match (first(eng, "tools"), phase) {
        (Some(_), Some(only)) => listed(eng).into_iter().filter(|t| only.contains(t)).collect(),
        (Some(_), None) => listed(eng),
        (None, Some(only)) => only.into_iter().filter(|t| tools::find(t).is_some()).collect(),
        (None, None) => vec![],
    }
}

fn clip(s: &str, n: usize) -> String {
    if s.chars().count() <= n { s.to_string() } else { format!("{}…", s.chars().take(n).collect::<String>()) }
}

pub fn messages(lp: &Obj) -> Vec<Value> {
    lp.state["messages"].as_array().cloned().unwrap_or_default()
}

fn message_line(m: &Value) -> String {
    let role = m["role"].as_str().unwrap_or("?");
    let text = m["text"].as_str().unwrap_or("");
    match role {
        "tool" => format!("[tool {}{}] {}", m["tool"].as_str().unwrap_or("?"), if m["ok"] == false { " failed" } else { "" }, clip(text, MESSAGE_CLIP)),
        "reply" => format!("[reply to {} from {}] {}", m["ask"].as_str().unwrap_or("?"), m["by"].as_str().unwrap_or("owner"), clip(text, MESSAGE_CLIP)),
        _ => format!("[{role}] {}", clip(text, MESSAGE_CLIP)),
    }
}

/// Tool results since the newest input.
pub fn results_since_input(msgs: &[Value]) -> usize {
    let start = msgs.iter().rposition(|m| m["role"] == "input").map(|i| i + 1).unwrap_or(0);
    msgs[start..].iter().filter(|m| m["role"] == "tool").count()
}

/// Exactly what the next model call sends (pure: the engine and the loop as they are now).
/// Sections: ENGINE (title, description, body), PHASE, TOOLS, MEMORY, NOTES, HISTORY,
/// INPUT, REPLY FORMAT. An engine with no tools says "No tools." and its format has no calls.
pub fn render(eng: &EngineNode, lp: &Obj) -> String {
    let o = &eng.obj;
    let mut p = format!("# ENGINE {} ({})\n", o.title, o.id);
    for t in [&o.description, &o.body].into_iter().filter(|t| !t.is_empty()) {
        p.push_str(&format!("{t}\n"));
    }
    if let Some(ph) = first(eng, "phases").and_then(current_phase) {
        p.push_str(&format!("\n# PHASE {}\n", ph.id));
        if let Some(i) = &ph.instructions {
            p.push_str(&format!("{i}\n"));
        }
        if let Some(x) = &ph.exit {
            p.push_str(&format!("exit when: {x}\n"));
        }
    }
    let offer = offered(eng);
    p.push_str("\n# TOOLS\n");
    if offer.is_empty() {
        p.push_str("No tools.\n");
    } else {
        for t in &offer {
            let d = tools::find(t).expect("listed tools are known");
            p.push_str(&format!("- {} {}: {}\n", d.name, d.args, d.about));
        }
    }
    if let Some(m) = first(eng, "memory") {
        let lessons = m.state["lessons"].as_array().cloned().unwrap_or_default();
        if !lessons.is_empty() {
            p.push_str("\n# MEMORY\n");
            for l in lessons {
                p.push_str(&format!("- {}\n", l.as_str().unwrap_or("")));
            }
        }
    }
    let notes: Vec<String> = eng.elements.iter().filter(|e| e.kind == "note" && e.error.is_none()).map(|e| element_twin(e, None).prompt).collect();
    if !notes.is_empty() {
        p.push_str("\n# NOTES\n");
        for n in notes {
            p.push_str(&format!("{n}\n"));
        }
    }
    let msgs = messages(lp);
    let newest_input = msgs.iter().rposition(|m| m["role"] == "input");
    let history: Vec<String> = msgs.iter().enumerate().filter(|(i, _)| Some(*i) != newest_input).map(|(_, m)| message_line(m)).collect();
    if !history.is_empty() {
        p.push_str("\n# HISTORY\n");
        for h in history {
            p.push_str(&format!("{h}\n"));
        }
    }
    p.push_str(&format!("\n# INPUT\n{}\n", lp.state["input"].as_str().unwrap_or("")));
    p.push_str(&format!("\n# REPLY FORMAT\n{}\n", toon::format_help(!offer.is_empty())));
    p
}

// ── refocus ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct Refocused {
    pub essentials: String,
    pub lessons: Vec<String>,
}

/// The refocus reply format (TOON):
/// `goal:`, `decisions:`, `facts:`, `open:` lines, then `lessons[N]:` and N rows `  - <lesson>`.
pub fn parse_refocus(text: &str) -> Option<Refocused> {
    let mut fields: Vec<(String, String)> = vec![];
    let mut lessons = vec![];
    let mut in_lessons = false;
    for line in text.lines() {
        let t = line.trim();
        if in_lessons && let Some(l) = t.strip_prefix("- ") {
            lessons.push(l.trim().to_string());
            continue;
        }
        in_lessons = false;
        if t.starts_with("lessons[") {
            in_lessons = true;
            continue;
        }
        for k in ["goal", "decisions", "facts", "open"] {
            if let Some(v) = t.strip_prefix(&format!("{k}:")) {
                fields.push((k.into(), v.trim().into()));
            }
        }
    }
    if !fields.iter().any(|(k, v)| k == "goal" && !v.is_empty()) {
        return None;
    }
    let essentials = fields.iter().map(|(k, v)| format!("{k}: {v}")).collect::<Vec<_>>().join("\n");
    Some(Refocused { essentials, lessons })
}

/// The deterministic essentials of a history (the echo model's refocus, and the fallback when a
/// model's refocus reply does not parse).
pub fn fallback_refocus(msgs: &[Value]) -> String {
    let text = |m: &Value| m["text"].as_str().unwrap_or("").to_string();
    let inputs: Vec<String> = msgs.iter().filter(|m| m["role"] == "input").map(text).collect();
    let goal = inputs.last().cloned().or_else(|| msgs.iter().find(|m| m["role"] == "refocus").map(text)).unwrap_or_else(|| "(none stated)".into());
    let decisions: Vec<String> = msgs
        .iter()
        .filter(|m| m["role"] == "model")
        .filter_map(|m| m["text"].as_str()?.lines().find_map(|l| l.trim().strip_prefix("thought:").map(|t| t.trim().to_string())))
        .collect();
    let tools_used: Vec<&Value> = msgs.iter().filter(|m| m["role"] == "tool").collect();
    let facts: Vec<String> = tools_used.iter().rev().take(5).rev().map(|m| format!("{} → {}", m["tool"].as_str().unwrap_or("?"), clip(&text(m), 80))).collect();
    let failed: Vec<String> = tools_used.iter().filter(|m| m["ok"] == false).map(|m| format!("{} failed: {}", m["tool"].as_str().unwrap_or("?"), clip(&text(m), 80))).collect();
    let mut names: Vec<String> = tools_used.iter().filter_map(|m| m["tool"].as_str().map(String::from)).collect();
    names.dedup();
    let mut lessons = vec![format!("refocus after {} message(s): goal \"{}\"", msgs.len(), clip(&goal, 60))];
    if !names.is_empty() {
        lessons.push(format!("tools that served it: {}", names.join(", ")));
    }
    lessons.extend(failed);
    let mut out = format!(
        "goal: {}\ndecisions: {}\nfacts: {}\nopen: answer the goal\nlessons[{}]:\n",
        clip(&goal.replace('\n', " "), 200),
        if decisions.is_empty() { "none".into() } else { clip(&decisions.join("; "), 200) },
        if facts.is_empty() { "none".into() } else { facts.join("; ") },
        lessons.len()
    );
    for l in lessons {
        out.push_str(&format!("  - {l}\n"));
    }
    out
}

fn refocus_prompt(eng: &EngineNode, msgs: &[Value], used: usize, budget: usize) -> String {
    let mut p = format!(
        "# REFOCUS {} ({})\nThe context is at {used} of {budget} characters. Extract the essentials of the work below and what was learnt.\n\n# HISTORY\n",
        eng.obj.title, eng.obj.id
    );
    for m in msgs {
        p.push_str(&format!("{}\n", message_line(m)));
    }
    p.push_str("\n# REPLY FORMAT\ngoal: <the goal, one line>\ndecisions: <decisions made>\nfacts: <facts found>\nopen: <what is still open>\nlessons[N]:\n  - <a lesson worth keeping beyond this run>\n");
    p
}

// ── the task ───────────────────────────────────────────────────────────────

fn engine_of(loop_id: &str) -> String {
    loop_id.rsplit_once('/').map(|(e, _)| e.to_string()).unwrap_or_default()
}

fn snapshot(hub: &Hub, engine: &str, loop_id: &str) -> Result<(EngineNode, Obj)> {
    hub.read(|rt| {
        let e = rt.engine_node(engine)?.clone();
        let l = e.elements.iter().find(|x| x.id == loop_id)?.clone();
        Some((e, l))
    })?
    .ok_or_else(|| anyhow!("{loop_id} is gone"))
}

fn push(o: &mut Obj, m: Value) {
    if !o.state["messages"].is_array() {
        o.state["messages"] = json!([]);
    }
    o.state["messages"].as_array_mut().expect("array").push(m);
}

/// One model call, recorded on the model element (calls, last call stats). Never the key.
async fn call_model(hub: &Hub, model_id: &str, conn: Arc<dyn Connector>, spec: ModelSpec, call: ModelCall) -> Result<String> {
    let sent = call.prompt.len();
    let t0 = Instant::now();
    let got = conn.call(spec, call).await;
    let ms = t0.elapsed().as_millis() as u64;
    let rec = match &got {
        Ok(r) => json!({ "ok": true, "ms": ms, "prompt_chars": sent, "reply_chars": r.len(), "at": crate::now() }),
        Err(e) => json!({ "ok": false, "ms": ms, "prompt_chars": sent, "error": format!("{e:#}"), "at": crate::now() }),
    };
    hub.update(model_id, |o| {
        o.state["calls"] = json!(o.state["calls"].as_u64().unwrap_or(0) + 1);
        o.state["last"] = rec;
        Ok(())
    })
    .await?;
    got
}

pub fn connector_for(hub: &Hub, eng: &EngineNode) -> Result<(String, ModelSpec, Arc<dyn Connector>)> {
    let model = first(eng, "model").ok_or_else(|| anyhow!("{} has no model element", eng.obj.id))?;
    let spec = ModelSpec::from_config(&model.config);
    let conn = hub.connector(&spec.connector).ok_or_else(|| anyhow!("no connector {} (known: {})", spec.connector, hub.connector_names().join(", ")))?;
    Ok((model.id.clone(), spec, conn))
}

/// The refocus workflow: essentials + lessons from the model (or the deterministic fallback),
/// lessons into the memory element, older history replaced by the essentials, the newest `keep`
/// messages kept. Records `state.refocus = {count, last: {before, after, folded, kept, at, mode}}`.
async fn refocus(ctx: &TaskCtx, used: usize) -> Result<()> {
    let hub = ctx.hub();
    let (eng, lp) = snapshot(hub, &engine_of(ctx.id()), ctx.id())?;
    let msgs = messages(&lp);
    let keep = lp.num("keep", DEFAULT_KEEP as f64).max(0.0) as usize;
    if msgs.len() <= keep {
        return Ok(()); // nothing older to fold
    }
    let (model_id, spec, conn) = connector_for(hub, &eng)?;
    let call = ModelCall {
        purpose: Purpose::Refocus,
        prompt: refocus_prompt(&eng, &msgs, used, spec.context),
        input: lp.state["input"].as_str().unwrap_or("").into(),
        tools: vec![],
        results: 0,
        messages: msgs.clone(),
    };
    let (r, mode) = match call_model(hub, &model_id, conn, spec, call).await.ok().and_then(|t| parse_refocus(&t)) {
        Some(r) => (r, "model"),
        None => (parse_refocus(&fallback_refocus(&msgs)).expect("fallback parses"), "fallback"),
    };
    let folded = msgs.len() - keep;
    let kept: Vec<Value> = msgs[folded..].to_vec();
    // the newest input stays the run's input even when it was folded
    ctx.update(|o| {
        let mut next = vec![json!({ "role": "refocus", "text": r.essentials, "at": crate::now() })];
        next.extend(kept);
        o.state["messages"] = json!(next);
        Ok(())
    })
    .await?;
    if let Some(mem) = first(&eng, "memory").map(|m| m.id.clone()) {
        let lessons = r.lessons.clone();
        hub.update(&mem, |o| {
            if !o.state["lessons"].is_array() {
                o.state["lessons"] = json!([]);
            }
            let list = o.state["lessons"].as_array_mut().expect("array");
            for l in lessons {
                if !list.iter().any(|x| x == &json!(l)) {
                    list.push(json!(l));
                }
            }
            let n = list.len();
            if n > 50 {
                list.drain(..n - 50);
            }
            Ok(())
        })
        .await?;
    }
    let (eng2, lp2) = snapshot(hub, &engine_of(ctx.id()), ctx.id())?;
    let after = render(&eng2, &lp2).len();
    ctx.update(|o| {
        let count = o.state["refocus"]["count"].as_u64().unwrap_or(0) + 1;
        o.state["refocus"] = json!({
            "count": count,
            "last": { "before": used, "after": after, "folded": folded, "kept": keep, "lessons": r.lessons.len(), "mode": mode, "at": crate::now() }
        });
        Ok(())
    })
    .await
}

/// Run the calls of one reply at once; results in call order.
pub async fn run_calls(tc: ToolCtx, offered: &[String], calls: Vec<toon::Call>) -> Vec<Value> {
    let mut set = tokio::task::JoinSet::new();
    for (i, c) in calls.into_iter().enumerate() {
        let tc = tc.clone();
        let allowed = offered.contains(&c.tool);
        set.spawn(async move {
            let out = match (allowed, tools::find(&c.tool)) {
                (true, Some(t)) => (t.run)(tc, c.args.clone()).await,
                _ => Err(anyhow!("{} is not offered on this step", c.tool)),
            };
            (i, c, out)
        });
    }
    let mut got = vec![];
    while let Some(r) = set.join_next().await {
        match r {
            Ok(x) => got.push(x),
            Err(e) => got.push((usize::MAX, toon::Call::default(), Err(anyhow!("tool task failed: {e}")))),
        }
    }
    got.sort_by_key(|(i, _, _)| *i);
    got.into_iter()
        .map(|(_, c, out)| match out {
            Ok(v) => json!({ "role": "tool", "tool": c.tool, "args": c.args, "ok": true, "text": v.to_string(), "at": crate::now() }),
            Err(e) => json!({ "role": "tool", "tool": c.tool, "args": c.args, "ok": false, "text": format!("{e:#}"), "at": crate::now() }),
        })
        .collect()
}

pub fn run_task(ctx: TaskCtx) -> TaskFuture {
    Box::pin(async move {
        let engine = engine_of(ctx.id());
        loop {
            let hub = ctx.hub().clone();
            let (eng, lp) = snapshot(&hub, &engine, ctx.id())?;
            let max = lp.num("max_steps", DEFAULT_MAX_STEPS as f64).max(1.0) as u64;
            if lp.state["step"].as_u64().unwrap_or(0) >= max {
                return ctx
                    .update(|o| {
                        o.state["stop_reason"] = json!(format!("max_steps ({max}) reached without an answer"));
                        Ok(())
                    })
                    .await;
            }
            let (model_id, spec, conn) = connector_for(&hub, &eng)?;
            let budget = spec.context;
            let threshold = lp.num("refocus", DEFAULT_REFOCUS).clamp(0.05, 1.0);
            let mut prompt = render(&eng, &lp);
            if prompt.len() as f64 >= threshold * budget as f64 {
                refocus(&ctx, prompt.len()).await?;
            }
            let (eng, lp) = snapshot(&hub, &engine, ctx.id())?;
            prompt = render(&eng, &lp);
            let offer = offered(&eng);
            let msgs = messages(&lp);
            let used = prompt.len();
            let sent = prompt.clone();
            ctx.update(|o| {
                o.phase = Phase::Waiting;
                o.state["context_used"] = json!(used);
                o.state["context_budget"] = json!(budget);
                o.state["last_sent"] = json!(sent);
                Ok(())
            })
            .await?;
            let call = ModelCall {
                purpose: Purpose::Step,
                prompt,
                input: lp.state["input"].as_str().unwrap_or("").into(),
                tools: offer.clone(),
                results: results_since_input(&msgs),
                messages: msgs,
            };
            let reply = call_model(&hub, &model_id, conn, spec, call).await?;
            let parsed = toon::parse(&reply);
            ctx.update(|o| {
                o.phase = Phase::Running;
                o.state["step"] = json!(o.state["step"].as_u64().unwrap_or(0) + 1);
                push(o, json!({ "role": "model", "text": reply, "at": crate::now() }));
                Ok(())
            })
            .await?;
            match parsed {
                Err(e) => {
                    let why = format!("{e:#}");
                    ctx.update(|o| {
                        push(o, json!({ "role": "format", "text": why, "at": crate::now() }));
                        Ok(())
                    })
                    .await?;
                }
                Ok(r) if !r.calls.is_empty() && !offer.is_empty() => {
                    let tc = ToolCtx { hub: hub.clone(), engine: engine.clone(), loop_id: ctx.id().to_string() };
                    let results = run_calls(tc, &offer, r.calls).await;
                    ctx.update(|o| {
                        for m in results {
                            push(o, m);
                        }
                        Ok(())
                    })
                    .await?;
                }
                Ok(r) => match r.answer {
                    Some(a) => {
                        ctx.update(|o| {
                            o.state["last_answer"] = json!(a);
                            Ok(())
                        })
                        .await?;
                        return Ok(());
                    }
                    None => {
                        ctx.update(|o| {
                            push(o, json!({ "role": "format", "text": "no tools are offered: answer instead", "at": crate::now() }));
                            Ok(())
                        })
                        .await?;
                    }
                },
            }
        }
    })
}

/// The model's `test` action: one short call, recorded on the model.
pub fn test_task(ctx: TaskCtx) -> TaskFuture {
    Box::pin(async move {
        let hub = ctx.hub().clone();
        let o = ctx.obj()?;
        let spec = ModelSpec::from_config(&o.config);
        let conn = hub.connector(&spec.connector).ok_or_else(|| anyhow!("no connector {}", spec.connector))?;
        let call = ModelCall { purpose: Purpose::Test, prompt: "Reply exactly: answer: pong".into(), input: String::new(), tools: vec![], results: 0, messages: vec![] };
        let reply = call_model(&hub, ctx.id(), conn, spec, call).await?;
        if reply.trim().is_empty() {
            bail!("the model replied with nothing");
        }
        ctx.update(|o| {
            o.state["test"] = json!({ "ok": true, "reply": clip(reply.trim(), 200), "at": crate::now() });
            Ok(())
        })
        .await
    })
}
