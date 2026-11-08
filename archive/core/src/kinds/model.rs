//! A model: which connector reaches it, its id, its context budget. The key is never here: only
//! the NAME of the environment variable that holds it (`key_env`), read by the connector at call time.

use anyhow::{Result, bail};
use serde_json::{Value, json};

use crate::connector::ModelSpec;
use crate::node::{Node, badge, button, card, col, row, text};
use crate::object::{Action, Kind, Obj, Phase, TaskFn};

pub struct Model;

pub const CONNECTORS: [&str; 4] = ["claude-cli", "openai", "anthropic", "echo"];

/// "echo" when the id is empty or equals the connector, else "connector id": the model said once.
pub fn label(s: &ModelSpec) -> String {
    if s.id.is_empty() || s.id == s.connector { s.connector.clone() } else { format!("{} {}", s.connector, s.id) }
}

fn last_line(obj: &Obj) -> String {
    let l = &obj.state["last"];
    if l.is_null() {
        return "no call yet".into();
    }
    if l["ok"] == true {
        format!("last call {} ms · sent {} chars · got {} chars", l["ms"], l["prompt_chars"], l["reply_chars"])
    } else {
        format!("last call failed after {} ms: {}", l["ms"], l["error"].as_str().unwrap_or(""))
    }
}

fn facts(obj: &Obj) -> Vec<Node> {
    let s = ModelSpec::from_config(&obj.config);
    let key = match &s.key_env {
        None => badge("no key needed", "neutral"),
        Some(k) => badge(format!("key {k}: {}", if s.key().is_some() { "set" } else { "missing" }), if s.key().is_some() { "ok" } else { "warn" }),
    };
    vec![
        Node::new("Stack").p("dir", "row").p("gap", 2).p("wrap", true).kids(vec![
            badge(format!("connector: {}", s.connector), "neutral"),
            badge(if s.id.is_empty() { "id: default".to_string() } else { format!("id: {}", s.id) }, "neutral"),
            badge(format!("context: {} chars", s.context), "neutral"),
            key,
        ]),
        text(format!("{} call(s) · {}", obj.state["calls"].as_u64().unwrap_or(0), last_line(obj))).p("size", "sm").p("mono", true),
    ]
}

impl Kind for Model {
    /// The default avatar (an object may set `icon:` in its .md instead).
    fn avatar(&self) -> &'static str {
        "🧠"
    }
    fn kind(&self) -> &'static str {
        "model"
    }
    fn about(&self) -> &'static str {
        "a model: connector (claude-cli | openai | anthropic | echo), id, base_url, key_env (the env var's name), context (chars)"
    }
    fn config(&self) -> &'static [(&'static str, &'static str)] {
        &[("connector", "text"), ("id", "text"), ("base_url", "text"), ("key_env", "text"), ("context", "number")]
    }
    fn init(&self, _: &Obj) -> Value {
        json!({ "calls": 0, "last": null })
    }
    fn actions(&self, obj: &Obj) -> Vec<Action> {
        if obj.phase == Phase::Running { vec![Action::new("cancel", "Cancel")] } else { vec![Action::new("test", "Test")] }
    }
    fn act(&self, obj: &mut Obj, action: &str, _: &Value) -> Result<()> {
        match action {
            "test" => {
                let c = ModelSpec::from_config(&obj.config).connector;
                if !CONNECTORS.contains(&c.as_str()) {
                    bail!("unknown connector {c} (one of {})", CONNECTORS.join(", "));
                }
                obj.phase = Phase::Running;
                obj.state["test"] = Value::Null;
            }
            "cancel" => bail!("{} is not running", obj.id),
            other => bail!("{} has no action {other}", obj.id),
        }
        Ok(())
    }
    fn task(&self, _: &Obj, action: &str) -> Option<TaskFn> {
        (action == "test").then_some(crate::run::test_task as TaskFn)
    }
    fn now(&self, obj: &Obj) -> Option<String> {
        Some(if obj.phase == Phase::Running {
            "testing · one short call".into()
        } else {
            let l = &obj.state["last"];
            match (l["ok"].as_bool(), l["ms"].as_f64()) {
                (Some(true), Some(ms)) => format!("last call {:.1} s", ms / 1000.0),
                (Some(false), _) => format!("last call failed: {}", l["error"].as_str().unwrap_or("?").chars().take(60).collect::<String>()),
                _ => "never called".into(),
            }
        })
    }
    fn small(&self, obj: &Obj) -> Node {
        let s = ModelSpec::from_config(&obj.config);
        row(vec![text(label(&s)).p("size", "sm").p("mono", true), badge(format!("{} call(s)", obj.state["calls"].as_u64().unwrap_or(0)), "neutral")])
    }
    fn medium(&self, obj: &Obj) -> Node {
        let mut kids = facts(obj);
        if let Some(e) = obj.state["error"].as_str() {
            kids.push(text(e).p("tone", "error").p("size", "sm").p("mono", true));
        }
        if let Some(r) = obj.state["test"]["reply"].as_str() {
            kids.push(text(format!("test reply: {r}")).p("size", "sm").p("mono", true));
        }
        kids.push(if obj.phase == Phase::Running { button("Cancel", "cancel") } else { button("Test", "test") });
        card(&obj.title, obj.phase, vec![col(kids)])
    }
    fn focus(&self, obj: &Obj) -> Option<String> {
        let s = ModelSpec::from_config(&obj.config);
        Some(if s.id.is_empty() || s.id == s.connector { s.connector.clone() } else { format!("{} · {}", s.connector, s.id) })
    }
    fn activity(&self, before: &Obj, after: &Obj) -> Vec<(String, String, bool)> {
        let mut out = vec![];
        if before.state["calls"] != after.state["calls"] || (before.state["last"] != after.state["last"] && !after.state["last"].is_null()) {
            out.push(("call".to_string(), last_line(after), after.state["last"]["ok"] == true));
        }
        if before.state["test"] != after.state["test"] && !after.state["test"].is_null() {
            let ok = after.state["test"]["reply"].is_string();
            out.push(("test".to_string(), if ok { format!("test ok: {}", after.state["test"]["reply"].as_str().unwrap_or("")) } else { "test failed".into() }, ok));
        }
        out.extend(crate::object::phase_activity(before, after));
        out
    }
    fn large(&self, obj: &Obj) -> Node {
        let s = ModelSpec::from_config(&obj.config);
        let l = &obj.state["last"];
        let n = |v: &Value| v.as_u64().unwrap_or(0);
        let budget = s.context.max(1) as u64;
        let mut kids = facts(obj);
        kids.push(Node::new("Meter").p("label", "calls").p("value", n(&obj.state["calls"])).p("max", n(&obj.state["calls"]).max(10)).p("tone", "accent"));
        kids.push(Node::new("Meter").p("label", "last call (ms)").p("value", n(&l["ms"])).p("max", n(&l["ms"]).max(5000)).p("tone", if l["ok"] == false { "error" } else { "busy" }));
        kids.push(Node::new("Meter").p("label", "last prompt (chars of the budget)").p("value", n(&l["prompt_chars"])).p("max", budget).p("tone", "neutral"));
        kids.push(Node::new("Meter").p("label", "last reply (chars)").p("value", n(&l["reply_chars"])).p("max", n(&l["reply_chars"]).max(2000)).p("tone", "ok"));
        if let Some(e) = obj.state["error"].as_str() {
            kids.push(text(e).p("tone", "error").p("size", "sm").p("mono", true));
        }
        kids.push(if obj.phase == Phase::Running { button("Cancel", "cancel") } else { button("Test", "test") });
        card(&obj.title, obj.phase, vec![col(kids)]).p("scene", "meters")
    }
    fn prompt(&self, obj: &Obj) -> String {
        let s = ModelSpec::from_config(&obj.config);
        format!("model \"{}\" ({}): connector {}, id {}, context {} chars, {} call(s)", obj.title, obj.id, s.connector, if s.id.is_empty() { "default" } else { &s.id }, s.context, obj.state["calls"].as_u64().unwrap_or(0))
    }
}
