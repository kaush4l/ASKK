//! The Tool pillar as a *composition contract* — [`Tool`] — and the one set
//! that maintains every tool an engine can call — [`ToolSet`].
//!
//! A tool is the only part of the system that needs an *environment* to run: a
//! compiled Rust function needs nothing, a JavaScript body needs the browser JS
//! runtime, an MCP tool needs a live server process/worker, a connector needs a
//! hosted MCP endpoint. The contract makes that uniform: whatever the paradigm,
//! a tool advertises a [`ToolSpec`] (what the model is told it can call) and
//! exposes one [`Tool::call`] (how it actually runs). The engine loop holds a
//! [`ToolSet`] of `Rc<dyn Tool>` and dispatches **polymorphically** — it never
//! matches on a tool's kind. Choosing which concrete [`Tool`] backs a name is a
//! *construction-time* decision made once when the set is assembled (the shell's
//! `build_tool_set`), not a branch in the hot path.
//!
//! This keeps the invariants intact: adding a paradigm is one `impl Tool`
//! (invariant 2, polymorphism by trait), the set membership *is* the allowlist
//! gate (invariant 7), and the module stays platform-free — the platform-bound
//! impls (`JsTool`, `McpTool`, `AgentTool`) live above the core, behind this
//! trait, so `core` still compiles with no web/I/O knowledge (invariant 5).

use std::rc::Rc;

use serde_json::Value;

use crate::state::{AppSnapshot, ToolSpec};

use super::tooling::{ToolBinding, ToolFuture};

/// Which execution paradigm backs a tool. A pure tag carried by every
/// [`Tool`], so the set, the UI, and diagnostics can describe a tool's nature
/// without downcasting. The dispatch path never reads it — it exists for
/// introspection and to make the taxonomy in the user's mental model explicit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolParadigm {
    /// A compiled Rust function — the built-ins. No environment.
    RustFn,
    /// A JavaScript function body, run in the browser JS runtime.
    Js,
    /// A tool served by a live MCP server (worker or in-process).
    Mcp,
    /// An MCP tool reached through a hosted connector configuration.
    Connector,
    /// A peer agent exposed as a callable (delegation).
    Agent,
}

impl ToolParadigm {
    /// A short stable label for events, logs, and UI.
    pub fn label(self) -> &'static str {
        match self {
            ToolParadigm::RustFn => "rust",
            ToolParadigm::Js => "js",
            ToolParadigm::Mcp => "mcp",
            ToolParadigm::Connector => "connector",
            ToolParadigm::Agent => "agent",
        }
    }
}

/// The composition contract every tool paradigm satisfies. Object-safe so a set
/// can hold `Rc<dyn Tool>` of mixed paradigms; the `async`-shaped [`Tool::call`]
/// returns a boxed future for the same reason [`super::LocalInference`] does
/// (`async fn` is not object-safe).
pub trait Tool {
    /// What the model is told it can call: name, description, input schema. This
    /// is the surface injected into the prompt/tool manifest.
    fn spec(&self) -> &ToolSpec;

    /// Which paradigm backs this tool.
    fn paradigm(&self) -> ToolParadigm;

    /// Run the tool. `snapshot` is the shared mutable world; `args` is the
    /// model's untrusted input. Returns the result *body* on success or an error
    /// string on failure — the engine wraps it in the `ToolResult` envelope and
    /// assigns the call id, so the contract here stays minimal.
    fn call<'a>(&'a self, snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a>;

    /// The tool's name — its key in the [`ToolSet`] and its allowlist token.
    fn name(&self) -> &str {
        self.spec().name.as_str()
    }
}

/// A tool whose body is a plain Rust callable — the compiled built-ins and any
/// closure the shell binds at construction. Pure and platform-free, so it lives
/// in `core`; the environment-bound paradigms (`Js`, `Mcp`, `Connector`,
/// `Agent`) implement [`Tool`] from their own crates.
pub struct RustTool {
    spec: ToolSpec,
    call: ToolBinding,
}

impl RustTool {
    /// Pair an advertised [`ToolSpec`] with the callable that runs it.
    pub fn new(spec: ToolSpec, call: ToolBinding) -> Self {
        Self { spec, call }
    }
}

impl Tool for RustTool {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn paradigm(&self) -> ToolParadigm {
        ToolParadigm::RustFn
    }

    fn call<'a>(&'a self, snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
        (self.call)(snapshot, args)
    }
}

/// The set of tools an engine may call, keyed by name in insertion order. This
/// is the single maintained collection the user's design centers on: the shell
/// assembles it once per run (compiled built-ins, plus whatever MCP servers it
/// brought up, plus peer-agent delegations), and the loop reads it three ways —
/// `specs` to tell the model, `contains` to gate, `get(...).call(...)` to run.
///
/// `Rc<dyn Tool>` because the engine and in-flight call futures share entries on
/// the one browser event loop (no `Send` — WASM is single-threaded).
#[derive(Clone, Default)]
pub struct ToolSet {
    tools: Vec<Rc<dyn Tool>>,
}

impl ToolSet {
    /// Add a tool. Re-inserting an existing name replaces it (last wins) and
    /// moves it to the end — matching the legacy tool map's rebind semantics.
    pub fn insert(&mut self, tool: Rc<dyn Tool>) {
        let name = tool.name().to_string();
        self.tools.retain(|existing| existing.name() != name);
        self.tools.push(tool);
    }

    /// Bind `name` to a bare callable, wrapping it as a [`RustTool`] with a
    /// minimal spec. A convenience for call sites that have only a closure (the
    /// allowlist reification path and tests); paradigm-aware callers build the
    /// concrete [`Tool`] and use [`ToolSet::insert`] instead.
    pub fn bind(&mut self, name: impl Into<String>, call: ToolBinding) {
        let name = name.into();
        let spec = ToolSpec {
            name: name.clone(),
            description: String::new(),
            // Empty object, not null: if a shim-bound entry ever reaches
            // `ToolSet::specs()`, an `{}` schema is valid for every model API.
            input_schema: serde_json::json!({}),
        };
        self.insert(Rc::new(RustTool::new(spec, call)));
    }

    /// Whether `name` is in the set — the allowlist check.
    pub fn contains(&self, name: &str) -> bool {
        self.tools.iter().any(|tool| tool.name() == name)
    }

    /// The tool bound to `name`, if any.
    pub fn get(&self, name: &str) -> Option<&Rc<dyn Tool>> {
        self.tools.iter().find(|tool| tool.name() == name)
    }

    /// Every tool's name, in insertion order — the allowlist view used to render
    /// a helpful rejection message.
    pub fn names(&self) -> Vec<String> {
        self.tools
            .iter()
            .map(|tool| tool.name().to_string())
            .collect()
    }

    /// Every tool's advertised spec, in insertion order — the manifest the model
    /// is shown.
    pub fn specs(&self) -> Vec<ToolSpec> {
        self.tools.iter().map(|tool| tool.spec().clone()).collect()
    }

    /// The paradigm backing `name`, if present — for diagnostics and UI.
    pub fn paradigm(&self, name: &str) -> Option<ToolParadigm> {
        self.get(name).map(|tool| tool.paradigm())
    }

    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }

    pub fn len(&self) -> usize {
        self.tools.len()
    }
}

impl std::fmt::Debug for ToolSet {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ToolSet")
            .field("names", &self.names())
            .finish_non_exhaustive()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn echo(name: &str) -> Rc<dyn Tool> {
        let spec = ToolSpec {
            name: name.to_string(),
            description: format!("echoes for {name}"),
            input_schema: json!({"type": "object"}),
        };
        Rc::new(RustTool::new(
            spec,
            Rc::new(|_snapshot: &mut AppSnapshot, args: &Value| {
                let echoed = args
                    .get("value")
                    .and_then(Value::as_str)
                    .unwrap_or("nil")
                    .to_string();
                Box::pin(async move { Ok(format!("echo:{echoed}")) }) as ToolFuture<'_>
            }),
        ))
    }

    #[test]
    fn insert_is_last_wins_and_moves_to_end() {
        let mut set = ToolSet::default();
        set.insert(echo("a"));
        set.insert(echo("b"));
        set.insert(echo("a"));

        assert_eq!(set.names(), vec!["b".to_string(), "a".to_string()]);
        assert_eq!(set.len(), 2);
        assert!(set.contains("a") && set.contains("b") && !set.contains("c"));
    }

    #[test]
    fn specs_and_paradigm_are_exposed_for_injection_and_introspection() {
        let mut set = ToolSet::default();
        set.insert(echo("search"));

        let specs = set.specs();
        assert_eq!(specs.len(), 1);
        assert_eq!(specs[0].name, "search");
        assert_eq!(specs[0].description, "echoes for search");
        assert_eq!(set.paradigm("search"), Some(ToolParadigm::RustFn));
        assert_eq!(set.paradigm("missing"), None);
    }

    #[test]
    fn get_then_call_runs_the_tool_polymorphically() {
        let mut set = ToolSet::default();
        set.insert(echo("e"));
        let tool = set.get("e").expect("bound");

        let mut snapshot = AppSnapshot::default();
        let out = pollster::block_on(tool.call(&mut snapshot, &json!({"value": "hi"})));
        assert_eq!(out.unwrap(), "echo:hi");
    }

    #[test]
    fn bind_shim_wraps_a_bare_callable_as_a_rust_tool() {
        let mut set = ToolSet::default();
        set.bind(
            "shimmed",
            Rc::new(|_s, _a| Box::pin(async { Ok("ok".to_string()) })),
        );
        assert_eq!(set.paradigm("shimmed"), Some(ToolParadigm::RustFn));
        let mut snapshot = AppSnapshot::default();
        let out =
            pollster::block_on(set.get("shimmed").unwrap().call(&mut snapshot, &Value::Null));
        assert_eq!(out.unwrap(), "ok");
    }
}
