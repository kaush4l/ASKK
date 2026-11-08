//! The run of a `loop` element: render → model call → parse → start the calls → wait as the reply's
//! `await` says → repeat, with the refocus workflow when the context reaches its threshold. The
//! engine never waits on tools (docs/tools.md): a step is a task that ends after starting its calls
//! and recording `state.waiting`; each call is a detached hub task whose completion calls `Hub::wake`,
//! and the wake starts the next step when the condition holds. Running calls show in RUNNING.
//! `render` and `offered` are pure functions of the engine as it is; the loop's full view shows
//! exactly what `render` sends.

use anyhow::{Result, anyhow, bail};
use serde_json::{Value, json};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use crate::connector::{Connector, ModelCall, ModelSpec, Purpose};
use crate::engine::{EngineNode, element_twin};
use crate::object::{Obj, Phase};
use crate::tools::{self, ToolCtx};
use crate::toon::Await;
use crate::{Hub, TaskCtx, TaskFuture, toon};

pub const DEFAULT_MAX_STEPS: u64 = 8;
pub const DEFAULT_REFOCUS: f64 = 0.9;
pub const DEFAULT_KEEP: usize = 2;
/// How much of one message the prompt shows.
pub const MESSAGE_CLIP: usize = 2_000;
/// The most calls one loop run keeps running at once (config `max_running`).
pub const DEFAULT_MAX_RUNNING: usize = 8;

/// The prompt's sections, in order: the one place the template is defined.
pub const SECTIONS: [&str; 9] = ["ENGINE", "PHASE", "TOOLS", "RUNNING", "MEMORY", "NOTES", "HISTORY", "INPUT", "REPLY FORMAT"];

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// A registry tool a model may call.
fn callable(name: &str) -> bool {
    tools::find(name).is_some_and(|t| t.spec().for_model())
}

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
        Some(t) => strings(t.config.get("list")).into_iter().filter(|n| callable(n)).collect(),
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
        (None, Some(only)) => only.into_iter().filter(|t| callable(t)).collect(),
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
        "tool" => {
            let status = m["status"].as_str().unwrap_or(if m["ok"] == false { "failed" } else { "ok" });
            let call = m["call"].as_str().map(|c| format!("{c} ")).unwrap_or_default();
            let tag = match (m["late"] == true, m["phase"].as_str()) {
                (true, _) => " late".to_string(),
                (_, Some(p)) => format!(" (started in phase {p})"),
                _ => String::new(),
            };
            format!("[tool {call}{} {status}{tag}] {}", m["tool"].as_str().unwrap_or("?"), clip(text, MESSAGE_CLIP))
        }
        "reply" => {
            format!("[reply to {} from {}] {}", m["ask"].as_str().unwrap_or("?"), m["by"].as_str().unwrap_or("owner"), clip(text, MESSAGE_CLIP))
        }
        _ => format!("[{role}] {}", clip(text, MESSAGE_CLIP)),
    }
}

/// Tool results since the newest input.
pub fn results_since_input(msgs: &[Value]) -> usize {
    let start = msgs.iter().rposition(|m| m["role"] == "input").map(|i| i + 1).unwrap_or(0);
    msgs[start..].iter().filter(|m| m["role"] == "tool").count()
}

/// One RUNNING line: `c2 web.fetch running 3.2s` (an ended call: `c2 web.fetch ok`).
pub fn running_line(r: &Value, now: u64) -> String {
    let (call, tool) = (r["call"].as_str().unwrap_or("?"), r["tool"].as_str().unwrap_or("?"));
    match r["status"].as_str() {
        Some(st) if st != "running" => format!("{call} {tool} {st}"),
        _ => {
            let secs = now.saturating_sub(r["since_ms"].as_u64().unwrap_or(now)) as f64 / 1000.0;
            format!("{call} {tool} running {secs:.1}s")
        }
    }
}

/// One section's header line and body, or `None` when it is left out.
fn section(name: &str, eng: &EngineNode, lp: &Obj, offer: &[String]) -> Option<(String, String)> {
    let o = &eng.obj;
    let lines = |v: Vec<String>| v.into_iter().map(|l| format!("{l}\n")).collect::<String>();
    match name {
        "ENGINE" => Some((format!("ENGINE {} ({})", o.title, o.id), lines([&o.description, &o.body].into_iter().filter(|t| !t.is_empty()).cloned().collect()))),
        "PHASE" => first(eng, "phases").and_then(current_phase).map(|ph| {
            let mut b = vec![];
            b.extend(ph.instructions.clone());
            b.extend(ph.exit.as_ref().map(|x| format!("exit when: {x}")));
            (format!("PHASE {}", ph.id), lines(b))
        }),
        "TOOLS" => Some(("TOOLS".into(), if offer.is_empty() { "No tools.\n".into() } else { lines(offer.iter().filter_map(|t| tools::find(t)).map(|t| t.spec().prompt_line()).collect()) })),
        "RUNNING" => {
            let r = running(lp);
            let now = now_ms();
            (!r.is_empty()).then(|| ("RUNNING".into(), lines(r.iter().map(|x| running_line(x, now)).collect())))
        }
        "MEMORY" => {
            let lessons = first(eng, "memory").map(|m| m.state["lessons"].as_array().cloned().unwrap_or_default()).unwrap_or_default();
            (!lessons.is_empty()).then(|| ("MEMORY".into(), lines(lessons.iter().map(|l| format!("- {}", l.as_str().unwrap_or(""))).collect())))
        }
        "NOTES" => {
            let notes: Vec<String> = eng.elements.iter().filter(|e| e.kind == "note" && e.error.is_none()).map(|e| element_twin(e, None).prompt).collect();
            (!notes.is_empty()).then(|| ("NOTES".into(), lines(notes)))
        }
        "HISTORY" => {
            let msgs = messages(lp);
            let newest_input = msgs.iter().rposition(|m| m["role"] == "input");
            let h: Vec<String> = msgs.iter().enumerate().filter(|(i, _)| Some(*i) != newest_input).map(|(_, m)| message_line(m)).collect();
            (!h.is_empty()).then(|| ("HISTORY".into(), lines(h)))
        }
        "INPUT" => Some(("INPUT".into(), format!("{}\n", lp.state["input"].as_str().unwrap_or("")))),
        "REPLY FORMAT" => Some(("REPLY FORMAT".into(), format!("{}\n", toon::format_help(!offer.is_empty())))),
        _ => None,
    }
}

/// Exactly what the next model call sends (pure: the engine and the loop as they are now, plus
/// the elapsed time of running calls). Sections in `SECTIONS` order; an engine with no tools says
/// "No tools." and its format has no calls.
pub fn render(eng: &EngineNode, lp: &Obj) -> String {
    let offer = offered(eng);
    let mut p = String::new();
    for name in SECTIONS {
        if let Some((head, body)) = section(name, eng, lp, &offer) {
            if !p.is_empty() {
                p.push('\n');
            }
            p.push_str(&format!("# {head}\n{body}"));
        }
    }
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
    let decisions: Vec<String> =
        msgs.iter().filter(|m| m["role"] == "model").filter_map(|m| m["text"].as_str()?.lines().find_map(|l| l.trim().strip_prefix("thought:").map(|t| t.trim().to_string()))).collect();
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
    let mut p = format!("# REFOCUS {} ({})\nThe context is at {used} of {budget} characters. Extract the essentials of the work below and what was learnt.\n\n# HISTORY\n", eng.obj.title, eng.obj.id);
    for m in msgs {
        p.push_str(&format!("{}\n", message_line(m)));
    }
    p.push_str(
        "\n# REPLY FORMAT\ngoal: <the goal, one line>\ndecisions: <decisions made>\nfacts: <facts found>\nopen: <what is still open>\nlessons[N]:\n  - <a lesson worth keeping beyond this run>\n",
    );
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

/// Where one model call is recorded: the `kind: model` element when it decides, else the
/// engine's `state.model = {slug, source, calls, last}` and the library model's desk usage.
#[derive(Debug, Clone)]
pub struct Recorder {
    pub engine: String,
    pub model: crate::desk::Resolved,
}

/// One model call, recorded (calls, last call stats). Never the key.
async fn call_model(hub: &Hub, rec_on: &Recorder, conn: Arc<dyn Connector>, spec: ModelSpec, call: ModelCall) -> Result<String> {
    let sent = call.prompt.len();
    let t0 = Instant::now();
    let got = conn.call(spec, call).await;
    let ms = t0.elapsed().as_millis() as u64;
    let rec = match &got {
        Ok(r) => {
            json!({ "ok": true, "ms": ms, "prompt_chars": sent, "reply_chars": r.len(), "at": crate::now() })
        }
        Err(e) => {
            json!({ "ok": false, "ms": ms, "prompt_chars": sent, "error": format!("{e:#}"), "at": crate::now() })
        }
    };
    let r = &rec_on.model;
    match &r.element {
        Some(id) => {
            hub.update(id, |o| {
                o.state["calls"] = json!(o.state["calls"].as_u64().unwrap_or(0) + 1);
                o.state["last"] = rec;
                Ok(())
            })
            .await?
        }
        None => {
            if let Some(slug) = &r.slug {
                hub.with(|rt| rt.desk_usage(slug, Some(&rec), None))?;
            }
            let (slug, source) = (r.slug.clone(), r.source);
            hub.update(&rec_on.engine, |o| {
                let calls = if o.state["model"]["slug"] == json!(slug) && o.state["model"]["source"] == source { o.state["model"]["calls"].as_u64().unwrap_or(0) } else { 0 };
                o.state["model"] = json!({ "slug": slug, "source": source, "calls": calls + 1, "last": rec });
                Ok(())
            })
            .await?
        }
    }
    got
}

/// The model an engine calls (element → engine.md `model:` → desk default → built-in echo) and its connector.
pub fn connector_for(hub: &Hub, eng: &EngineNode) -> Result<(Recorder, ModelSpec, Arc<dyn Connector>)> {
    let model = match &eng.model {
        Some(r) => r.clone(),
        None => hub.read(|rt| rt.model_for(&eng.obj.id))?.unwrap_or_else(crate::desk::builtin),
    };
    let spec = model.spec.clone();
    let conn = hub.connector(&spec.connector).ok_or_else(|| anyhow!("no connector {} (known: {})", spec.connector, hub.connector_names().join(", ")))?;
    Ok((Recorder { engine: eng.obj.id.clone(), model }, spec, conn))
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

/// A tool message: `{role: tool, call, tool, args, ok, status, text, at, ms}`.
pub fn tool_message(call: &str, tool: &str, args: &Value, status: &str, text: String, ms: u64) -> Value {
    json!({ "role": "tool", "call": call, "tool": tool, "args": args, "ok": status == "ok", "status": status, "text": text, "at": crate::now(), "ms": ms })
}

/// Run one tool within its `timeout_ms`: `(status, text)`.
async fn run_one(tool: Arc<dyn tools::Tool>, tc: ToolCtx, args: Value) -> (&'static str, String) {
    let limit = tool.spec().timeout_ms;
    match tokio::time::timeout(Duration::from_millis(limit), tool.run(tc, args)).await {
        Ok(Ok(v)) => ("ok", v.to_string()),
        Ok(Err(e)) => ("failed", format!("{e:#}")),
        Err(_) => ("timed_out", format!("{} timed out after {limit} ms", tool.spec().name)),
    }
}

/// The tool a call names, when it is offered now.
fn offered_tool(offered: &[String], name: &str) -> Result<Arc<dyn tools::Tool>> {
    match (offered.iter().any(|t| t == name), tools::find(name)) {
        (true, Some(t)) => Ok(t),
        _ => Err(anyhow!("{name} is not offered on this step")),
    }
}

/// Run calls at once and wait for all of them; results in call order (ids `c1`, … unless given).
pub async fn run_calls(tc: ToolCtx, offered: &[String], calls: Vec<toon::Call>) -> Vec<Value> {
    let mut set = tokio::task::JoinSet::new();
    for (i, c) in calls.into_iter().enumerate() {
        let id = c.id.clone().unwrap_or_else(|| format!("c{}", i + 1));
        let tc = ToolCtx { call: id.clone(), ..tc.clone() };
        let tool = offered_tool(offered, &c.tool);
        set.spawn(async move {
            let t0 = Instant::now();
            let (status, text) = match tool {
                Ok(t) => run_one(t, tc, c.args.clone()).await,
                Err(e) => ("failed", format!("{e:#}")),
            };
            (i, tool_message(&id, &c.tool, &c.args, status, text, t0.elapsed().as_millis() as u64))
        });
    }
    let mut got = vec![];
    while let Some(r) = set.join_next().await {
        match r {
            Ok(x) => got.push(x),
            Err(e) => got.push((usize::MAX, tool_message("?", "?", &json!({}), "failed", format!("tool task failed: {e}"), 0))),
        }
    }
    got.sort_by_key(|(i, _)| *i);
    got.into_iter().map(|(_, m)| m).collect()
}

// ── the calls of a run: state.calls, state.waiting ─────────────────────────
//
// The engine never waits on tools. A step (render → model → parse → start calls → record) is a
// task that ends; the loop is then `waiting` with `state.waiting = {on, ids, since}` and no task
// behind it. Each call is a detached task owned by the hub; when it ends it records its result and
// calls `Hub::wake`, which dispatches to `wake` below: when the condition holds, the next step starts.

/// `state.calls` in start order (by `started`, then id).
fn calls_sorted(o: &Obj) -> Vec<(String, Value)> {
    let mut v: Vec<(String, Value)> = o.state["calls"].as_object().map(|m| m.iter().map(|(k, c)| (k.clone(), c.clone())).collect()).unwrap_or_default();
    v.sort_by_key(|(k, c)| (c["started"].as_u64().unwrap_or(0), k.clone()));
    v
}

/// The ids of the calls still running.
pub fn running_ids(o: &Obj) -> Vec<String> {
    calls_sorted(o).into_iter().filter(|(_, c)| c["status"] == "running").map(|(k, _)| k).collect()
}

pub fn any_running(o: &Obj) -> bool {
    o.state["calls"].as_object().is_some_and(|m| m.values().any(|c| c["status"] == "running"))
}

/// Every call of the run: `[{call, tool, args, status, since_ms, ended_ms?}]`, in start order.
pub fn calls(lp: &Obj) -> Vec<Value> {
    calls_sorted(lp).into_iter().map(|(k, c)| json!({ "call": k, "tool": c["tool"], "args": c["args"], "status": c["status"], "since_ms": c["started"], "ended_ms": c["ended"] })).collect()
}

/// The calls still running: `[{call, tool, args, since_ms}]`.
pub fn running(lp: &Obj) -> Vec<Value> {
    calls(lp).into_iter().filter(|c| c["status"] == "running").collect()
}

/// The waiting line: `waiting on c1, c2` / `waiting on any of c1, c2` / `answer pending · waiting on c1`.
pub fn waiting_line(lp: &Obj) -> Option<String> {
    let w = &lp.state["waiting"];
    if w.is_null() {
        return None;
    }
    let run = running_ids(lp);
    let ids: Vec<String> = w["ids"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).filter(|i| run.contains(i)).collect()).unwrap_or_default();
    let list = if ids.is_empty() { "nothing".to_string() } else { ids.join(", ") };
    Some(match (lp.state["pending_answer"].is_string(), w["on"].as_str()) {
        (true, _) => {
            format!("answer pending · waiting on {}", if run.is_empty() { "nothing".into() } else { run.join(", ") })
        }
        (_, Some("none")) => "next step now".into(),
        (_, Some("any")) => format!("waiting on any of {list}"),
        _ => format!("waiting on {list}"),
    })
}

/// End every running call with `status` (`cancelled`, `interrupted`): its status and ended time in
/// `state.calls`, and a failed tool message. Pure state; the caller aborts the tasks.
pub fn end_calls(o: &mut Obj, status: &str, text: &str) {
    let now = now_ms();
    for id in running_ids(o) {
        let c = o.state["calls"][&id].clone();
        let ms = now.saturating_sub(c["started"].as_u64().unwrap_or(now));
        o.state["calls"][&id]["status"] = json!(status);
        o.state["calls"][&id]["ended"] = json!(now);
        push(o, tool_message(&id, c["tool"].as_str().unwrap_or("?"), &c["args"], status, text.to_string(), ms));
    }
}

/// The waiting condition: `{on: "all" | "any" | "none" | [ids], ids: [the awaited set], since}`.
fn waiting(wait: &Await, set: &[String]) -> Value {
    let on = match wait {
        Await::All => json!("all"),
        Await::Any => json!("any"),
        Await::None => json!("none"),
        Await::Ids(v) => json!(v),
    };
    json!({ "on": on, "ids": set, "since": crate::now() })
}

/// Whether a waiting condition holds for the calls running now.
pub fn condition_met(w: &Value, running: &[String]) -> bool {
    let ids: Vec<&str> = w["ids"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    match w["on"].as_str() {
        Some("none") => true,
        Some("any") => ids.is_empty() || ids.iter().any(|i| !running.iter().any(|r| r == i)),
        _ => !ids.iter().any(|i| running.iter().any(|r| r == i)),
    }
}

/// The engine's current phase id, when it has a phases element.
fn phase_now(hub: &Hub, engine: &str) -> Option<String> {
    hub.read(|rt| rt.engine_node(engine).and_then(|e| first(e, "phases")).and_then(current_phase).map(|p| p.id)).ok().flatten()
}

/// One detached call: run the tool within its timeout, record the result, forget the handle, then
/// the callback. A call that started in another phase finishes and is tagged `phase: <old>` (P1).
/// A result for a call no longer in the run (the run ended, a new one began) is recorded `late`
/// and wakes nothing (R3); a call cancelled meanwhile records nothing more.
fn call_future(hub: Hub, tc: ToolCtx, tool: Arc<dyn tools::Tool>, args: Value) -> impl std::future::Future<Output = ()> + Send + 'static {
    async move {
        let (lp, id) = (tc.loop_id.clone(), tc.call.clone());
        let engine = tc.engine.clone();
        let t0 = Instant::now();
        let name = tool.spec().name.clone();
        let (status, text) = run_one(tool, tc, args.clone()).await;
        let mut msg = tool_message(&id, &name, &args, status, text, t0.elapsed().as_millis() as u64);
        let now_phase = phase_now(&hub, &engine);
        let mut wake = false;
        let r = hub
            .update(&lp, |o| {
                let entry = o.state["calls"].get(&id).cloned();
                match entry {
                    Some(c) if c["status"] == "running" => {
                        if let Some(old) = c["phase"].as_str().filter(|p| now_phase.as_deref() != Some(*p)) {
                            msg["phase"] = json!(old);
                        }
                        o.state["calls"][&id]["status"] = json!(status);
                        o.state["calls"][&id]["ended"] = json!(now_ms());
                        push(o, msg);
                        wake = true;
                    }
                    Some(_) => {} // cancelled / interrupted meanwhile: already recorded
                    None => {
                        msg["late"] = json!(true);
                        push(o, msg);
                    }
                }
                Ok(())
            })
            .await;
        if let Err(e) = r
            && !e.is::<crate::hub::Stopping>()
        {
            eprintln!("call {lp} {id}: {e:#}");
        }
        hub.call_done(&lp, &id);
        if wake {
            hub.wake(&lp).await;
        }
    }
}

#[cfg(test)]
pub fn call_future_for_test(hub: Hub, tc: ToolCtx, tool: Arc<dyn tools::Tool>, args: Value) -> impl std::future::Future<Output = ()> + Send + 'static {
    call_future(hub, tc, tool, args)
}

/// The model's `cancel: id`: abort a running call → its `cancelled` message; else a format note.
async fn cancel_call(hub: &Hub, lp: &str, id: &str) -> Result<()> {
    let _w = hub.writer(lp).await;
    let running = hub.read(|rt| rt.obj(lp).is_some_and(|o| o.state["calls"][id]["status"] == "running"))?;
    if running {
        hub.abort_call(lp, id);
    }
    hub.update_locked(lp, |o| {
        if running {
            let c = o.state["calls"][id].clone();
            let ms = now_ms().saturating_sub(c["started"].as_u64().unwrap_or(0));
            o.state["calls"][id]["status"] = json!("cancelled");
            o.state["calls"][id]["ended"] = json!(now_ms());
            push(o, tool_message(id, c["tool"].as_str().unwrap_or("?"), &c["args"], "cancelled", "cancelled".into(), ms));
        } else {
            push(o, json!({ "role": "format", "text": format!("cancel: {id} is not running"), "at": crate::now() }));
        }
        Ok(())
    })
}

/// The loop's wake handler (`Kind::wake`): under the loop's writer, while no step runs — a held
/// answer is finalized once no call runs; otherwise, when `state.waiting` holds, the next step starts.
pub fn wake(hub: Hub, id: String) -> TaskFuture {
    Box::pin(async move {
        let _w = hub.writer(&id).await;
        if hub.busy_or_hold(&id) {
            return Ok(()); // a step runs: delivered when it ends
        }
        let Some(o) = hub.read(|rt| rt.obj(&id).cloned())? else {
            return Ok(());
        };
        if o.phase != Phase::Waiting || o.state["waiting"].is_null() {
            return Ok(());
        }
        let run = running_ids(&o);
        // owner input or a phase change: the next step now (a held answer is superseded, O2)
        if o.state["wake_now"] == true {
            hub.update_locked(&id, |o| {
                if let Some(a) = o.state["pending_answer"].as_str().map(String::from) {
                    push(o, json!({ "role": "superseded", "text": a, "at": crate::now() }));
                }
                o.state["pending_answer"] = Value::Null;
                o.state["waiting"] = Value::Null;
                o.phase = Phase::Running;
                Ok(())
            })?;
            hub.start_task(&id, step_task);
            return Ok(());
        }
        if let Some(a) = o.state["pending_answer"].as_str().map(String::from) {
            if run.is_empty() {
                hub.update_locked(&id, |o| {
                    o.state["last_answer"] = json!(a);
                    o.state["pending_answer"] = Value::Null;
                    o.state["waiting"] = Value::Null;
                    o.phase = Phase::Idle;
                    Ok(())
                })?;
            }
            return Ok(());
        }
        if !condition_met(&o.state["waiting"], &run) {
            return Ok(());
        }
        hub.update_locked(&id, |o| {
            o.phase = Phase::Running;
            o.state["waiting"] = Value::Null;
            Ok(())
        })?;
        hub.start_task(&id, step_task);
        Ok(())
    })
}

/// The `run` action's task: the first step.
pub fn run_task(ctx: TaskCtx) -> TaskFuture {
    step_task(ctx)
}

/// One model step as a task that ends (it never waits on tools), then the callback: a wake that
/// is delivered once this task is gone (await none, or calls that finished during the step).
pub fn step_task(ctx: TaskCtx) -> TaskFuture {
    Box::pin(async move {
        let r = step(&ctx).await;
        if r.is_err() {
            ctx.hub().end_calls(ctx.id(), "cancelled", false).await;
        }
        ctx.hub().wake(ctx.id()).await;
        r
    })
}

async fn step(ctx: &TaskCtx) -> Result<()> {
    let hub = ctx.hub().clone();
    let engine = engine_of(ctx.id());
    let lid = ctx.id().to_string();
    let (eng, lp) = snapshot(&hub, &engine, &lid)?;
    let max = lp.num("max_steps", DEFAULT_MAX_STEPS as f64).max(1.0) as u64;
    if lp.state["step"].as_u64().unwrap_or(0) >= max {
        hub.end_calls(&lid, "cancelled", false).await;
        return ctx
            .update(|o| {
                o.state["stop_reason"] = json!(format!("max_steps ({max}) reached without an answer"));
                o.state["waiting"] = Value::Null;
                Ok(())
            })
            .await;
    }
    let max_running = lp.num("max_running", DEFAULT_MAX_RUNNING as f64).max(1.0) as usize;
    let (model_id, spec, conn) = connector_for(&hub, &eng)?;
    let budget = spec.context;
    let threshold = lp.num("refocus", DEFAULT_REFOCUS).clamp(0.05, 1.0);
    let prompt = render(&eng, &lp);
    if prompt.len() as f64 >= threshold * budget as f64 {
        refocus(ctx, prompt.len()).await?;
    }
    let (eng, lp) = snapshot(&hub, &engine, &lid)?;
    let prompt = render(&eng, &lp);
    let offer = offered(&eng);
    let msgs = messages(&lp);
    let (used, sent) = (prompt.len(), prompt.clone());
    ctx.update(|o| {
        o.phase = Phase::Running;
        o.state["waiting"] = Value::Null;
        o.state["wake_now"] = Value::Null;
        o.state["context_used"] = json!(used);
        o.state["context_budget"] = json!(budget);
        o.state["last_sent"] = json!(sent);
        Ok(())
    })
    .await?;
    let call = ModelCall { purpose: Purpose::Step, prompt, input: lp.state["input"].as_str().unwrap_or("").into(), tools: offer.clone(), results: results_since_input(&msgs), messages: msgs };
    let reply = call_model(&hub, &model_id, conn, spec, call).await?;
    let parsed = toon::parse(&reply);
    ctx.update(|o| {
        o.state["step"] = json!(o.state["step"].as_u64().unwrap_or(0) + 1);
        push(o, json!({ "role": "model", "text": reply, "at": crate::now() }));
        Ok(())
    })
    .await?;
    let r = match parsed {
        Err(e) => {
            // a reply that did not parse: noted, and the next step comes at once
            return ctx
                .update(|o| {
                    push(o, json!({ "role": "format", "text": format!("{e:#}"), "at": crate::now() }));
                    o.state["waiting"] = waiting(&Await::None, &[]);
                    o.phase = Phase::Waiting;
                    Ok(())
                })
                .await;
        }
        Ok(r) => r,
    };
    for id in &r.cancel {
        cancel_call(&hub, &lid, id).await?;
    }
    let had_calls = !r.calls.is_empty();
    let mut started: Vec<(String, Arc<dyn tools::Tool>, Value)> = vec![];
    let answer = r.answer.clone();
    let wait = r.wait.clone();
    let calls_in = r.calls;
    let no_tools = had_calls && offer.is_empty();
    let phase = phase_now(&hub, &engine);
    // start the calls: recorded `running` in state.calls first, then spawned (a fast call finds its entry)
    ctx.update(|o| {
        if !o.state["calls"].is_object() {
            o.state["calls"] = json!({});
        }
        if no_tools {
            push(o, json!({ "role": "format", "text": "no tools are offered: answer instead", "at": crate::now() }));
        } else {
            for c in calls_in {
                let used = |o: &Obj, i: &str| o.state["calls"].get(i).is_some();
                let id = match c.id {
                    Some(i) if used(o, &i) => {
                        push(o, json!({ "role": "format", "text": format!("call id {i} is already used in this run ({} not started)", c.tool), "at": crate::now() }));
                        continue;
                    }
                    Some(i) => i,
                    None => (1..).map(|n| format!("c{n}")).find(|i| !used(o, i)).expect("a free id"),
                };
                let fail = |o: &mut Obj, why: String| {
                    o.state["calls"][&id] = json!({ "tool": c.tool, "args": c.args, "status": "failed", "started": now_ms(), "ended": now_ms() });
                    push(o, tool_message(&id, &c.tool, &c.args, "failed", why, 0));
                };
                let tool = match offered_tool(&offer, &c.tool) {
                    Ok(t) => t,
                    Err(e) => {
                        fail(o, format!("{e:#}"));
                        continue;
                    }
                };
                let n = running_ids(o).len();
                if n >= max_running {
                    fail(o, format!("not started: {n} calls are already running (max_running {max_running})"));
                    continue;
                }
                o.state["calls"][&id] = json!({ "tool": c.tool, "args": c.args, "status": "running", "started": now_ms(), "phase": phase });
                started.push((id, tool, c.args));
            }
        }
        Ok(())
    })
    .await?;
    let started_ids: Vec<String> = started.iter().map(|(i, _, _)| i.clone()).collect();
    for (id, tool, args) in started {
        let tc = ToolCtx { hub: hub.clone(), engine: engine.clone(), loop_id: lid.clone(), call: id.clone() };
        hub.spawn_call(&lid, &id, call_future(hub.clone(), tc, tool, args));
    }
    // record what this step waits on, then end: no task stays behind
    ctx.update(|o| {
        let run = running_ids(o);
        if let Some(a) = answer {
            // an answer ends the run once no call runs: held until the last completion's callback
            o.state["pending_answer"] = json!(a);
            o.state["waiting"] = waiting(&Await::All, &run);
        } else {
            let set: Vec<String> = match &wait {
                Await::Ids(v) => v.clone(),
                _ if had_calls => started_ids,
                _ => run,
            };
            o.state["waiting"] = waiting(&wait, &set);
        }
        o.phase = Phase::Waiting;
        Ok(())
    })
    .await
}

/// The model's `test` action: one short call, recorded on the model.
pub fn test_task(ctx: TaskCtx) -> TaskFuture {
    Box::pin(async move {
        let hub = ctx.hub().clone();
        let o = ctx.obj()?;
        let spec = ModelSpec::from_config(&o.config);
        let conn = hub.connector(&spec.connector).ok_or_else(|| anyhow!("no connector {}", spec.connector))?;
        let model = crate::desk::Resolved { title: o.title.clone(), source: "element", spec: spec.clone(), element: Some(ctx.id().to_string()), ..Default::default() };
        let rec = Recorder { engine: engine_of(ctx.id()), model };
        let reply = call_model(&hub, &rec, conn, spec, test_call()).await?;
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

/// The one short call a `test` sends.
pub fn test_call() -> ModelCall {
    ModelCall { purpose: Purpose::Test, prompt: "Reply exactly: answer: pong".into(), input: String::new(), tools: vec![], results: 0, messages: vec![] }
}

/// The desk's `model.test {slug}`: one short call to a library model, run in the background; the
/// result lands in `world.desk.models[].test` (and its calls / last), then the world goes out.
pub async fn desk_test(hub: Hub, slug: String) -> Result<()> {
    let spec = hub.read(|rt| rt.desk().find(&slug).map(|m| m.spec()))?.ok_or_else(|| anyhow!("no model {slug} in the library"))?;
    let conn = hub.connector(&spec.connector).ok_or_else(|| anyhow!("no connector {} (known: {})", spec.connector, hub.connector_names().join(", ")))?;
    hub.with(|rt| rt.desk_usage(&slug, None, Some(&json!({ "running": true, "at": crate::now() }))))?;
    hub.send_world();
    let t0 = Instant::now();
    let got = tokio::time::timeout(Duration::from_secs(120), conn.call(spec, test_call())).await.unwrap_or_else(|_| Err(anyhow!("no reply within 120 s")));
    let ms = t0.elapsed().as_millis() as u64;
    let (last, test) = match &got {
        Ok(r) if !r.trim().is_empty() => (
            json!({ "ok": true, "ms": ms, "prompt_chars": test_call().prompt.len(), "reply_chars": r.len(), "at": crate::now() }),
            json!({ "ok": true, "reply": clip(r.trim(), 200), "ms": ms, "at": crate::now() }),
        ),
        Ok(_) => (json!({ "ok": false, "ms": ms, "error": "empty reply", "at": crate::now() }), json!({ "ok": false, "error": "the model replied with nothing", "ms": ms, "at": crate::now() })),
        Err(e) => (json!({ "ok": false, "ms": ms, "error": format!("{e:#}"), "at": crate::now() }), json!({ "ok": false, "error": format!("{e:#}"), "ms": ms, "at": crate::now() })),
    };
    hub.with(|rt| rt.desk_usage(&slug, Some(&last), Some(&test)))?;
    hub.send_world();
    Ok(())
}
