//! # Core: the one contract every component follows
//!
//! A component is **defined behaviour + configuration + state + UI**:
//!
//! | part | method | meaning |
//! | --- | --- | --- |
//! | identity | `kind()`, `name()`, `doc()` | what it is; `doc` is its self-contained documentation |
//! | init | `new(Spec)` (registered in [`KINDS`]) | read `config` (behaviour knobs, e.g. `format: toon`) and `state` (runtime data) |
//! | lifecycle | `on(&Event)` | react to engine events; the only way state changes |
//! | persistence | `config()`, `state()` → [`Spec`] | written back to its file, so a restart resumes |
//! | prompt | `prompt()` | its section of the prompt, or nothing |
//! | UI | `view()` → [`Node`] | its UI as data, drawn by fixed primitives |
//! | roles | `tools()`, `selects()`, `allows()`, `parse()`, `refresh()`, `watch()`, `wake()` | optional |
//!
//! Until an engine is initialised there are only components (this registry). Everything an
//! engine produces at runtime is data in its folder.
use crate::compose::Node;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::{future::Future, pin::Pin, sync::Arc};

#[cfg(feature = "server")]
pub mod boot;
pub mod engine;
pub mod tool;

pub use engine::{Engine, EngineFile};
pub use tool::{text, tool, IntoTool, Tool, Toolbox};

pub type Fut<T> = Pin<Box<dyn Future<Output = T> + Send>>;

/// The file form of every component: `elements/<name>.json`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Spec {
    pub kind: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub config: Value,
    #[serde(default)]
    pub state: Value,
}

/// What happens to an engine; components react in `on`.
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    Input(String),
    Reply(String),
    Called { tool: String, args: Value, result: String },
    Snapshot { name: String, content: String },
    Observed { name: String, value: f64 },
    /// Context was folded into this summary (refocus).
    Folded(String),
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Call {
    pub tool: String,
    #[serde(default)]
    pub args: Value,
}

/// A parsed model reply: calls to run and/or a final answer.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Reply {
    pub calls: Vec<Call>,
    pub answer: Option<String>,
    /// Continue after the first call finishes instead of all (`await: any`); the rest are cancelled.
    pub wait_any: bool,
}

/// Something to poll: run `source` every `every_ms`, feed the number back as `Observed`.
#[derive(Clone, Debug, PartialEq)]
pub struct Watch {
    pub name: String,
    pub every_ms: u64,
    pub source: Call,
}

pub trait Component: Send + Sync {
    fn kind(&self) -> &'static str;
    fn name(&self) -> &str;
    fn doc(&self) -> &'static str;
    fn config(&self) -> Value;
    fn state(&self) -> Value;
    fn view(&self) -> Node;
    fn on(&mut self, _ev: &Event) {}
    fn prompt(&self) -> Option<String> {
        None
    }
    /// Tools this component contributes (set_phase, a script, …).
    fn tools(&self) -> Vec<Arc<dyn Tool>> {
        vec![]
    }
    /// Whether a shared (global) tool is selected for this engine.
    fn selects(&self, _tool: &str) -> bool {
        false
    }
    /// Veto any tool right now (phase gating).
    fn allows(&self, _tool: &str) -> bool {
        true
    }
    /// Turn a model reply into calls/answer (the response component).
    fn parse(&self, _reply: &str) -> Option<Reply> {
        None
    }
    /// A call whose result becomes this component's snapshot before each step (live artifact).
    fn refresh(&self) -> Option<Call> {
        None
    }
    fn watch(&self) -> Option<Watch> {
        None
    }
    /// Input to wake the engine with, if an observation fired (alert).
    fn wake(&mut self) -> Option<String> {
        None
    }
    fn spec(&self) -> Spec {
        Spec { kind: self.kind().into(), name: self.name().into(), config: self.config(), state: self.state() }
    }
}

/// Model access, implemented once per runtime (HTTP APIs, CLIs, test fakes).
pub trait Infer: Send + Sync {
    fn complete(&self, model: &str, prompt: String) -> Fut<Result<String, String>>;
}

/// Read a config/state value into `T`; null means `T::default()`.
pub fn read<T: DeserializeOwned + Default>(v: &Value) -> Result<T, String> {
    if v.is_null() {
        Ok(T::default())
    } else {
        serde_json::from_value(v.clone()).map_err(|e| e.to_string())
    }
}

/// Write `T` as a JSON value.
pub fn value<T: Serialize>(t: &T) -> Value {
    serde_json::to_value(t).unwrap_or(Value::Null)
}

pub type Ctor = fn(Spec) -> Result<Box<dyn Component>, String>;

/// Every component kind. Adding a kind = one file in `elements/` + one line here.
pub const KINDS: &[(&str, Ctor)] = &[
    ("phase", crate::elements::phase::new),
    ("response", crate::elements::response::new),
    ("tools", crate::elements::tools::new),
    ("history", crate::elements::history::new),
    ("state", crate::elements::state::new),
    ("artifact", crate::elements::artifact::new),
    ("alert", crate::elements::alert::new),
    ("script", crate::elements::script::new),
];

pub fn build(spec: Spec) -> Result<Box<dyn Component>, String> {
    let kind = spec.kind.clone();
    let ctor = KINDS.iter().find(|(k, _)| *k == kind).ok_or_else(|| format!("unknown kind '{kind}'"))?.1;
    ctor(spec).map_err(|e| format!("{kind}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The abstract contract, checked for every registered kind: builds from an empty spec,
    /// documents itself, round-trips its spec, reacts to events, renders a view, and its state
    /// survives a rebuild (restart).
    #[test]
    fn every_kind_obeys_the_contract() {
        for (kind, _) in KINDS {
            let mut c = build(Spec { kind: kind.to_string(), name: "x".into(), ..Default::default() })
                .unwrap_or_else(|e| panic!("{kind} must build from an empty config: {e}"));
            assert_eq!(c.kind(), *kind);
            assert_eq!(c.name(), "x");
            assert!(!c.doc().is_empty(), "{kind} needs docs");
            assert_eq!(build(c.spec()).unwrap().spec(), c.spec(), "{kind} spec must round-trip");
            for ev in [
                Event::Input("hi".into()),
                Event::Reply("ok".into()),
                Event::Called { tool: "t".into(), args: json!({}), result: "r".into() },
                Event::Observed { name: "x".into(), value: 1.0 },
                Event::Folded("summary".into()),
            ] {
                c.on(&ev);
            }
            let _ = c.view();
            assert_eq!(build(c.spec()).unwrap().spec(), c.spec(), "{kind} state must survive a restart");
        }
    }

    #[test]
    fn unknown_kind_is_an_error() {
        assert!(build(Spec { kind: "nope".into(), ..Default::default() }).is_err());
    }
}
