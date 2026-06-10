//! The tool map — name → callable, the reference's `_build_tools_map` in Rust.
//!
//! A [`ToolBinding`] is an owned async callable from `(snapshot, args)` to a
//! result string: the closure generalization of `crate::tools::ToolHandler` (a
//! plain `fn` pointer). Bindings capture their route at bind time — a compiled
//! tool, an MCP tool, and a sub-agent delegation are all just entries in the
//! [`ToolMap`], indistinguishable to the loop. Sub-agent wrapping therefore
//! happens at bind time in the shell; the core treats delegation as an ordinary
//! callable.
//!
//! Membership IS the allowlist: a name absent from the map is rejected with a
//! structured [`ToolResult`] before anything executes, preserving the single
//! visible approval gate.

use crate::state::{AppResult, AppSnapshot, ToolResult};
use serde_json::Value;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;

/// Boxed future a tool binding returns. Same shape as `crate::tools::ToolFuture`,
/// re-declared here so the core stays self-contained.
pub type ToolFuture<'a> = Pin<Box<dyn Future<Output = AppResult<String>> + 'a>>;

/// A bound tool: an owned async callable from `(snapshot, args)` to a result.
/// `Rc` because the engine and in-flight call futures share it on the one
/// browser event loop (no `Send` — WASM is single-threaded).
pub type ToolBinding = Rc<dyn for<'a> Fn(&'a mut AppSnapshot, &'a Value) -> ToolFuture<'a>>;

/// The tools an engine may call, keyed by name, in insertion order.
#[derive(Clone, Default)]
pub struct ToolMap {
    entries: Vec<(String, ToolBinding)>,
}

impl ToolMap {
    /// Bind `name` to a callable. Rebinding an existing name replaces it (last
    /// bind wins), mirroring `ToolRegistry::register`.
    pub fn bind(&mut self, name: impl Into<String>, binding: ToolBinding) {
        let name = name.into();
        self.entries.retain(|(existing, _)| existing != &name);
        self.entries.push((name, binding));
    }

    /// Whether `name` is bound — the allowlist check.
    pub fn contains(&self, name: &str) -> bool {
        self.entries.iter().any(|(bound, _)| bound == name)
    }

    /// The binding for `name`, if bound.
    pub fn get(&self, name: &str) -> Option<&ToolBinding> {
        self.entries
            .iter()
            .find(|(bound, _)| bound == name)
            .map(|(_, binding)| binding)
    }

    /// All bound names, in insertion order — the allowlist view used to render
    /// a helpful rejection message.
    pub fn names(&self) -> Vec<String> {
        self.entries.iter().map(|(name, _)| name.clone()).collect()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }
}

impl std::fmt::Debug for ToolMap {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ToolMap")
            .field("names", &self.names())
            .finish_non_exhaustive()
    }
}

/// The result for a call whose tool is not in the map. A disallowed call still
/// produces a well-formed, ordered [`ToolResult`] the engine can surface as
/// feedback to the model. Same model-visible message as the engine shell's
/// dispatcher renders today.
pub fn disallowed_tool_result(call_id: &str, tool_name: &str, allowed: &[String]) -> ToolResult {
    let allowlist = if allowed.is_empty() {
        "<empty>".to_string()
    } else {
        allowed.join(", ")
    };
    ToolResult {
        call_id: call_id.to_string(),
        ok: false,
        content: format!(
            "Tool `{tool_name}` is not in this agent's tool allowlist. Allowed tools: {allowlist}."
        ),
    }
}
