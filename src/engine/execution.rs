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

    /// The compiled descriptor for `name`, if it is a built-in. The shell uses
    /// it to build a paradigm-tagged `core::RustTool` that wraps the real
    /// handler, so the run's `ToolSet` dispatches compiled tools directly.
    pub fn compiled_descriptor(&self, name: &str) -> Option<crate::tools::ToolDescriptor> {
        self.tools.descriptor(name)
    }

    pub async fn execute_domain_tool(
        &self,
        snapshot: &mut AppSnapshot,
        call_id: String,
        tool_name: &str,
        args: Value,
    ) -> ToolResult {
        // MCP-backed tools route to their live server's client; agent tools route
        // through `call_agent`; everything else is a compiled built-in. These are
        // the seams where the three tool sources join the normal execution path
        // (the engine instruments them all identically). MCP display names and
        // agent-tool names are assigned to never collide, so the order here is not
        // load-bearing.
        #[cfg(target_arch = "wasm32")]
        if crate::mcp::registry::is_mcp_tool(tool_name) {
            return crate::mcp::registry::call_tool(call_id, tool_name, args).await;
        }
        if let Some(agent_id) = crate::tools::agent_tools::resolve(snapshot, tool_name) {
            return crate::tools::agent_tools::call(snapshot, call_id, &agent_id, &args).await;
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
