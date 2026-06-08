//! Live MCP connections for the running agent (wasm only).
//!
//! The engine brings up enabled browser MCP servers at run start, discovers their
//! tools, and routes tool calls here. Connections live in a thread-local table
//! because a [`WorkerMcpTransport`] owns a `web_sys::Worker` that is neither `Send`
//! nor serializable — it cannot live on the serde `AppSnapshot` or on the
//! `Clone`/`Debug` execution provider. Each discovered tool is surfaced under a
//! namespaced name (`mcp__<server-id>__<tool>`) so it never collides with a
//! compiled built-in, and tool calls route back to the owning server's client.
//!
//! TODO: capability-scoping of untrusted servers. Today every discovered tool is
//! offered to the agent unconditionally; the transport trait + this seam are where a
//! future iteration will gate which tools a given (untrusted) server may expose.
#![cfg(target_arch = "wasm32")]

use crate::mcp::client::McpClient;
use crate::mcp::worker_transport::WorkerMcpTransport;
use crate::state::{
    AgentEventKind, AgentRun, AppResult, McpServerConfig, McpServerKind, ToolResult, ToolSpec,
    event,
};
use dioxus::prelude::*;
use serde_json::Value;
use std::cell::RefCell;
use std::rc::Rc;

/// The bundled reference MCP server, resolved to a hashed, base-pathed URL at build
/// time (e.g. `/ASKK/assets/mcp_reference_server-<hash>.js`). A config whose
/// `module_path` points at the canonical source path resolves through this so the
/// worker loads on GitHub Pages; any other path is used verbatim.
const REFERENCE_SERVER: Asset = asset!("/assets/mcp_reference_server.js");

/// Source path of the bundled reference server, as stored in a default config.
const REFERENCE_SERVER_SOURCE_PATH: &str = "/assets/mcp_reference_server.js";

/// Prefix that marks a tool name as MCP-backed and namespaces it by server id.
const NAMESPACE_PREFIX: &str = "mcp__";

/// One connected, initialized MCP server and the tools it advertised.
struct McpConnection {
    server_id: String,
    /// Fingerprint of the config that produced this connection (see
    /// [`connection_fingerprint`]). A connection is only reused when the current
    /// config still hashes to this, so an edited `module_path`/`name` forces a
    /// reconnect instead of silently talking to the old worker.
    fingerprint: String,
    /// The client is wrapped in `Rc` so a tool call can clone it out of the
    /// thread-local table and `.await` the round-trip without holding the borrow.
    client: Rc<McpClient<WorkerMcpTransport>>,
    /// `(namespaced ToolSpec offered to the model, real tool name on the server)`.
    tools: Vec<(ToolSpec, String)>,
}

/// Identity of a connection for cache-reuse purposes: the fields that change which
/// worker we talk to or how its tools are presented. `id` namespaces the tools;
/// `module_path` is the worker URL; `name` is baked into every tool description.
fn connection_fingerprint(config: &McpServerConfig) -> String {
    format!("{}|{}|{}", config.id, config.module_path, config.name)
}

thread_local! {
    static MCP_RUNTIME: RefCell<Vec<McpConnection>> = const { RefCell::new(Vec::new()) };
}

/// Resolve the worker URL for a server config. The bundled reference server goes
/// through `asset!()` so it survives content hashing and the deploy base path.
fn resolve_worker_url(config: &McpServerConfig) -> String {
    if config.module_path == REFERENCE_SERVER_SOURCE_PATH {
        REFERENCE_SERVER.to_string()
    } else {
        config.module_path.clone()
    }
}

/// Build the namespaced tool name for a server's tool.
fn namespaced_name(server_id: &str, tool: &str) -> String {
    format!("{NAMESPACE_PREFIX}{server_id}__{tool}")
}

/// Spawn the worker, run the initialize handshake, and discover tools. Performed
/// fully outside any thread-local borrow so the awaits can't deadlock the table.
async fn connect_server(config: &McpServerConfig) -> AppResult<McpConnection> {
    let url = resolve_worker_url(config);
    let transport = WorkerMcpTransport::connect(&url)?;
    let client = McpClient::new(transport);
    client.initialize().await?;
    let defs = client.list_tools().await?;

    let tools = defs
        .into_iter()
        .map(|def| {
            let spec = ToolSpec {
                name: namespaced_name(&config.id, &def.name),
                description: format!("[MCP · {}] {}", config.name, def.description),
                input_schema: def.input_schema,
            };
            (spec, def.name)
        })
        .collect();

    Ok(McpConnection {
        server_id: config.id.clone(),
        fingerprint: connection_fingerprint(config),
        client: Rc::new(client),
        tools,
    })
}

/// Bring up every enabled browser MCP server, emitting connect / tools-listed /
/// error events into the run, and return the namespaced names of all discovered
/// tools so the engine can add them to the agent's allowlist. Idempotent across
/// runs on the same thread: already-connected servers are reused, and connections
/// for servers no longer enabled are torn down.
pub async fn bring_up_enabled<F>(
    servers: &[McpServerConfig],
    run: &mut AgentRun,
    agent_id: &str,
    observer: &mut F,
) -> Vec<String>
where
    F: FnMut(AgentRun),
{
    // Drop connections for servers that are no longer enabled, were removed, or whose
    // config was edited (a changed module_path/name yields a different fingerprint).
    // Dropping the `McpConnection` drops its client, whose transport terminates the
    // worker; the edited server then reconnects fresh below.
    let live_fingerprints: Vec<String> = servers
        .iter()
        .filter(|server| server.enabled && server.kind == McpServerKind::Browser)
        .map(connection_fingerprint)
        .collect();
    MCP_RUNTIME.with(|runtime| {
        runtime
            .borrow_mut()
            .retain(|conn| live_fingerprints.contains(&conn.fingerprint));
    });

    let mut names = Vec::new();
    for server in servers
        .iter()
        .filter(|server| server.enabled && server.kind == McpServerKind::Browser)
    {
        // Reuse a live connection from an earlier run on this thread, but only when
        // the config is unchanged (same fingerprint) — an edited server fell out of
        // the table above and reconnects below.
        let fingerprint = connection_fingerprint(server);
        let existing = MCP_RUNTIME.with(|runtime| {
            runtime
                .borrow()
                .iter()
                .find(|conn| conn.fingerprint == fingerprint)
                .map(|conn| {
                    conn.tools
                        .iter()
                        .map(|(spec, _)| spec.name.clone())
                        .collect::<Vec<_>>()
                })
        });
        if let Some(existing_names) = existing {
            names.extend(existing_names);
            continue;
        }

        match connect_server(server).await {
            Ok(conn) => {
                let tool_names: Vec<String> = conn
                    .tools
                    .iter()
                    .map(|(spec, _)| spec.name.clone())
                    .collect();
                let listed: Vec<String> = conn.tools.iter().map(|(_, real)| real.clone()).collect();
                run.events.push(event(
                    &run.id,
                    Some(agent_id.to_string()),
                    AgentEventKind::McpConnected,
                    format!("MCP connected: {}", server.name),
                    format!(
                        "Connected to browser MCP server `{}` ({} tool(s)).",
                        server.name,
                        conn.tools.len()
                    ),
                ));
                observer(run.clone());
                run.events.push(event(
                    &run.id,
                    Some(agent_id.to_string()),
                    AgentEventKind::McpToolsListed,
                    format!("MCP tools: {}", server.name),
                    format!("Discovered tools: {}", listed.join(", ")),
                ));
                observer(run.clone());
                names.extend(tool_names);
                MCP_RUNTIME.with(|runtime| runtime.borrow_mut().push(conn));
            }
            Err(err) => {
                run.events.push(event(
                    &run.id,
                    Some(agent_id.to_string()),
                    AgentEventKind::Error,
                    format!("MCP connect failed: {}", server.name),
                    err,
                ));
                observer(run.clone());
            }
        }
    }
    names
}

/// One-shot probe for the dashboard: connect, initialize, list tools, then tear the
/// worker down (the returned connection is dropped here, terminating its worker).
/// Does not touch the live runtime table.
pub async fn discover_tools(config: &McpServerConfig) -> AppResult<Vec<String>> {
    let conn = connect_server(config).await?;
    Ok(conn.tools.iter().map(|(_, real)| real.clone()).collect())
}

/// The namespaced `ToolSpec`s for all live MCP tools whose name is in the agent's
/// allowlist. Merged into the model's tool list alongside the compiled built-ins.
pub fn specs_for_agent(enabled_tools: &[String]) -> Vec<ToolSpec> {
    MCP_RUNTIME.with(|runtime| {
        runtime
            .borrow()
            .iter()
            .flat_map(|conn| conn.tools.iter())
            .filter(|(spec, _)| enabled_tools.iter().any(|name| name == &spec.name))
            .map(|(spec, _)| spec.clone())
            .collect()
    })
}

/// Whether `name` resolves to a live MCP-backed tool (so the engine routes its call
/// here instead of to the compiled tool registry).
pub fn is_mcp_tool(name: &str) -> bool {
    name.starts_with(NAMESPACE_PREFIX)
        && MCP_RUNTIME.with(|runtime| {
            runtime
                .borrow()
                .iter()
                .any(|conn| conn.tools.iter().any(|(spec, _)| spec.name == name))
        })
}

/// Route a namespaced MCP tool call to its server's client and convert the MCP
/// `CallToolResult` into the engine's [`ToolResult`]. Tool output is untrusted DATA,
/// handled by the engine exactly like any other tool result.
pub async fn call_tool(call_id: String, name: &str, args: Value) -> ToolResult {
    // Clone the client and real tool name out of the table, then drop the borrow
    // before awaiting the worker round-trip.
    let found = MCP_RUNTIME.with(|runtime| {
        runtime.borrow().iter().find_map(|conn| {
            conn.tools
                .iter()
                .find(|(spec, _)| spec.name == name)
                .map(|(_, real)| {
                    (
                        conn.server_id.clone(),
                        Rc::clone(&conn.client),
                        real.clone(),
                    )
                })
        })
    });

    let (server_id, client, real_name) = match found {
        Some(triple) => triple,
        None => {
            return ToolResult {
                call_id,
                ok: false,
                content: format!("No live MCP tool named `{name}`."),
            };
        }
    };

    match client.call_tool(&real_name, args).await {
        Ok(result) => ToolResult {
            call_id,
            ok: !result.is_error.unwrap_or(false),
            content: result.text(),
        },
        Err(err) => {
            // A transport-level failure (timeout / worker closed) means this worker is
            // wedged or gone. Evict it so the next run reconnects fresh instead of
            // re-stalling on the same dead worker. (A tool that merely reports an MCP
            // error comes back as Ok(CallToolResult { is_error }), not Err, so this
            // only fires on real transport faults.)
            MCP_RUNTIME.with(|runtime| {
                runtime
                    .borrow_mut()
                    .retain(|conn| conn.server_id != server_id);
            });
            ToolResult {
                call_id,
                ok: false,
                content: err,
            }
        }
    }
}
