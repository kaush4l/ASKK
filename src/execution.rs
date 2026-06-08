//! Capability pillar (one of the four core types: Engine, Tool, Provider,
//! **Capability**) — the browser-safe execution backend.
//!
//! A capability is what the platform can actually do. Here it is one job: dispatch a
//! compiled (or MCP-backed) tool and hand back its result. In the browser, execution
//! stays in the tab — tools run in-process or in a Web Worker (see `browser_exec`),
//! never on a required server. [`ExecutionProvider`] is the trait the loop depends on;
//! [`BrowserExecutionProvider`] is the implementation. A new backend is a new `impl`,
//! never a loop edit.

use crate::state::{AppSnapshot, ToolResult, ToolSpec};
use crate::tools::ToolRegistry;
use serde_json::Value;

/// The capability seam: which tools an agent may call. The loop asks for specs and
/// runs tools by name; it never matches on a specific tool.
pub trait ExecutionProvider {
    fn domain_specs_for_agent(&self, enabled_tools: &[String]) -> Vec<ToolSpec>;
}

#[derive(Clone, Debug, Default)]
pub struct BrowserExecutionProvider {
    tools: ToolRegistry,
}

impl BrowserExecutionProvider {
    pub fn new() -> Self {
        Self {
            tools: ToolRegistry::new(),
        }
    }

    pub async fn execute_domain_tool(
        &self,
        snapshot: &mut AppSnapshot,
        call_id: String,
        tool_name: &str,
        args: Value,
    ) -> ToolResult {
        // MCP-backed tools route to their live server's client; everything else is a
        // compiled built-in. This is the one seam where MCP tool calls join the
        // normal execution path (the engine instruments them identically).
        #[cfg(target_arch = "wasm32")]
        if crate::mcp::registry::is_mcp_tool(tool_name) {
            return crate::mcp::registry::call_tool(call_id, tool_name, args).await;
        }
        self.tools.execute(snapshot, call_id, tool_name, args).await
    }
}

impl ExecutionProvider for BrowserExecutionProvider {
    fn domain_specs_for_agent(&self, enabled_tools: &[String]) -> Vec<ToolSpec> {
        let specs = self.tools.specs_for_agent(enabled_tools);
        // Live MCP tools (discovered at run start) are offered to the model alongside
        // the compiled built-ins, filtered by the same allowlist.
        #[cfg(target_arch = "wasm32")]
        let specs = {
            let mut specs = specs;
            specs.extend(crate::mcp::registry::specs_for_agent(enabled_tools));
            specs
        };
        specs
    }
}
