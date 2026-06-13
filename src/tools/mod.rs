//! Tool pillar (one of the four core types: Engine, **Tool**, Provider, Capability).
//!
//! A tool is an MCP-shaped object: [`ToolSpec`] is `{ name, description,
//! input_schema }` (the same fields an MCP tool advertises) and every call returns
//! a [`ToolResult`] `{ ok, content }`. Tools are pre-compiled into the WASM harness
//! and registered in [`ToolRegistry`]; adding one is a single `register(...)` call,
//! never an edit to the agent loop.
//!
//! **One tool = one module.** Each built-in lives in its own file and exports a
//! `descriptor() -> ToolDescriptor` (the documented contract in
//! `docs/extensibility.md`). When a specific tool misbehaves, its spec and handler
//! are in one place — e.g. `tools/web_search.rs` — never scattered across this file.
//! Cross-tool plumbing is factored out: HTTP/URL helpers in [`http`], the local
//! bridge transport in [`bridge`], and pure argument helpers in [`common`].

use crate::state::{AppResult, AppSnapshot, ToolResult, ToolSpec};
use serde_json::Value;
use std::future::Future;
use std::pin::Pin;

/// Peer agents exposed as named tools (`agent_<slug>`), routed through
/// `call_agent`. Consumed by the engine (allowlist/specs) and the execution
/// provider (call routing) — not registered in the compiled-tool table because the
/// set is derived from the snapshot's agents, not fixed at compile time.
pub(crate) mod agent_tools;
mod bridge;
mod call_agent;
mod camera_capture;
mod clipboard;
mod common;
mod device_info;
mod file_edit;
mod file_vfs;
mod fs_bridge;
mod geolocate;
pub(crate) mod google;
mod http;
mod mic_record;
mod notify_user;
mod run_command;
mod run_in_sandbox;
mod run_js;
mod run_python;
mod schedule_tool;
mod screen_capture;
mod search;
mod speak_text;
mod telegram;
mod transcribe_audio;
mod web_fetch;
mod web_search;

// Public tool-module surface used elsewhere in the crate. The Workspace page drives
// the local bridge directly; the Tools page runs a web_search probe.
pub use bridge::{bridge_fs_list, bridge_fs_read, bridge_fs_write, bridge_run_command};
pub use web_search::web_search_with_config;

/// Boxed future a tool handler returns. Pinned because handlers are stored as plain
/// `fn` pointers in the registry (see [`ToolHandler`]).
pub type ToolFuture<'a> = Pin<Box<dyn Future<Output = AppResult<String>> + 'a>>;

/// A tool handler: a pure `fn` pointer from `(snapshot, args)` to a result future.
/// Using a function pointer (not a boxed trait object) keeps the registry `Clone`
/// and `Debug` and makes each tool a free function in its own module.
pub type ToolHandler = for<'a> fn(&'a mut AppSnapshot, &'a Value) -> ToolFuture<'a>;

/// The advertised spec plus the handler that runs it. Built by each tool module's
/// `descriptor()`.
#[derive(Clone)]
pub struct ToolDescriptor {
    pub spec: ToolSpec,
    pub handler: ToolHandler,
}

impl std::fmt::Debug for ToolDescriptor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ToolDescriptor")
            .field("spec", &self.spec)
            .finish_non_exhaustive()
    }
}

/// The set of compiled tools available to the harness. The loop only asks it for
/// specs (`specs_for_agent`) and runs a call by name (`execute`); it never contains
/// a per-tool match.
#[derive(Clone, Debug, Default)]
pub struct ToolRegistry {
    descriptors: Vec<ToolDescriptor>,
}

impl ToolRegistry {
    pub fn empty() -> Self {
        Self {
            descriptors: Vec::new(),
        }
    }

    pub fn new() -> Self {
        let mut registry = Self::empty();
        register_builtin_tools(&mut registry);
        registry
    }

    pub fn register(&mut self, descriptor: ToolDescriptor) {
        self.descriptors
            .retain(|existing| existing.spec.name != descriptor.spec.name);
        self.descriptors.push(descriptor);
    }

    /// The descriptor (spec + handler) registered under `name`, if any. The
    /// shell uses this to assemble the run's `ToolSet`: a compiled built-in
    /// becomes a `core::RustTool` wrapping its real handler, so the dispatch
    /// runs the function directly rather than matching the name again.
    pub fn descriptor(&self, name: &str) -> Option<ToolDescriptor> {
        self.descriptors
            .iter()
            .find(|descriptor| descriptor.spec.name == name)
            .cloned()
    }

    pub fn specs_for_agent(&self, enabled_tools: &[String]) -> Vec<ToolSpec> {
        self.descriptors
            .iter()
            .filter(|descriptor| {
                enabled_tools
                    .iter()
                    .any(|enabled| enabled == &descriptor.spec.name)
            })
            .map(|descriptor| descriptor.spec.clone())
            .collect()
    }

    pub async fn execute(
        &self,
        snapshot: &mut AppSnapshot,
        call_id: String,
        tool_name: &str,
        args: Value,
    ) -> ToolResult {
        let result = match self
            .descriptors
            .iter()
            .find(|descriptor| descriptor.spec.name == tool_name)
        {
            Some(descriptor) => (descriptor.handler)(snapshot, &args).await,
            None => Err(format!("Unknown compiled tool: {tool_name}")),
        };

        match result {
            Ok(content) => ToolResult {
                call_id,
                ok: true,
                content,
            },
            Err(content) => ToolResult {
                call_id,
                ok: false,
                content,
            },
        }
    }
}

/// The built-in tool table. Adding a tool is one line here plus its module — the
/// loop, executor, and prompt assembly never change.
fn register_builtin_tools(registry: &mut ToolRegistry) {
    registry.register(run_js::descriptor());
    registry.register(run_python::descriptor());
    registry.register(web_search::descriptor());
    registry.register(web_fetch::descriptor());
    registry.register(run_command::descriptor());
    registry.register(run_in_sandbox::descriptor());
    registry.register(fs_bridge::read_descriptor());
    registry.register(fs_bridge::write_descriptor());
    registry.register(fs_bridge::list_descriptor());
    registry.register(file_vfs::read_descriptor());
    registry.register(file_vfs::write_descriptor());
    registry.register(file_vfs::list_descriptor());
    registry.register(file_edit::descriptor());
    registry.register(call_agent::descriptor());
    registry.register(schedule_tool::descriptor());
    registry.register(google::gmail::descriptor());
    registry.register(google::calendar::descriptor());
    registry.register(telegram::descriptor());
    registry.register(camera_capture::descriptor());
    registry.register(screen_capture::descriptor());
    registry.register(mic_record::descriptor());
    registry.register(geolocate::descriptor());
    registry.register(clipboard::read_descriptor());
    registry.register(clipboard::write_descriptor());
    registry.register(notify_user::descriptor());
    registry.register(speak_text::descriptor());
    registry.register(device_info::descriptor());
    registry.register(transcribe_audio::descriptor());
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn demo_tool_handler<'a>(_snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
        Box::pin(async move {
            Ok(format!(
                "demo:{}",
                args.get("value")
                    .and_then(Value::as_str)
                    .unwrap_or("missing")
            ))
        })
    }

    #[test]
    fn registry_accepts_new_tool_descriptor_without_execute_match_edits() {
        let mut registry = ToolRegistry::empty();
        registry.register(ToolDescriptor {
            spec: ToolSpec {
                name: "demo_tool".to_string(),
                description: "A test-only descriptor-backed tool.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": { "value": { "type": "string" } },
                    "required": ["value"]
                }),
            },
            handler: demo_tool_handler,
        });

        let specs = registry.specs_for_agent(&["demo_tool".to_string()]);
        assert_eq!(specs.len(), 1);
        assert_eq!(specs[0].name, "demo_tool");

        let mut snapshot = AppSnapshot::default();
        let result = pollster::block_on(registry.execute(
            &mut snapshot,
            "call-1".to_string(),
            "demo_tool",
            json!({ "value": "ok" }),
        ));

        assert!(result.ok);
        assert_eq!(result.content, "demo:ok");
    }

    #[test]
    fn default_registry_includes_disk_and_browser_tools() {
        let registry = ToolRegistry::new();
        let all = crate::state::default_tool_names();
        let specs = registry.specs_for_agent(&all);
        let names = specs
            .iter()
            .map(|spec| spec.name.as_str())
            .collect::<Vec<_>>();
        for expected in [
            "run_js",
            "run_python",
            "web_search",
            "web_fetch",
            "run_command",
            "run_in_sandbox",
            "fs_read",
            "fs_write",
            "fs_list",
            "file_read",
            "file_write",
            "file_list",
            "file_edit",
        ] {
            assert!(names.contains(&expected), "missing tool: {expected}");
        }
    }

    #[test]
    fn run_in_sandbox_descriptor_registers_and_executes_via_the_seam() {
        // The execution-capability seam wires end to end: the registered
        // descriptor looks up by name and runs through the WASI executor, which
        // rejects a non-wasm command line with a clear, instructive error.
        let registry = ToolRegistry::new();
        let specs = registry.specs_for_agent(&["run_in_sandbox".to_string()]);
        assert_eq!(specs.len(), 1);
        assert_eq!(specs[0].name, "run_in_sandbox");

        let mut snapshot = AppSnapshot::default();
        let result = pollster::block_on(registry.execute(
            &mut snapshot,
            "call-sandbox".to_string(),
            "run_in_sandbox",
            json!({ "command": "cargo test" }),
        ));
        assert!(!result.ok);
        assert!(result.content.contains(".wasm"));
        assert!(result.content.contains("`cargo`"));
    }
}
