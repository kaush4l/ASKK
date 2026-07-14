//! Browser-direct MCP client (Streamable HTTP) as a self-contained feature
//! folder: `config` parses the `mcp_servers` pref (JSON array or legacy
//! newline URLs), `client` speaks the JSON-RPC wire, and `register_mcp` here
//! joins each enabled server's allowlisted tools to the ONE registry
//! (ADR-004) as `mcp_<server-slug>_<toolname>`, returning one
//! `McpServerStatus` per server. A dead server yields an error status at
//! registration, never a boot failure.

mod client;
mod config;

use std::rc::Rc;

use askk_core::Tool;
use askk_inference::Transport;
use serde_json::Value;

use client::{McpEndpoint, McpTool};
pub use config::{parse_server_list, parse_servers, McpServerConfig};

use super::registry::ToolRegistry;

/// Per-server registration outcome, surfaced on the boot handle for the
/// Settings status list (and folded into the boot-warning channel on error).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpServerStatus {
    pub name: String,
    pub url: String,
    /// Connected and listed tools. `false` with no error = disabled config.
    pub ok: bool,
    /// Registry names actually registered (after the `allow` filter).
    pub tools: Vec<String>,
    pub error: Option<String>,
}

/// Connect each enabled server (initialize → initialized → tools/list) and
/// register its allowlisted tools. Every server gets a status; an
/// unreachable server or bad tool definition is reported and skipped, so
/// boot always completes.
pub async fn register_mcp(
    reg: &mut ToolRegistry,
    transport: Rc<dyn Transport>,
    servers: &[McpServerConfig],
) -> Vec<McpServerStatus> {
    let mut statuses = Vec::new();
    for cfg in servers {
        let url = cfg.url.trim().trim_end_matches('/');
        if url.is_empty() {
            continue;
        }
        let mut status = McpServerStatus {
            name: cfg.name.clone(),
            url: url.to_string(),
            ok: false,
            tools: Vec::new(),
            error: None,
        };
        if !cfg.enabled {
            statuses.push(status); // noted, never contacted
            continue;
        }
        let endpoint = Rc::new(McpEndpoint::new(transport.clone(), url, &cfg.headers));
        match endpoint.connect().await {
            Ok(defs) => {
                status.ok = true;
                let mut problems = Vec::new();
                for def in &defs {
                    let Some(remote) = def.get("name").and_then(Value::as_str) else {
                        problems.push("tool definition without a name".to_string());
                        continue;
                    };
                    if !cfg.allow.is_empty() && !cfg.allow.iter().any(|a| a == remote) {
                        continue; // not allowlisted — discovered but not registered
                    }
                    let Some(tool) = McpTool::from_def(endpoint.clone(), def) else {
                        continue; // unreachable: name presence checked above
                    };
                    let registered = tool.spec().name.clone();
                    match reg.register(Rc::new(tool)) {
                        Ok(()) => status.tools.push(registered),
                        Err(e) => problems.push(e.to_string()),
                    }
                }
                if !problems.is_empty() {
                    status.error = Some(problems.join("; "));
                }
            }
            Err(e) => status.error = Some(e),
        }
        statuses.push(status);
    }
    statuses
}
