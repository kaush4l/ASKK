//! # state
//! Free key/value memory the engine keeps across runs. State is the map; the `remember` tool
//! (`{key, value}`) writes into it; the prompt shows it as JSON.
use crate::core::{tool, Component, Event, Spec, Tool};
use serde_json::{json, Map, Value};
use std::sync::Arc;

const DOC: &str = "Key/value memory; `remember {key, value}` writes; shown as JSON in the prompt.";

pub struct State {
    name: String,
    map: Map<String, Value>,
}

pub fn new(s: Spec) -> Result<Box<dyn Component>, String> {
    let map = match s.state {
        Value::Null => Map::new(),
        Value::Object(m) => m,
        _ => return Err("state must be an object".into()),
    };
    Ok(Box::new(State { name: s.name, map }))
}

impl Component for State {
    fn kind(&self) -> &'static str { "state" }
    fn name(&self) -> &str { &self.name }
    fn doc(&self) -> &'static str { DOC }
    fn config(&self) -> Value { Value::Null }
    fn state(&self) -> Value { Value::Object(self.map.clone()) }
    fn view(&self) -> crate::compose::Node {
        let lines: Vec<String> = self.map.iter().map(|(k, v)| format!("{k}: {v}")).collect();
        super::tile(&self.name, "state", if lines.is_empty() { vec!["empty".into()] } else { lines })
    }
    fn on(&mut self, ev: &Event) {
        if let Event::Called { tool, args, result } = ev {
            if tool == "remember" && !result.starts_with("error") {
                if let Some(k) = args["key"].as_str() {
                    self.map.insert(k.into(), args["value"].clone());
                }
            }
        }
    }
    fn prompt(&self) -> Option<String> {
        (!self.map.is_empty()).then(|| Value::Object(self.map.clone()).to_string())
    }
    fn tools(&self) -> Vec<Arc<dyn Tool>> {
        vec![tool("remember", "store a value under a key", json!({"key": "text", "value": "any"}), |a| {
            a["key"].as_str().map(|k| json!(format!("remembered {k}"))).ok_or_else(|| "key missing".into())
        })]
    }
}
