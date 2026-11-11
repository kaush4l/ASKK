//! # script
//! A shortcut: a fixed sequence of tool calls exposed as one tool named after the element.
//! Config `description`, `steps: [{tool, args}]`. In args, the string `$prev` is the previous
//! step's result, `$input` the script's whole input, `$input.key` one field of it. Stops at
//! the first error. Use when the same calls keep repeating (history flags that).
use crate::core::{read, value, Call, Component, Fut, Spec, Tool, Toolbox};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

const DOC: &str = "Named sequence of tool calls, invoked as one tool; `$prev`, `$input`, `$input.key` in args.";

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Cfg {
    #[serde(default)]
    description: String,
    #[serde(default)]
    steps: Vec<Call>,
}

pub struct Script {
    name: String,
    cfg: Cfg,
}

pub fn new(s: Spec) -> Result<Box<dyn Component>, String> {
    Ok(Box::new(Script { name: s.name, cfg: read(&s.config)? }))
}

fn fill(v: &Value, input: &Value, prev: &Value) -> Value {
    match v {
        Value::String(s) if s == "$prev" => prev.clone(),
        Value::String(s) if s == "$input" => input.clone(),
        Value::String(s) if s.starts_with("$input.") => input[&s[7..]].clone(),
        Value::Array(a) => Value::Array(a.iter().map(|x| fill(x, input, prev)).collect()),
        Value::Object(m) => Value::Object(m.iter().map(|(k, x)| (k.clone(), fill(x, input, prev))).collect()),
        other => other.clone(),
    }
}

struct ScriptTool {
    name: String,
    cfg: Cfg,
}

impl Tool for ScriptTool {
    fn name(&self) -> String {
        self.name.clone()
    }
    fn description(&self) -> String {
        let chain: Vec<&str> = self.cfg.steps.iter().map(|s| s.tool.as_str()).collect();
        format!("{} (runs {})", self.cfg.description, chain.join(" → "))
    }
    fn invoke(&self, input: Value, tools: Toolbox) -> Fut<Result<Value, String>> {
        let steps = self.cfg.steps.clone();
        Box::pin(async move {
            let mut prev = Value::Null;
            for (i, s) in steps.iter().enumerate() {
                prev = tools.call(&s.tool, fill(&s.args, &input, &prev)).await.map_err(|e| format!("step {} ({}): {e}", i + 1, s.tool))?;
            }
            Ok(prev)
        })
    }
}

impl Component for Script {
    fn kind(&self) -> &'static str { "script" }
    fn category(&self) -> &'static str { "action" }
    fn icon(&self) -> &'static str { "layers" }
    fn slot(&self) -> crate::core::Slot { crate::core::Slot::Tools }
    fn abilities(&self) -> Vec<String> { self.tools().iter().map(|t| t.name()).collect() }
    fn name(&self) -> &str { &self.name }
    fn doc(&self) -> &'static str { DOC }
    fn config(&self) -> Value { value(&self.cfg) }
    fn state(&self) -> Value { Value::Null }
    fn view(&self) -> crate::core::node::Node {
        let chain: Vec<String> = self.cfg.steps.iter().map(|s| s.tool.clone()).collect();
        super::tile(&self.name, "script", [self.cfg.description.clone(), chain.join(" → ")])
    }
    fn tools(&self) -> Vec<Arc<dyn Tool>> {
        if self.cfg.steps.is_empty() {
            return vec![];
        }
        vec![Arc::new(ScriptTool { name: self.name.clone(), cfg: self.cfg.clone() })]
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::tool;
    use serde_json::json;

    #[tokio::test]
    async fn runs_steps_in_order_passing_results() {
        let double = tool("double", "x2", Value::Null, |a| Ok(json!(a["n"].as_f64().ok_or("n missing")? * 2.0)));
        let s = new(Spec {
            kind: "script".into(),
            name: "quad".into(),
            config: json!({"description": "x4", "steps": [{"tool": "double", "args": {"n": "$input.n"}}, {"tool": "double", "args": {"n": "$prev"}}]}),
            state: Value::Null,
        })
        .unwrap();
        let mut list = s.tools();
        list.push(double);
        let tb = Toolbox::new(list);
        assert_eq!(tb.call("quad", json!({"n": 3})).await.unwrap(), json!(12.0));
        assert_eq!(tb.call("quad", json!({})).await.unwrap_err(), "step 1 (double): n missing");
        assert!(tb.describe().unwrap().contains("x4 (runs double → double)"));
    }
}
