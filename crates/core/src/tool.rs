//! One tool trait, MCP-shaped specs, ToolSet = allowlist (ADR-004).
//! Tools never panic into the loop; failures are `ToolResult { ok: false }`.

use std::collections::BTreeMap;
use std::rc::Rc;

use futures::future::LocalBoxFuture;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Pure tools run freely; Mutating tools route through the action gate (ADR-006).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Effect {
    Pure,
    Mutating,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    /// JSON Schema; structured args from day one.
    pub input_schema: Value,
    pub effect: Effect,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolResult {
    pub ok: bool,
    pub content: String,
}

impl ToolResult {
    pub fn ok(content: impl Into<String>) -> Self {
        Self {
            ok: true,
            content: content.into(),
        }
    }

    pub fn err(content: impl Into<String>) -> Self {
        Self {
            ok: false,
            content: content.into(),
        }
    }
}

/// The explicit state slices a tool declared — no shared mutable world
/// (ADR-005). The runtime extends this via composition, not inheritance.
#[derive(Debug, Default)]
pub struct ToolCtx {
    /// Dry-run: the tool reports what it *would* do instead of doing it.
    pub dry_run: bool,
    slices: BTreeMap<String, Value>,
}

impl ToolCtx {
    pub fn slice(&self, name: &str) -> Option<&Value> {
        self.slices.get(name)
    }

    pub fn set_slice(&mut self, name: impl Into<String>, value: Value) {
        self.slices.insert(name.into(), value);
    }
}

/// Dyn-safe: browser is single-threaded, so no Send bounds and Rc is fine.
pub trait Tool {
    fn spec(&self) -> &ToolSpec;
    fn call<'a>(&'a self, args: Value, ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult>;
}

/// Name-keyed, insertion-ordered. Membership IS the allowlist.
#[derive(Default, Clone)]
pub struct ToolSet {
    tools: Vec<Rc<dyn Tool>>,
}

impl ToolSet {
    pub fn new() -> Self {
        Self::default()
    }

    /// Last-wins: reinserting a name replaces the earlier tool in place.
    pub fn insert(&mut self, tool: Rc<dyn Tool>) {
        let name = tool.spec().name.clone();
        if let Some(slot) = self.tools.iter_mut().find(|t| t.spec().name == name) {
            *slot = tool;
        } else {
            self.tools.push(tool);
        }
    }

    pub fn contains(&self, name: &str) -> bool {
        self.tools.iter().any(|t| t.spec().name == name)
    }

    pub fn get(&self, name: &str) -> Option<&Rc<dyn Tool>> {
        self.tools.iter().find(|t| t.spec().name == name)
    }

    /// What the model is shown (⊆ the dispatch allowlist).
    pub fn specs(&self) -> Vec<ToolSpec> {
        self.tools.iter().map(|t| t.spec().clone()).collect()
    }

    pub fn len(&self) -> usize {
        self.tools.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::executor::block_on;
    use serde_json::json;

    struct Echo {
        spec: ToolSpec,
    }

    impl Echo {
        fn named(name: &str, description: &str) -> Rc<dyn Tool> {
            Rc::new(Self {
                spec: ToolSpec {
                    name: name.into(),
                    description: description.into(),
                    input_schema: json!({"type": "object"}),
                    effect: Effect::Pure,
                },
            })
        }
    }

    impl Tool for Echo {
        fn spec(&self) -> &ToolSpec {
            &self.spec
        }

        fn call<'a>(&'a self, args: Value, ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
            Box::pin(async move {
                if ctx.dry_run {
                    ToolResult::ok("would echo")
                } else {
                    ToolResult::ok(args.to_string())
                }
            })
        }
    }

    #[test]
    fn membership_is_the_allowlist() {
        let mut set = ToolSet::new();
        set.insert(Echo::named("echo", "repeats"));
        assert!(set.contains("echo"));
        assert!(!set.contains("rm_rf")); // not in the set = not allowed
        assert!(set.get("rm_rf").is_none());
    }

    #[test]
    fn last_wins_reinsert_keeps_order() {
        let mut set = ToolSet::new();
        set.insert(Echo::named("a", "first"));
        set.insert(Echo::named("b", "second"));
        set.insert(Echo::named("a", "replaced"));
        assert_eq!(set.len(), 2);
        let specs = set.specs();
        assert_eq!(specs[0].name, "a");
        assert_eq!(specs[0].description, "replaced");
        assert_eq!(specs[1].name, "b");
    }

    #[test]
    fn call_and_dry_run_via_ctx() {
        let mut set = ToolSet::new();
        set.insert(Echo::named("echo", "repeats"));
        let tool = set.get("echo").unwrap().clone();
        let mut ctx = ToolCtx::default();
        let out = block_on(tool.call(json!({"x": 1}), &mut ctx));
        assert!(out.ok);
        assert_eq!(out.content, "{\"x\":1}");
        ctx.dry_run = true;
        let out = block_on(tool.call(json!({}), &mut ctx));
        assert_eq!(out.content, "would echo");
    }

    #[test]
    fn ctx_holds_named_state_slices() {
        let mut ctx = ToolCtx::default();
        assert!(ctx.slice("cwd").is_none());
        ctx.set_slice("cwd", json!("/tmp"));
        assert_eq!(ctx.slice("cwd"), Some(&json!("/tmp")));
    }
}
