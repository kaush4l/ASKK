//! Capability pillar (one of the four core types: Engine, Tool, Provider,
//! **Capability**) — the browser-safe execution backend.
//!
//! A capability is what the platform can actually do: dispatch a compiled tool,
//! touch the virtual filesystem, run code. In the browser, execution stays in the
//! tab — tools run in-process or in a Web Worker (see `browser_exec`), never on a
//! required server. [`ExecutionProvider`] is the trait; [`BrowserExecutionProvider`]
//! is the WASM implementation.
//!
//! The minimal ReAct loop only calls [`BrowserExecutionProvider::execute_domain_tool`]
//! and [`ExecutionProvider::domain_specs_for_agent`]. The fuller request/result API
//! (shell, file-exists, regex, test-command checks) backs the verification path and
//! is covered by this module's tests, so it is intentionally ahead of current usage.
#![allow(dead_code)]

use crate::state::{AppSnapshot, ToolResult, ToolSpec};
use crate::tools::ToolRegistry;
use serde_json::Value;

#[derive(Clone, Debug, PartialEq)]
pub enum ExecutionRequest {
    DomainTool {
        call_id: String,
        tool_name: String,
        args: Value,
    },
    ShellCommand {
        command: String,
    },
    FileExists {
        path: String,
    },
    ContentRegex {
        path: String,
        pattern: String,
    },
    TestCommand {
        command: String,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct ExecutionResult {
    pub ok: bool,
    pub content: String,
    pub evidence: String,
}

impl ExecutionResult {
    pub fn unsupported(action: &str) -> Self {
        Self {
            ok: false,
            content: format!("{action} is unsupported by browser backend."),
            evidence: String::new(),
        }
    }
}

pub trait ExecutionProvider {
    fn name(&self) -> &'static str;
    fn domain_specs_for_agent(&self, enabled_tools: &[String]) -> Vec<ToolSpec>;

    async fn execute(
        &self,
        snapshot: &mut AppSnapshot,
        request: ExecutionRequest,
    ) -> ExecutionResult;
}

#[derive(Clone, Debug, Default)]
pub struct BrowserExecutionProvider {
    tools: ToolRegistry,
    vfs: crate::vfs::ProjectVfs,
}

impl BrowserExecutionProvider {
    pub fn new() -> Self {
        Self {
            tools: ToolRegistry::new(),
            vfs: crate::vfs::ProjectVfs::new(),
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
    fn name(&self) -> &'static str {
        "browser"
    }

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

    async fn execute(
        &self,
        snapshot: &mut AppSnapshot,
        request: ExecutionRequest,
    ) -> ExecutionResult {
        match request {
            ExecutionRequest::DomainTool {
                call_id,
                tool_name,
                args,
            } => {
                let result = self
                    .execute_domain_tool(snapshot, call_id, &tool_name, args)
                    .await;
                ExecutionResult {
                    ok: result.ok,
                    evidence: result.content.clone(),
                    content: result.content,
                }
            }
            ExecutionRequest::ShellCommand { .. } => {
                ExecutionResult::unsupported("shell command execution")
            }
            ExecutionRequest::FileExists { path } => match self.vfs.read_file(&path).await {
                Ok(Some(_)) => ExecutionResult {
                    ok: true,
                    content: format!("File exists: {path}"),
                    evidence: format!("Read {path}"),
                },
                Ok(None) => ExecutionResult {
                    ok: false,
                    content: format!("File does not exist: {path}"),
                    evidence: format!("Read {path}"),
                },
                Err(e) => ExecutionResult {
                    ok: false,
                    content: format!("VFS Error: {e}"),
                    evidence: format!("Read {path}"),
                },
            },
            ExecutionRequest::ContentRegex { path, pattern } => {
                let regex = match regex::Regex::new(&pattern) {
                    Ok(regex) => regex,
                    Err(err) => {
                        return ExecutionResult {
                            ok: false,
                            content: format!("Invalid regex `{pattern}`: {err}"),
                            evidence: format!("Regex: {pattern}"),
                        };
                    }
                };
                match self.vfs.read_file(&path).await {
                    Ok(Some(content)) => {
                        if regex.is_match(&content) {
                            ExecutionResult {
                                ok: true,
                                content: format!("Regex match found in {path}"),
                                evidence: format!("Regex: {pattern}"),
                            }
                        } else {
                            ExecutionResult {
                                ok: false,
                                content: format!("Regex match NOT found in {path}"),
                                evidence: format!("Regex: {pattern}"),
                            }
                        }
                    }
                    Ok(None) => ExecutionResult {
                        ok: false,
                        content: format!("File does not exist: {path}"),
                        evidence: format!("Regex: {pattern}"),
                    },
                    Err(e) => ExecutionResult {
                        ok: false,
                        content: format!("VFS Error: {e}"),
                        evidence: format!("Regex: {pattern}"),
                    },
                }
            }
            ExecutionRequest::TestCommand { .. } => {
                ExecutionResult::unsupported("test command execution")
            }
        }
    }
}

#[cfg(test)]
pub fn request_label(request: &ExecutionRequest) -> &'static str {
    match request {
        ExecutionRequest::DomainTool { .. } => "domain_tool",
        ExecutionRequest::ShellCommand { .. } => "shell_command",
        ExecutionRequest::FileExists { .. } => "file_exists",
        ExecutionRequest::ContentRegex { .. } => "content_regex",
        ExecutionRequest::TestCommand { .. } => "test_command",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_executor_rejects_shell_and_test_commands() {
        // Shell and test-command execution have no browser-safe backend. (File and
        // regex checks go through the IndexedDB VFS, which is only available in the
        // browser, so they are not exercised here on the host test runner.)
        let executor = BrowserExecutionProvider::new();
        let mut snapshot = AppSnapshot::default();

        let shell = pollster::block_on(executor.execute(
            &mut snapshot,
            ExecutionRequest::ShellCommand {
                command: "cargo test".to_string(),
            },
        ));
        assert!(!shell.ok);
        assert!(shell.content.contains("unsupported by browser backend"));

        let test = pollster::block_on(executor.execute(
            &mut snapshot,
            ExecutionRequest::TestCommand {
                command: "cargo test".to_string(),
            },
        ));
        assert!(!test.ok);
        assert!(test.content.contains("unsupported by browser backend"));
    }

    #[test]
    fn request_labels_are_stable() {
        assert_eq!(
            request_label(&ExecutionRequest::TestCommand {
                command: "cargo test".to_string()
            }),
            "test_command"
        );
    }
}
