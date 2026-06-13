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
use crate::mcp::protocol::McpToolDef;
use crate::mcp::transport::McpTransport;
use crate::mcp::worker_transport::WorkerMcpTransport;
use crate::mcp::workspace_server::WorkspaceMcpServer;
use crate::state::{
    AgentEventKind, AgentRun, AppResult, McpServerConfig, McpServerDefinition, McpServerKind,
    ToolConfig, ToolResult, ToolSpec, default_tool_names, event,
};
use dioxus::prelude::*;
use serde_json::Value;
use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;

/// The bundled reference MCP server, resolved to a hashed, base-pathed URL at build
/// time (e.g. `/ASKK/assets/mcp_reference_server-<hash>.js`). A config whose
/// `module_path` points at the canonical source path resolves through this so the
/// worker loads on GitHub Pages; any other path is used verbatim.
const REFERENCE_SERVER: Asset = asset!("/assets/mcp_reference_server.js");

/// Source path of the bundled reference server, as stored in a default config.
const REFERENCE_SERVER_SOURCE_PATH: &str = "/assets/mcp_reference_server.js";

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
    /// Boxed transport: worker-backed and in-process servers share this table.
    client: Rc<McpClient<Box<dyn McpTransport>>>,
    /// `(ToolSpec offered to the model with a clean display name, real tool name on
    /// the server)`. The display name is what the model calls; routing maps it back
    /// to the real name here.
    tools: Vec<(ToolSpec, String)>,
}

/// Identity of a connection for cache-reuse purposes: the fields that change which
/// worker we talk to or how its tools are presented. `id` namespaces the tools;
/// `kind`/`module_path`/`definition` determine what worker is spawned; `name` is baked
/// into every tool description. Editing the shellized `definition` thus forces a
/// reconnect instead of silently talking to the old worker.
fn connection_fingerprint(config: &McpServerConfig) -> String {
    format!(
        "{}|{:?}|{}|{}|{}",
        config.id, config.kind, config.module_path, config.name, config.definition
    )
}

/// Whether a server kind is run inside the browser tab (and so brought up by the
/// in-browser runtime). All kinds today are; remote/bridged kinds added later are not.
fn runs_in_browser(kind: McpServerKind) -> bool {
    matches!(
        kind,
        McpServerKind::Browser | McpServerKind::Shellized | McpServerKind::Workspace
    )
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

/// Sanitize a server name into a short identifier-ish slug used only to
/// disambiguate a tool name that would otherwise collide.
fn slug(name: &str) -> String {
    let mut out = String::new();
    let mut last_underscore = false;
    for ch in name.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            out.extend(ch.to_lowercase());
            last_underscore = false;
        } else if !last_underscore && !out.is_empty() {
            out.push('_');
            last_underscore = true;
        }
    }
    out.trim_matches('_').to_string()
}

/// Pick the clean, LLM-facing name for an MCP tool. The model should see the bare
/// tool name (e.g. `echo`), never the internal server id. Only when that bare name
/// would collide — with a compiled built-in or another connected MCP tool — do we
/// disambiguate by prefixing the server slug, then a numeric suffix as a last
/// resort. `used` accumulates every name already offered to the model.
fn unique_display_name(real: &str, server_name: &str, used: &mut HashSet<String>) -> String {
    let bare = real.trim();
    if !bare.is_empty() && used.insert(bare.to_string()) {
        return bare.to_string();
    }
    let server_slug = slug(server_name);
    if !server_slug.is_empty() {
        let prefixed = format!("{server_slug}_{bare}");
        if used.insert(prefixed.clone()) {
            return prefixed;
        }
    }
    let stem = if server_slug.is_empty() {
        bare.to_string()
    } else {
        format!("{server_slug}_{bare}")
    };
    let mut n = 2;
    loop {
        let candidate = format!("{stem}_{n}");
        if used.insert(candidate.clone()) {
            return candidate;
        }
        n += 1;
    }
}

/// Describe an MCP tool to the model: its own description, plus where it comes from
/// so the model knows it is talking to an external server.
fn describe_mcp_tool(def: &McpToolDef, server_name: &str) -> String {
    let desc = def.description.trim();
    if desc.is_empty() {
        format!("Tool provided by the \"{server_name}\" MCP server.")
    } else {
        format!("{desc} (Provided by the \"{server_name}\" MCP server.)")
    }
}

/// Connect a server, run the initialize handshake, and list tools. Returns the live
/// client plus the raw tool definitions; callers assign display names. Performed
/// fully outside any thread-local borrow so the awaits can't deadlock the table.
///
/// A `Browser` server loads its pre-written module by URL; a `Shellized` server is
/// assembled from its definition and spawned from a Blob; a `Workspace` server is the
/// in-process Rust transport (no worker at all, capturing `tool_config` for handlers
/// that need it). All three end up behind the same boxed [`McpTransport`], so
/// everything downstream is identical.
async fn connect_server(
    config: &McpServerConfig,
    tool_config: &ToolConfig,
) -> AppResult<(Rc<McpClient<Box<dyn McpTransport>>>, Vec<McpToolDef>)> {
    let transport: Box<dyn McpTransport> = match config.kind {
        McpServerKind::Browser => {
            Box::new(WorkerMcpTransport::connect(&resolve_worker_url(config))?)
        }
        McpServerKind::Shellized => {
            let definition = McpServerDefinition::parse(&config.definition)?;
            let definition_json = serde_json::to_string(&definition)
                .map_err(|err| format!("Unable to encode MCP definition: {err}"))?;
            Box::new(WorkerMcpTransport::connect_shellized(&definition_json)?)
        }
        McpServerKind::Workspace => {
            Box::new(WorkspaceMcpServer::new(tool_config.web_search.clone()))
        }
    };
    let client = McpClient::new(transport);
    client.initialize().await?;
    let defs = client.list_tools().await?;
    Ok((Rc::new(client), defs))
}

/// Bring up every enabled browser MCP server, emitting connect / tools-listed /
/// error events into the run, and return the namespaced names of all discovered
/// tools so the engine can add them to the agent's allowlist. Idempotent across
/// runs on the same thread: already-connected servers are reused, and connections
/// for servers no longer enabled are torn down.
///
/// `reserved_names` are tool names the engine has already promised to another
/// source (today: the per-agent `agent_<slug>` tools); no MCP tool is ever given
/// one of these as its display name, so a name in the allowlist maps to exactly
/// one source.
pub async fn bring_up_enabled<F>(
    servers: &[McpServerConfig],
    tool_config: &ToolConfig,
    reserved_names: &[String],
    run: &mut AgentRun,
    agent_id: &str,
    observer: &mut F,
) -> Vec<String>
where
    F: FnMut(AgentRun),
{
    // The in-process workspace server captures tool settings (the bridge URL) at
    // connect time and is allocation-cheap to rebuild — always reconnect it so
    // settings edits take effect on every bring-up, including main-thread resumes
    // where this table outlives the run. Its config fingerprint alone cannot
    // catch this: `tool_config` is not part of the fingerprint.
    MCP_RUNTIME.with(|runtime| {
        runtime
            .borrow_mut()
            .retain(|conn| conn.server_id != crate::state::WORKSPACE_MCP_SERVER_ID);
    });

    // Drop connections for servers that are no longer enabled, were removed, or whose
    // config was edited (a changed module_path/name yields a different fingerprint).
    // Dropping the `McpConnection` drops its client, whose transport terminates the
    // worker; the edited server then reconnects fresh below.
    let live_fingerprints: Vec<String> = servers
        .iter()
        .filter(|server| server.enabled && runs_in_browser(server.kind))
        .map(connection_fingerprint)
        .collect();
    MCP_RUNTIME.with(|runtime| {
        runtime
            .borrow_mut()
            .retain(|conn| live_fingerprints.contains(&conn.fingerprint));
    });

    // Names already offered to the model: every compiled built-in, the engine's
    // reserved names, plus the display names of connections that survived the
    // prune. New tools are named to avoid these so two tools never share a name.
    let mut used: HashSet<String> = default_tool_names().into_iter().collect();
    used.extend(reserved_names.iter().cloned());
    MCP_RUNTIME.with(|runtime| {
        for conn in runtime.borrow().iter() {
            for (spec, _) in &conn.tools {
                used.insert(spec.name.clone());
            }
        }
    });

    let mut names = Vec::new();
    for server in servers
        .iter()
        .filter(|server| server.enabled && runs_in_browser(server.kind))
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

        match connect_server(server, tool_config).await {
            Ok((client, defs)) => {
                // Assign each tool a clean, collision-free display name and a
                // description that names its source server.
                let tools: Vec<(ToolSpec, String)> = defs
                    .into_iter()
                    .map(|def| {
                        let display = unique_display_name(&def.name, &server.name, &mut used);
                        let spec = ToolSpec {
                            name: display,
                            description: describe_mcp_tool(&def, &server.name),
                            input_schema: def.input_schema.clone(),
                        };
                        (spec, def.name)
                    })
                    .collect();
                let conn = McpConnection {
                    server_id: server.id.clone(),
                    fingerprint,
                    client,
                    tools,
                };
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
pub async fn discover_tools(
    config: &McpServerConfig,
    tool_config: &ToolConfig,
) -> AppResult<Vec<String>> {
    let (_client, defs) = connect_server(config, tool_config).await?;
    Ok(defs.into_iter().map(|def| def.name).collect())
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

/// A live MCP tool as a first-class [`crate::core::Tool`] (paradigm `Mcp`). It
/// carries its namespaced display name — its identity/state — and routes each
/// call to the owning server's client via [`call_tool`]. The server *environment*
/// was already brought up by [`bring_up_enabled`] when the run's tool set was
/// assembled: a tool is the only thing that needs an environment, and the set
/// owns that lifecycle. Built by the shell's `build_tool_set`, so the loop
/// dispatches MCP calls polymorphically — no name-keyed branch in the hot path.
pub struct McpTool {
    spec: ToolSpec,
    paradigm: crate::core::ToolParadigm,
}

impl McpTool {
    pub fn new(spec: ToolSpec, paradigm: crate::core::ToolParadigm) -> Self {
        Self { spec, paradigm }
    }
}

impl crate::core::Tool for McpTool {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn paradigm(&self) -> crate::core::ToolParadigm {
        self.paradigm
    }

    fn call<'a>(
        &'a self,
        _snapshot: &'a mut crate::state::AppSnapshot,
        args: &'a Value,
    ) -> crate::core::ToolFuture<'a> {
        let name = self.spec.name.clone();
        let args = args.clone();
        Box::pin(async move {
            let result = call_tool(String::new(), &name, args).await;
            if result.ok {
                Ok(result.content)
            } else {
                Err(result.content)
            }
        })
    }
}

/// Classify `name` as a live MCP-backed tool, returning its paradigm — or `None`
/// when no live server currently serves it. One borrow of the runtime table, so
/// the "is it MCP?" and "which paradigm?" answers can never disagree across a
/// server coming down between two scans. Tools served by the built-in tool host
/// run user-authored JavaScript functions (with a persistent per-tool `state`
/// object), so they surface as [`crate::core::ToolParadigm::Js`]; every other
/// live server is a true `Mcp` tool. (Connector-hosted servers map to `Connector`
/// once that server kind lands.)
pub fn classify_mcp_tool(name: &str) -> Option<crate::core::ToolParadigm> {
    MCP_RUNTIME.with(|runtime| {
        runtime.borrow().iter().find_map(|conn| {
            conn.tools
                .iter()
                .any(|(spec, _)| spec.name == name)
                .then(|| {
                    if conn.server_id == crate::state::TOOL_HOST_SERVER_ID {
                        crate::core::ToolParadigm::Js
                    } else {
                        crate::core::ToolParadigm::Mcp
                    }
                })
        })
    })
}

/// Whether `name` is a live MCP-backed tool's display name (so the engine routes its
/// call here instead of to the compiled tool registry). Display names are assigned to
/// avoid colliding with any built-in, so a match here is unambiguous.
pub fn is_mcp_tool(name: &str) -> bool {
    MCP_RUNTIME.with(|runtime| {
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
