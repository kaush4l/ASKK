//! Workflows: named, ordered sequences of the engine's phases. `run {workflow, input}` (the owner's
//! `workflow.run`) runs the engine's loop once per phase, in order: each step selects its phase (so it offers that
//! phase's tools and instructions), runs the loop on the input, and hands the answer on as the next step's input.
//! The loop's history records every step (its inputs and the phase switches). When the sequence ends — done,
//! failed or cancelled — the engine returns to the phase (mode) selected before it started.

use anyhow::{Result, anyhow, bail};
use serde_json::{Value, json};
use std::time::Duration;

use crate::hub::TaskCtx;
use crate::node::{Node, badge, button, card, col, row, text};
use crate::object::{Action, Kind, Obj, Phase, TaskFn, TaskFuture};
use crate::run::{first, list_of};
use crate::Hub;

pub struct Workflows;

/// One workflow: `{id, title?, icon?, phases: [phase ids]}`.
#[derive(Debug, Clone, PartialEq)]
pub struct WorkflowDef {
    pub id: String,
    pub title: String,
    pub icon: Option<String>,
    pub phases: Vec<String>,
}

pub fn workflow_defs(obj: &Obj) -> Vec<WorkflowDef> {
    list_of(obj.config.get("list"))
        .iter()
        .filter_map(|w| {
            let m = w.as_object()?;
            let id = m.get("id")?.as_str()?.to_string();
            Some(WorkflowDef {
                title: m.get("title").and_then(Value::as_str).map(String::from).unwrap_or_else(|| id.clone()),
                icon: m.get("icon").and_then(Value::as_str).map(String::from),
                phases: list_of(m.get("phases")).iter().filter_map(|p| p.as_str().map(String::from)).collect(),
                id,
            })
        })
        .collect()
}

fn busy(obj: &Obj) -> bool {
    matches!(obj.phase, Phase::Running | Phase::Waiting)
}

/// "workflow research→build · 2/3"
fn progress(obj: &Obj) -> Option<String> {
    let r = &obj.state["running"];
    let phases: Vec<&str> = r["phases"].as_array()?.iter().filter_map(Value::as_str).collect();
    Some(format!("workflow {} · {}/{}", phases.join("→"), r["step"].as_u64().unwrap_or(0), phases.len()))
}

/// The title of the workflow in flight, if any.
pub fn running_title(obj: &Obj) -> Option<String> {
    let id = obj.state["running"]["workflow"].as_str()?;
    Some(workflow_defs(obj).into_iter().find(|w| w.id == id).map(|w| format!("{} {}", w.icon.unwrap_or_default(), w.title).trim().to_string()).unwrap_or_else(|| id.to_string()))
}

impl Kind for Workflows {
    fn focus(&self, obj: &Obj) -> Option<String> {
        let r = &obj.state["running"];
        if let Some(t) = running_title(obj) {
            let i = r["step"].as_u64().unwrap_or(0) as usize;
            let p = r["phases"].as_array().and_then(|a| a.get(i.saturating_sub(1))).and_then(Value::as_str).unwrap_or("starting");
            return Some(format!("{t} · phase {p}"));
        }
        let l = &obj.state["last"];
        l["workflow"].as_str().map(|w| format!("last {w}: {}", l["answer"].as_str().or(l["end"].as_str()).unwrap_or("ended")))
    }
    fn activity(&self, before: &Obj, after: &Obj) -> Vec<(String, String, bool)> {
        let mut out = vec![];
        let (b, a) = (&before.state["running"]["step"], &after.state["running"]["step"]);
        if a != b && let Some(i) = a.as_u64().filter(|i| *i > 0) {
            let ph = &after.state["running"]["phases"];
            let p = ph[i as usize - 1].as_str().unwrap_or("?");
            out.push(("phase".to_string(), format!("phase {p} · step {i}/{}", ph.as_array().map(Vec::len).unwrap_or(0)), true));
        }
        if before.state["last"] != after.state["last"] && let Some(e) = after.state["last"]["end"].as_str() {
            out.push(("end".to_string(), format!("{}: {e}", after.state["last"]["workflow"].as_str().unwrap_or("?")), e.starts_with("done")));
        }
        out.extend(crate::object::phase_activity(before, after));
        out
    }
    fn avatar(&self) -> &'static str {
        "🧵"
    }
    fn kind(&self) -> &'static str {
        "workflows"
    }
    fn about(&self) -> &'static str {
        "ordered sequences of the engine's phases; config list: [{id, title?, icon?, phases: [phase ids]}]; run {workflow, input} runs the loop once per phase, each answer the next input"
    }
    fn config(&self) -> &'static [(&'static str, &'static str)] {
        &[("list", "list")]
    }
    fn init(&self, _: &Obj) -> Value {
        json!({ "running": null, "last": null })
    }
    fn actions(&self, obj: &Obj) -> Vec<Action> {
        if busy(obj) { vec![Action::new("cancel", "Cancel")] } else { vec![Action::new("run", "Run workflow").arg("workflow", "text").arg("input", "text")] }
    }
    fn act(&self, obj: &mut Obj, action: &str, args: &Value) -> Result<()> {
        match action {
            "run" if busy(obj) => bail!("{} is already running", obj.id),
            "run" => {
                let want = args["workflow"].as_str().map(str::trim).filter(|s| !s.is_empty()).ok_or_else(|| anyhow!("run needs workflow"))?;
                let input = args["input"].as_str().map(str::trim).filter(|s| !s.is_empty()).ok_or_else(|| anyhow!("run needs input"))?;
                let defs = workflow_defs(obj);
                let w = defs.iter().find(|w| w.id == want).ok_or_else(|| anyhow!("no workflow {want} (one of {})", defs.iter().map(|w| w.id.as_str()).collect::<Vec<_>>().join(", ")))?;
                if w.phases.is_empty() {
                    bail!("workflow {want} lists no phases");
                }
                obj.phase = Phase::Running;
                obj.state["running"] = json!({ "workflow": w.id, "phases": w.phases, "step": 0, "input": input, "prior": null });
                Ok(())
            }
            other => bail!("{} has no action {other}", obj.id),
        }
    }
    fn task(&self, _: &Obj, action: &str) -> Option<TaskFn> {
        (action == "run").then_some(run_task as TaskFn)
    }
    fn now(&self, obj: &Obj) -> Option<String> {
        if busy(obj) {
            return progress(obj);
        }
        let l = &obj.state["last"];
        let n = workflow_defs(obj).len();
        Some(match l["workflow"].as_str() {
            Some(w) => format!("{w}: {}", l["end"].as_str().unwrap_or("ended")),
            None => format!("{n} workflow(s)"),
        })
    }
    fn small(&self, obj: &Obj) -> Node {
        let defs = workflow_defs(obj);
        if defs.is_empty() {
            return col(vec![text("No workflows").p("size", "sm")]);
        }
        col(defs.iter().map(|w| row(vec![text(format!("{} {}", w.icon.clone().unwrap_or_default(), w.title).trim().to_string()).p("size", "sm"), text(w.phases.join("→")).p("size", "xs").p("mono", true)])).collect())
    }
    fn large(&self, obj: &Obj) -> Node {
        let mut kids = vec![];
        for w in workflow_defs(obj) {
            let mut chain = vec![];
            for (i, p) in w.phases.iter().enumerate() {
                if i > 0 {
                    chain.push(text("→").p("tone", "neutral"));
                }
                let live = obj.state["running"]["workflow"] == w.id.as_str() && obj.state["running"]["step"].as_u64() == Some(i as u64 + 1);
                chain.push(badge(p.as_str(), if live { "busy" } else { "accent" }));
            }
            kids.push(col(vec![
                text(format!("{} {}", w.icon.clone().unwrap_or_default(), w.title).trim().to_string()).p("size", "lg"),
                Node::new("Stack").p("dir", "row").p("gap", 2).p("wrap", true).p("align", "center").kids(chain),
                if busy(obj) { button("Cancel", "cancel") } else { Node::new("Field").p("label", "Input").p("name", "input").p("value", "").p("action", "run").p("args", json!({ "workflow": w.id })).p("kind", "text") },
            ]));
        }
        if kids.is_empty() {
            kids.push(text("No workflows"));
        }
        let l = &obj.state["last"];
        if let Some(w) = l["workflow"].as_str() {
            kids.push(Node::new("Divider"));
            kids.push(text(format!("last: {w} — {}", l["end"].as_str().unwrap_or("?"))).p("size", "sm"));
            for st in l["steps"].as_array().cloned().unwrap_or_default() {
                kids.push(row(vec![badge(st["phase"].as_str().unwrap_or("?"), "neutral"), text(st["answer"].as_str().unwrap_or("")).p("size", "sm").p("md", true)]));
            }
        }
        card(&obj.title, obj.phase, vec![col(kids)]).p("scene", "pipeline")
    }
    fn medium(&self, obj: &Obj) -> Node {
        let defs = workflow_defs(obj);
        let mut kids: Vec<Node> = vec![];
        if defs.is_empty() {
            kids.push(text("No workflows"));
        } else {
            let rows: Vec<Value> = defs.iter().map(|w| json!([format!("{} {}", w.icon.clone().unwrap_or_default(), w.title).trim(), w.phases.join(" → ")])).collect();
            kids.push(Node::new("Table").p("columns", json!(["workflow", "phases in order"])).p("rows", rows));
        }
        if busy(obj) {
            kids.push(row(vec![badge(progress(obj).unwrap_or_default(), "busy"), button("Cancel", "cancel")]));
        } else if let Some(w) = obj.state["last"]["workflow"].as_str() {
            let l = &obj.state["last"];
            kids.push(text(format!("last: {w} — {}", l["end"].as_str().unwrap_or("?"))).p("size", "sm"));
            if let Some(a) = l["answer"].as_str() {
                kids.push(text(a).p("md", true));
            }
        }
        card(&obj.title, obj.phase, vec![col(kids)])
    }
    fn prompt(&self, obj: &Obj) -> String {
        let ws: Vec<String> = workflow_defs(obj).iter().map(|w| format!("{} [{}]", w.id, w.phases.join(" → "))).collect();
        format!("workflows \"{}\" ({}): {}{}", obj.title, obj.id, if ws.is_empty() { "none".into() } else { ws.join(", ") }, progress(obj).filter(|_| busy(obj)).map(|p| format!("; running {p}")).unwrap_or_default())
    }
}

fn engine_of(id: &str) -> String {
    id.rsplit_once('/').map(|(e, _)| e.to_string()).unwrap_or_default()
}

/// On any end (done, failed, cancelled — an abort drops the body): the loop stops if a step still runs, and the
/// engine returns to the phase selected before the workflow.
struct Restore {
    hub: Hub,
    lp: String,
    phases: String,
    prior: Option<String>,
}

impl Drop for Restore {
    fn drop(&mut self) {
        let (hub, lp, phases, prior) = (self.hub.clone(), self.lp.clone(), self.phases.clone(), self.prior.take());
        if let Ok(h) = tokio::runtime::Handle::try_current() {
            h.spawn(async move {
                if hub.read(|rt| rt.obj(&lp).is_some_and(|o| matches!(o.phase, Phase::Running | Phase::Waiting))).unwrap_or(false) {
                    let _ = hub.act(&lp, "cancel", &json!({})).await;
                }
                if let Some(p) = prior {
                    let _ = hub.act(&phases, "set", &json!({ "phase": p, "by": "workflow" })).await;
                }
            });
        }
    }
}

fn loop_state(hub: &Hub, id: &str) -> Result<(Phase, Value)> {
    hub.read(|rt| rt.obj(id).map(|o| (o.phase, o.state.clone())))?.ok_or_else(|| anyhow!("{id} is gone"))
}

fn run_task(ctx: TaskCtx) -> TaskFuture {
    Box::pin(async move {
        let hub = ctx.hub().clone();
        let me = ctx.obj()?;
        let r = me.state["running"].clone();
        let wf = r["workflow"].as_str().unwrap_or("").to_string();
        let order: Vec<String> = r["phases"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
        let engine = engine_of(ctx.id());
        let (lp, ph, prior, known) = hub
            .read(|rt| {
                let e = rt.engine_node(&engine)?;
                let lp = first(e, "loop")?.id.clone();
                let ph = first(e, "phases")?;
                let known: Vec<String> = crate::run::phase_defs(ph).into_iter().map(|d| d.id).collect();
                Some((lp, ph.id.clone(), crate::run::current_phase(ph).map(|p| p.id), known))
            })?
            .ok_or_else(|| anyhow!("{engine} needs a loop and phases to run a workflow"))?;
        if let Some(bad) = order.iter().find(|p| !known.contains(p)) {
            bail!("workflow {wf}: {bad} is not a phase of {engine}");
        }
        if matches!(loop_state(&hub, &lp)?.0, Phase::Running | Phase::Waiting) {
            bail!("{lp} is already running");
        }
        let _restore = Restore { hub: hub.clone(), lp: lp.clone(), phases: ph.clone(), prior: prior.clone() };
        ctx.update(|o| {
            o.state["running"]["prior"] = json!(prior);
            Ok(())
        })
        .await?;
        let mut input = r["input"].as_str().unwrap_or("").to_string();
        let mut steps = vec![];
        for (i, p) in order.iter().enumerate() {
            ctx.update(|o| {
                o.state["running"]["step"] = json!(i + 1);
                Ok(())
            })
            .await?;
            hub.act(&ph, "set", &json!({ "phase": p, "by": "workflow" })).await?;
            hub.act(&lp, "run", &json!({ "input": input })).await?;
            let (end, st) = loop {
                let (phase, st) = loop_state(&hub, &lp)?;
                if !matches!(phase, Phase::Running | Phase::Waiting) {
                    break (phase, st);
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            };
            let answer = st["last_answer"].as_str().map(String::from);
            match (end, answer) {
                (Phase::Idle, Some(a)) => {
                    steps.push(json!({ "phase": p, "answer": a }));
                    input = a;
                }
                (end, _) => {
                    let why = st["stop_reason"].as_str().or(st["error"].as_str()).unwrap_or("no answer").to_string();
                    let e = format!("step {} ({p}) ended {}: {why}", i + 1, json!(end).as_str().unwrap_or("?"));
                    ctx.update(|o| {
                        o.state["last"] = json!({ "workflow": wf, "end": e, "steps": steps, "at": crate::now() });
                        o.state["running"] = Value::Null;
                        Ok(())
                    })
                    .await?;
                    bail!(e);
                }
            }
        }
        ctx.update(|o| {
            o.state["last"] = json!({ "workflow": wf, "end": format!("done in {} step(s)", steps.len()), "answer": input, "steps": steps, "at": crate::now() });
            o.state["running"] = Value::Null;
            Ok(())
        })
        .await
    })
}
