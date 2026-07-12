//! Browser-direct MCP client (Streamable HTTP): each configured remote
//! server's tools join the ONE registry (ADR-004) as ordinary `dyn Tool`s
//! named `mcp_<server-slug>_<toolname>`. JSON-RPC 2.0 rides the injected
//! `Transport` (ADR-009) — one POST per message; the response body is plain
//! JSON or a single-event SSE stream, both parsed. A dead server yields a
//! problem string at registration, never a boot failure.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use askk_core::{Effect, Tool, ToolCtx, ToolResult, ToolSpec};
use askk_inference::{parse_sse_lines, HttpRequest, HttpResponse, Transport, TransportError};
use serde_json::{json, Value};

use crate::state::LocalBoxFuture;

use super::registry::ToolRegistry;

/// Latest MCP revision that specifies the Streamable HTTP transport.
const PROTOCOL_VERSION: &str = "2025-03-26";

/// Newline-separated pref text → trimmed, non-empty server URLs.
pub fn parse_server_list(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(String::from)
        .collect()
}

/// Connect each server (initialize → initialized → tools/list) and register
/// its tools. Returns human-readable problems — an unreachable server or a
/// bad tool definition is reported and skipped, so boot always completes.
pub async fn register_mcp(
    reg: &mut ToolRegistry,
    transport: Rc<dyn Transport>,
    servers: &[String],
) -> Vec<String> {
    let mut problems = Vec::new();
    for url in servers {
        let url = url.trim().trim_end_matches('/');
        if url.is_empty() {
            continue;
        }
        let endpoint = Rc::new(McpEndpoint::new(transport.clone(), url));
        let defs = match endpoint.connect().await {
            Ok(defs) => defs,
            Err(e) => {
                problems.push(format!("mcp {url}: {e}"));
                continue;
            }
        };
        for def in &defs {
            match McpTool::from_def(endpoint.clone(), def) {
                Some(tool) => {
                    if let Err(e) = reg.register(Rc::new(tool)) {
                        problems.push(format!("mcp {url}: {e}"));
                    }
                }
                None => problems.push(format!("mcp {url}: tool definition without a name")),
            }
        }
    }
    problems
}

/// One remote server: URL + request-id counter + the `Mcp-Session-Id` the
/// server may hand back on `initialize` (echoed on every later request).
struct McpEndpoint {
    transport: Rc<dyn Transport>,
    url: String,
    slug: String,
    session: RefCell<Option<String>>,
    next_id: Cell<u64>,
}

impl McpEndpoint {
    fn new(transport: Rc<dyn Transport>, url: &str) -> Self {
        Self {
            transport,
            url: url.to_string(),
            slug: server_slug(url),
            session: RefCell::new(None),
            next_id: Cell::new(1),
        }
    }

    async fn post(&self, body: String) -> Result<HttpResponse, String> {
        let mut headers = vec![
            ("Content-Type".to_string(), "application/json".to_string()),
            (
                "Accept".to_string(),
                "application/json, text/event-stream".to_string(),
            ),
        ];
        if let Some(sid) = self.session.borrow().clone() {
            headers.push(("Mcp-Session-Id".to_string(), sid));
        }
        let resp = self
            .transport
            .send(HttpRequest {
                method: "POST".into(),
                url: self.url.clone(),
                headers,
                body,
            })
            .await
            .map_err(|e| match e {
                TransportError::Connect(msg) => format!("server unreachable ({msg})"),
                TransportError::Timeout => "server timed out".to_string(),
            })?;
        if !(200..300).contains(&resp.status) {
            return Err(format!("HTTP {}", resp.status));
        }
        Ok(resp)
    }

    /// One JSON-RPC request → its `result`, with server `error` objects and
    /// transport failures mapped to readable strings.
    async fn rpc(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.get();
        self.next_id.set(id + 1);
        let body = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        let resp = self
            .post(body.to_string())
            .await
            .map_err(|e| format!("{method}: {e}"))?;
        if let Some(sid) = resp.header("mcp-session-id") {
            *self.session.borrow_mut() = Some(sid.to_string());
        }
        let message = extract_message(&resp).map_err(|e| format!("{method}: {e}"))?;
        if let Some(err) = message.get("error") {
            let code = err.get("code").and_then(Value::as_i64).unwrap_or(0);
            let text = err
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unknown error");
            return Err(format!("{method}: server error {code}: {text}"));
        }
        Ok(message.get("result").cloned().unwrap_or(Value::Null))
    }

    /// Fire-and-forget notification: a failure here changes nothing the next
    /// request would not surface anyway.
    async fn notify(&self, method: &str) {
        let body = json!({"jsonrpc": "2.0", "method": method});
        let _ = self.post(body.to_string()).await;
    }

    /// The MCP bring-up handshake; returns the advertised tool definitions.
    async fn connect(&self) -> Result<Vec<Value>, String> {
        self.rpc(
            "initialize",
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "askk", "version": env!("CARGO_PKG_VERSION")}
            }),
        )
        .await?;
        self.notify("notifications/initialized").await;
        let listed = self.rpc("tools/list", json!({})).await?;
        listed
            .get("tools")
            .and_then(Value::as_array)
            .cloned()
            .ok_or_else(|| "tools/list: no 'tools' array in result".to_string())
    }
}

/// A remote tool behind the local `dyn Tool` seam. Mutating unless the
/// server's annotations carry `readOnlyHint: true` (ADR-006 gate default).
struct McpTool {
    spec: ToolSpec,
    endpoint: Rc<McpEndpoint>,
    remote_name: String,
}

impl McpTool {
    fn from_def(endpoint: Rc<McpEndpoint>, def: &Value) -> Option<Self> {
        let remote_name = def.get("name").and_then(Value::as_str)?.to_string();
        let read_only = def["annotations"]["readOnlyHint"]
            .as_bool()
            .unwrap_or(false);
        Some(Self {
            spec: ToolSpec {
                name: format!("mcp_{}_{remote_name}", endpoint.slug),
                description: def
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                input_schema: def
                    .get("inputSchema")
                    .cloned()
                    .unwrap_or_else(|| json!({"type": "object"})),
                effect: if read_only {
                    Effect::Pure
                } else {
                    Effect::Mutating
                },
            },
            endpoint,
            remote_name,
        })
    }
}

impl Tool for McpTool {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, _ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let params = json!({"name": self.remote_name, "arguments": args});
            let name = &self.spec.name;
            match self.endpoint.rpc("tools/call", params).await {
                Ok(result) => {
                    let text = joined_text(&result);
                    if result["isError"].as_bool().unwrap_or(false) {
                        ToolResult::err(format!("{name}: {text}"))
                    } else {
                        ToolResult::ok(text)
                    }
                }
                Err(e) => ToolResult::err(format!("{name}: {e}")),
            }
        })
    }
}

/// Streamable HTTP reply body: plain JSON, or an SSE stream whose `data:`
/// line carries the one JSON-RPC response message for our POST.
fn extract_message(resp: &HttpResponse) -> Result<Value, String> {
    let sse = resp
        .header("content-type")
        .is_some_and(|ct| ct.contains("text/event-stream"))
        || looks_like_sse(&resp.body);
    if !sse {
        return serde_json::from_str(&resp.body).map_err(|e| format!("bad JSON: {e}"));
    }
    for event in parse_sse_lines(&resp.body) {
        if let Ok(value) = serde_json::from_str::<Value>(&event.data) {
            if value.get("result").is_some() || value.get("error").is_some() {
                return Ok(value);
            }
        }
    }
    Err("no JSON-RPC response in SSE body".to_string())
}

/// Header-less transports (and mocks) still get SSE detection.
fn looks_like_sse(body: &str) -> bool {
    let head = body.trim_start();
    head.starts_with("data:") || head.starts_with("event:") || head.starts_with(':')
}

/// Text content items joined with newlines; non-text items leave a marker
/// instead of vanishing silently.
fn joined_text(result: &Value) -> String {
    let Some(items) = result.get("content").and_then(Value::as_array) else {
        return String::new();
    };
    items
        .iter()
        .filter_map(|item| match item.get("type").and_then(Value::as_str) {
            Some("text") => item.get("text").and_then(Value::as_str).map(String::from),
            Some(other) => Some(format!("[{other} content]")),
            None => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// `https://mcp.example.com/api` → `mcp_example_com_api`: scheme dropped,
/// non-alphanumerics collapsed to single underscores.
fn server_slug(url: &str) -> String {
    let stripped = url.split("://").last().unwrap_or(url);
    let mut out = String::new();
    for ch in stripped.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if !out.ends_with('_') && !out.is_empty() {
            out.push('_');
        }
    }
    out.trim_end_matches('_').to_string()
}
