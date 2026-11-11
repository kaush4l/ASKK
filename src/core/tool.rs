//! # Tool
//! Anything invocable: a name, a description, and `invoke(args) -> result`.
//! [`IntoTool`] turns any object into one (closures via [`tool`], engines, scripts).
//! [`Toolbox`] is the set an engine can call; a tool receives it so it can call others.
use crate::core::held::Held;
use super::{Event, Fut};
use serde_json::Value;
use std::{collections::BTreeMap, sync::{Arc, Mutex}};

pub trait Tool: Send + Sync {
    fn name(&self) -> String;
    fn description(&self) -> String;
    /// Argument hint shown to the model (free JSON).
    fn args(&self) -> Value {
        Value::Null
    }
    fn invoke(&self, args: Value, tools: Toolbox) -> Fut<Result<Value, String>>;
}

/// Convert an object into a tool.
pub trait IntoTool {
    fn into_tool(self) -> Arc<dyn Tool>;
}

impl<T: Tool + 'static> IntoTool for T {
    fn into_tool(self) -> Arc<dyn Tool> {
        Arc::new(self)
    }
}

type Action = Arc<dyn Fn(Value) -> Result<Value, String> + Send + Sync>;

/// A tool from a plain function.
pub struct FnTool {
    pub name: String,
    pub description: String,
    pub args: Value,
    pub action: Action,
}

pub fn tool(
    name: &str,
    description: &str,
    args: Value,
    f: impl Fn(Value) -> Result<Value, String> + Send + Sync + 'static,
) -> Arc<dyn Tool> {
    Arc::new(FnTool { name: name.into(), description: description.into(), args, action: Arc::new(f) })
}

impl Tool for FnTool {
    fn name(&self) -> String {
        self.name.clone()
    }
    fn description(&self) -> String {
        self.description.clone()
    }
    fn args(&self) -> Value {
        self.args.clone()
    }
    fn invoke(&self, args: Value, _: Toolbox) -> Fut<Result<Value, String>> {
        let r = (self.action)(args);
        Box::pin(async move { r })
    }
}

/// The tools in reach, plus a log of every call made through it (nested calls included), so
/// the engine can tell its components about calls a script or tool made on its behalf.
#[derive(Clone, Default)]
pub struct Toolbox(pub Arc<BTreeMap<String, Arc<dyn Tool>>>, pub Option<Arc<Mutex<Vec<Event>>>>);

impl Toolbox {
    pub fn new(list: impl IntoIterator<Item = Arc<dyn Tool>>) -> Self {
        Self(Arc::new(list.into_iter().map(|t| (t.name(), t)).collect()), None)
    }
    /// Start recording calls.
    pub fn logged(mut self) -> Self {
        self.1 = Some(Arc::default());
        self
    }
    /// Take the calls recorded so far, in completion order (inner calls first).
    pub fn drain(&self) -> Vec<Event> {
        self.1.as_ref().map(|l| std::mem::take(&mut *l.held())).unwrap_or_default()
    }
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn names(&self) -> Vec<String> {
        self.0.keys().cloned().collect()
    }
    pub async fn call(&self, name: &str, args: Value) -> Result<Value, String> {
        let r = match self.0.get(name).cloned() {
            Some(t) => t.invoke(args.clone(), self.clone()).await,
            None => Err(format!("no tool '{name}'")),
        };
        if let Some(log) = &self.1 {
            let result = match &r {
                Ok(v) => text(v),
                Err(e) => format!("error: {e}"),
            };
            log.held().push(Event::Called { tool: name.into(), args, result });
        }
        r
    }
    /// The `## tools` prompt section; nothing when empty.
    pub fn describe(&self) -> Option<String> {
        if self.0.is_empty() {
            return None;
        }
        Some(
            self.0
                .values()
                .map(|t| format!("- {} — {}", sig(&t.name(), &t.args()), t.description()))
                .collect::<Vec<_>>()
                .join("\n"),
        )
    }
}

/// A result as text for the model and history.
pub fn text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        v => v.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn add() -> Arc<dyn Tool> {
        tool("add", "sum", json!({"a": "number", "b": "number"}), |a| {
            Ok(json!(a["a"].as_f64().ok_or("a missing")? + a["b"].as_f64().ok_or("b missing")?))
        })
    }

    #[tokio::test]
    async fn a_tool_is_named_described_and_invocable() {
        let tb = Toolbox::new([add()]);
        assert_eq!(tb.call("add", json!({"a": 2, "b": 3})).await.unwrap(), json!(5.0));
        assert_eq!(tb.call("add", json!({})).await.unwrap_err(), "a missing");
        assert_eq!(tb.call("nope", json!({})).await.unwrap_err(), "no tool 'nope'");
        assert!(tb.describe().unwrap().contains("- add(a: number, b: number) — sum"));
        assert!(Toolbox::default().describe().is_none());
    }

    #[tokio::test]
    async fn a_logged_toolbox_records_nested_calls_inner_first() {
        struct Outer;
        impl Tool for Outer {
            fn name(&self) -> String { "outer".into() }
            fn description(&self) -> String { "calls add".into() }
            fn invoke(&self, _: Value, tb: Toolbox) -> Fut<Result<Value, String>> {
                Box::pin(async move { tb.call("add", json!({"a": 1, "b": 1})).await })
            }
        }
        let tb = Toolbox::new([add(), Outer.into_tool()]).logged();
        tb.call("outer", json!({})).await.unwrap();
        let tools: Vec<String> = tb.drain().into_iter().map(|e| match e { Event::Called { tool, .. } => tool, _ => String::new() }).collect();
        assert_eq!(tools, ["add", "outer"]);
        assert!(tb.drain().is_empty());
    }
}

/// A tool as a signature: `read_file(path: text)`; free-form hints stay as given.
pub fn sig(name: &str, args: &Value) -> String {
    match args {
        Value::Null => format!("{name}()"),
        Value::Object(m) => {
            let parts: Vec<String> = m.iter().map(|(k, v)| format!("{k}: {}", v.as_str().map(String::from).unwrap_or_else(|| v.to_string()))).collect();
            format!("{name}({})", parts.join(", "))
        }
        a => format!("{name}({a})"),
    }
}

/// A call as written in a reply: `read_file(path: "a.rs")`, values as JSON.
pub fn call_sig(name: &str, args: &Value) -> String {
    match args {
        Value::Null => format!("{name}()"),
        Value::Object(m) => format!("{name}({})", m.iter().map(|(k, v)| format!("{k}: {v}")).collect::<Vec<_>>().join(", ")),
        a => format!("{name}({a})"),
    }
}
