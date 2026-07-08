//! The ONE tool registry (ADR-004). Agents name tools; the registry resolves
//! an allowlist into a `ToolSet` and fails loud on every unknown name.

use std::collections::BTreeMap;
use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;

use askk_core::{Tool, ToolCtx, ToolResult, ToolSet, ToolSpec};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegistryError {
    /// Second registration under an existing name — always a bug.
    DuplicateName(String),
    /// Allowlist names with no registered tool; ALL of them, never silent.
    UnknownTools(Vec<String>),
}

impl fmt::Display for RegistryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RegistryError::DuplicateName(name) => {
                write!(f, "tool '{name}' is already registered")
            }
            RegistryError::UnknownTools(names) => {
                write!(f, "unknown tools: {}", names.join(", "))
            }
        }
    }
}

impl std::error::Error for RegistryError {}

/// Name-keyed store of every tool the harness knows. A run never sees this
/// directly — it gets the `ToolSet` built from its allowlist.
#[derive(Default)]
pub struct ToolRegistry {
    tools: BTreeMap<String, Rc<dyn Tool>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, tool: Rc<dyn Tool>) -> Result<(), RegistryError> {
        let name = tool.spec().name.clone();
        if self.tools.contains_key(&name) {
            return Err(RegistryError::DuplicateName(name));
        }
        self.tools.insert(name, tool);
        Ok(())
    }

    pub fn contains(&self, name: &str) -> bool {
        self.tools.contains_key(name)
    }

    /// Membership of the returned set IS the run's allowlist. Unknown names
    /// are a hard error listing all of them — silent drops forbidden
    /// (ADR-004, ADR-007).
    pub fn build_tool_set(&self, allow: &[String]) -> Result<ToolSet, RegistryError> {
        let unknown: Vec<String> = allow
            .iter()
            .filter(|name| !self.tools.contains_key(*name))
            .cloned()
            .collect();
        if !unknown.is_empty() {
            return Err(RegistryError::UnknownTools(unknown));
        }
        let mut set = ToolSet::new();
        for name in allow {
            set.insert(Rc::clone(&self.tools[name]));
        }
        Ok(set)
    }
}

type ToolFn = dyn Fn(Value, &mut ToolCtx) -> ToolResult;
type ToolFuture<'a> = Pin<Box<dyn Future<Output = ToolResult> + 'a>>;

/// Adapter: a plain Rust closure + spec as a `dyn Tool` (ADR-004's rust-fn
/// paradigm; the tag is inert, dispatch is uniform).
pub struct RustTool {
    spec: ToolSpec,
    f: Box<ToolFn>,
}

impl RustTool {
    /// Named `shared`, not `new`: it hands back the `Rc<dyn Tool>` every
    /// consumer (registry, ToolSet) actually wants.
    pub fn shared(
        spec: ToolSpec,
        f: impl Fn(Value, &mut ToolCtx) -> ToolResult + 'static,
    ) -> Rc<dyn Tool> {
        Rc::new(Self {
            spec,
            f: Box::new(f),
        })
    }
}

impl Tool for RustTool {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, ctx: &'a mut ToolCtx) -> ToolFuture<'a> {
        // Closures are sync; the future is ready on first poll. Never panics
        // into the loop — closures return ToolResult { ok: false } instead.
        Box::pin(async move { (self.f)(args, ctx) })
    }
}

#[cfg(test)]
mod tests {
    use super::super::testutil::block_on;
    use super::*;
    use askk_core::Effect;
    use serde_json::json;

    fn stub(name: &str) -> Rc<dyn Tool> {
        RustTool::shared(
            ToolSpec {
                name: name.into(),
                description: format!("stub {name}"),
                input_schema: json!({"type": "object"}),
                effect: Effect::Pure,
            },
            |args, _ctx| ToolResult::ok(args.to_string()),
        )
    }

    fn allow(names: &[&str]) -> Vec<String> {
        names.iter().map(|n| n.to_string()).collect()
    }

    #[test]
    fn duplicate_name_is_an_error() {
        let mut reg = ToolRegistry::new();
        reg.register(stub("echo")).unwrap();
        let err = reg.register(stub("echo")).unwrap_err();
        assert_eq!(err, RegistryError::DuplicateName("echo".into()));
        assert!(err.to_string().contains("echo"));
    }

    #[test]
    fn unknown_names_error_lists_all_of_them() {
        let mut reg = ToolRegistry::new();
        reg.register(stub("echo")).unwrap();
        let err = reg
            .build_tool_set(&allow(&["echo", "nope", "zilch"]))
            .err()
            .unwrap(); // ToolSet isn't Debug, so no unwrap_err
        assert_eq!(
            err,
            RegistryError::UnknownTools(vec!["nope".into(), "zilch".into()])
        );
        let text = err.to_string();
        assert!(text.contains("nope") && text.contains("zilch"));
    }

    #[test]
    fn allowlist_subset_in_allow_order() {
        let mut reg = ToolRegistry::new();
        for name in ["a", "b", "c"] {
            reg.register(stub(name)).unwrap();
        }
        let set = reg.build_tool_set(&allow(&["c", "a"])).unwrap();
        assert_eq!(set.len(), 2);
        assert!(!set.contains("b")); // not allowed = not in the set
        let specs = set.specs();
        assert_eq!(specs[0].name, "c");
        assert_eq!(specs[1].name, "a");
    }

    #[test]
    fn empty_allowlist_builds_empty_set() {
        let reg = ToolRegistry::new();
        assert!(reg.build_tool_set(&[]).unwrap().is_empty());
    }

    #[test]
    fn rust_tool_exposes_spec_and_calls_closure() {
        let tool = RustTool::shared(
            ToolSpec {
                name: "double".into(),
                description: "doubles n".into(),
                input_schema: json!({"type": "object"}),
                effect: Effect::Pure,
            },
            |args, ctx| {
                if ctx.dry_run {
                    return ToolResult::ok("would double");
                }
                let n = args["n"].as_i64().unwrap_or(0);
                ToolResult::ok((n * 2).to_string())
            },
        );
        assert_eq!(tool.spec().name, "double");
        let mut ctx = ToolCtx::default();
        let out = block_on(tool.call(json!({"n": 21}), &mut ctx));
        assert!(out.ok);
        assert_eq!(out.content, "42");
        ctx.dry_run = true;
        let out = block_on(tool.call(json!({"n": 1}), &mut ctx));
        assert_eq!(out.content, "would double");
    }
}
