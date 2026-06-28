//! Capability pillar (one of the four core types: Engine, Tool, Provider,
//! **Capability**) — the browser-safe execution backend.
//!
//! A capability is what the platform can actually do. Here it is one job: dispatch a
//! compiled (or MCP-backed) tool and hand back its result. In the browser, execution
//! stays in the tab — tools run in-process or in a Web Worker (see `browser_exec`),
//! never on a required server. [`ExecutionProvider`] is the trait the loop depends on;
//! [`BrowserExecutionProvider`] is the implementation. A new backend is a new `impl`,
//! never a loop edit.

use crate::state::ToolSpec;
use crate::tools::ToolRegistry;

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
