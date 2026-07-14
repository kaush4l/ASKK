//! MCP client tests over the public registry surface: scripted
//! `MockTransport` handshakes, prefixed registration, Pure/Mutating mapping
//! from annotations, call round-trips, SSE-wrapped replies, dead-server
//! resilience, JSON-vs-legacy config parsing, configured headers, disabled
//! servers, and allowlist filtering. Zero network.

use std::collections::BTreeMap;
use std::rc::Rc;

use askk_core::{Effect, ToolCtx, ToolResult};
use askk_inference::{HttpResponse, MockTransport};
use askk_runtime::testutil::block_on;
use askk_runtime::tools::{
    parse_server_list, parse_servers, register_mcp, McpServerConfig, McpServerStatus, ToolRegistry,
};
use serde_json::{json, Value};

const SERVER: &str = "https://srv.example/mcp";

fn cfg(url: &str) -> McpServerConfig {
    McpServerConfig {
        name: "srv".into(),
        url: url.into(),
        headers: BTreeMap::new(),
        enabled: true,
        allow: Vec::new(),
    }
}

fn init_body() -> String {
    json!({"jsonrpc": "2.0", "id": 1, "result": {
        "protocolVersion": "2025-03-26", "capabilities": {},
        "serverInfo": {"name": "mock", "version": "0"}
    }})
    .to_string()
}

fn tools_body() -> String {
    json!({"jsonrpc": "2.0", "id": 2, "result": {"tools": [
        {"name": "echo", "description": "Echo input",
         "inputSchema": {"type": "object"},
         "annotations": {"readOnlyHint": true}},
        {"name": "write_file", "description": "Write a file",
         "inputSchema": {"type": "object"}}
    ]}})
    .to_string()
}

/// Script the full bring-up: initialize → 202 for the notification → list.
fn script_handshake(transport: &MockTransport) {
    transport.push_ok(200, &init_body());
    transport.push_ok(202, "");
    transport.push_ok(200, &tools_body());
}

fn registered(transport: Rc<MockTransport>) -> (ToolRegistry, Vec<McpServerStatus>) {
    let mut reg = ToolRegistry::new();
    let statuses = block_on(register_mcp(&mut reg, transport, &[cfg(SERVER)]));
    (reg, statuses)
}

fn call(reg: &ToolRegistry, name: &str, args: Value) -> ToolResult {
    let tool = reg.get(name).expect("tool registered");
    block_on(tool.call(args, &mut ToolCtx::default()))
}

#[test]
fn remote_tools_register_with_prefixed_names_and_effects() {
    let transport = Rc::new(MockTransport::new());
    script_handshake(&transport);
    let (reg, statuses) = registered(transport.clone());
    assert_eq!(statuses.len(), 1);
    assert!(statuses[0].ok, "{:?}", statuses[0].error);
    assert!(statuses[0].error.is_none());
    assert_eq!(
        reg.names(),
        vec!["mcp_srv_example_mcp_echo", "mcp_srv_example_mcp_write_file"]
    );
    // The status lists exactly what got registered, by registry name.
    assert_eq!(statuses[0].tools, reg.names());
    // readOnlyHint=true → Pure; no annotations → Mutating (gate default).
    let echo = reg.get("mcp_srv_example_mcp_echo").unwrap().spec();
    assert_eq!(echo.effect, Effect::Pure);
    assert_eq!(echo.description, "Echo input");
    let write = reg.get("mcp_srv_example_mcp_write_file").unwrap().spec();
    assert_eq!(write.effect, Effect::Mutating);

    // The handshake went out in order with the JSON-RPC envelope intact.
    let requests = transport.requests.borrow();
    assert_eq!(requests.len(), 3);
    let init: Value = serde_json::from_str(&requests[0].body).unwrap();
    assert_eq!(init["method"], "initialize");
    assert_eq!(init["jsonrpc"], "2.0");
    assert_eq!(init["params"]["protocolVersion"], "2025-03-26");
    let note: Value = serde_json::from_str(&requests[1].body).unwrap();
    assert_eq!(note["method"], "notifications/initialized");
    assert!(note.get("id").is_none(), "notification must carry no id");
    let list: Value = serde_json::from_str(&requests[2].body).unwrap();
    assert_eq!(list["method"], "tools/list");
    assert!(requests
        .iter()
        .all(|r| r.method == "POST" && r.url == SERVER.trim_end_matches('/')));
}

#[test]
fn call_round_trip_joins_text_content() {
    let transport = Rc::new(MockTransport::new());
    script_handshake(&transport);
    let (reg, _) = registered(transport.clone());
    transport.push_ok(
        200,
        &json!({"jsonrpc": "2.0", "id": 4, "result": {"content": [
            {"type": "text", "text": "hello"},
            {"type": "image", "data": "..."},
            {"type": "text", "text": "world"}
        ]}})
        .to_string(),
    );
    let out = call(&reg, "mcp_srv_example_mcp_echo", json!({"text": "hi"}));
    assert!(out.ok, "{}", out.content);
    assert_eq!(out.content, "hello\n[image content]\nworld");
    // The wire call names the REMOTE tool, not the prefixed registry name.
    let requests = transport.requests.borrow();
    let body: Value = serde_json::from_str(&requests[3].body).unwrap();
    assert_eq!(body["method"], "tools/call");
    assert_eq!(body["params"]["name"], "echo");
    assert_eq!(body["params"]["arguments"]["text"], "hi");
    assert!(requests[3]
        .headers
        .iter()
        .any(|(k, v)| k == "Accept" && v.contains("text/event-stream")));
}

#[test]
fn sse_wrapped_responses_parse_like_plain_json() {
    let transport = Rc::new(MockTransport::new());
    // Whole handshake arrives SSE-framed, with the content-type header set
    // on one response and detection-by-shape covering the others.
    transport.push(Ok(HttpResponse {
        status: 200,
        headers: vec![("Content-Type".into(), "text/event-stream".into())],
        body: format!("event: message\ndata: {}\n\n", init_body()),
    }));
    transport.push_ok(202, "");
    transport.push_ok(200, &format!("data: {}\n\n", tools_body()));
    let (reg, statuses) = registered(transport.clone());
    assert!(statuses[0].ok, "{:?}", statuses[0].error);
    assert_eq!(reg.names().len(), 2);

    transport.push_ok(
        200,
        &format!(
            "data: {}\n\n",
            json!({"jsonrpc": "2.0", "id": 4, "result":
                   {"content": [{"type": "text", "text": "streamed"}]}})
        ),
    );
    let out = call(&reg, "mcp_srv_example_mcp_echo", json!({}));
    assert!(out.ok, "{}", out.content);
    assert_eq!(out.content, "streamed");
}

#[test]
fn dead_server_is_an_error_status_not_a_boot_failure() {
    // MockTransport with an empty script answers every send with a Connect
    // error — the unreachable-server shape. Empty URLs are skipped silently.
    let transport = Rc::new(MockTransport::new());
    let mut reg = ToolRegistry::new();
    let statuses = block_on(register_mcp(&mut reg, transport, &[cfg(SERVER), cfg("")]));
    assert_eq!(statuses.len(), 1, "empty URL yields no status");
    assert!(!statuses[0].ok);
    assert_eq!(statuses[0].url, SERVER.trim_end_matches('/'));
    let err = statuses[0].error.as_deref().unwrap();
    assert!(err.contains("unreachable"), "{err}");
    assert!(statuses[0].tools.is_empty());
    assert!(reg.names().is_empty());
}

#[test]
fn one_dead_server_does_not_block_the_next() {
    let transport = Rc::new(MockTransport::new());
    transport.push_ok(500, "boom"); // server A dies at initialize
    script_handshake(&transport); // server B is healthy
    let mut reg = ToolRegistry::new();
    let statuses = block_on(register_mcp(
        &mut reg,
        transport,
        &[cfg("https://dead.example"), cfg(SERVER)],
    ));
    assert_eq!(statuses.len(), 2);
    assert!(!statuses[0].ok);
    assert_eq!(statuses[0].url, "https://dead.example");
    assert!(
        statuses[0].error.as_deref().unwrap().contains("HTTP 500"),
        "{:?}",
        statuses[0].error
    );
    assert!(statuses[1].ok);
    assert_eq!(reg.names().len(), 2, "healthy server still registered");
}

#[test]
fn tool_error_content_and_rpc_errors_are_readable() {
    let transport = Rc::new(MockTransport::new());
    script_handshake(&transport);
    let (reg, _) = registered(transport.clone());
    // isError: true → ok=false carrying the server's text.
    transport.push_ok(
        200,
        &json!({"jsonrpc": "2.0", "id": 4, "result": {"isError": true,
               "content": [{"type": "text", "text": "file not found"}]}})
        .to_string(),
    );
    let out = call(&reg, "mcp_srv_example_mcp_write_file", json!({}));
    assert!(!out.ok);
    assert!(out.content.contains("file not found"));
    // JSON-RPC error object → ok=false with code and message.
    transport.push_ok(
        200,
        &json!({"jsonrpc": "2.0", "id": 5,
               "error": {"code": -32602, "message": "invalid params"}})
        .to_string(),
    );
    let out = call(&reg, "mcp_srv_example_mcp_write_file", json!({}));
    assert!(!out.ok);
    assert!(out.content.contains("-32602") && out.content.contains("invalid params"));
    // Garbage body → readable parse error, not a panic.
    transport.push_ok(200, "<html>gateway error</html>");
    let out = call(&reg, "mcp_srv_example_mcp_write_file", json!({}));
    assert!(!out.ok);
    assert!(out.content.contains("bad JSON"), "{}", out.content);
}

#[test]
fn session_id_from_initialize_rides_every_later_request() {
    let transport = Rc::new(MockTransport::new());
    transport.push(Ok(HttpResponse {
        status: 200,
        headers: vec![("Mcp-Session-Id".into(), "abc-123".into())],
        body: init_body(),
    }));
    transport.push_ok(202, "");
    transport.push_ok(200, &tools_body());
    let (_reg, statuses) = registered(transport.clone());
    assert!(statuses[0].ok, "{:?}", statuses[0].error);
    let requests = transport.requests.borrow();
    let sid = |i: usize| {
        requests[i]
            .headers
            .iter()
            .find(|(k, _)| k == "Mcp-Session-Id")
            .map(|(_, v)| v.as_str())
    };
    assert_eq!(sid(0), None, "initialize opens the session");
    assert_eq!(sid(1), Some("abc-123"));
    assert_eq!(sid(2), Some("abc-123"));
}

#[test]
fn server_list_parses_lines_and_skips_blanks() {
    assert_eq!(
        parse_server_list("https://a.example/mcp\n\n  https://b.example  \n"),
        vec!["https://a.example/mcp", "https://b.example"]
    );
    assert!(parse_server_list("").is_empty());
    assert!(parse_server_list("  \n \n").is_empty());
}

#[test]
fn json_config_parses_with_defaults_and_legacy_text_falls_back() {
    let text = r#"[
        {"url": "https://a.example/mcp",
         "headers": {"Authorization": "Bearer k"}, "allow": ["echo"]},
        {"name": "b", "url": "https://b.example", "enabled": false}
    ]"#;
    let configs = parse_servers(text);
    assert_eq!(configs.len(), 2);
    assert_eq!(configs[0].name, "a_example_mcp", "missing name → URL slug");
    assert!(configs[0].enabled, "enabled defaults to true");
    assert_eq!(configs[0].headers["Authorization"], "Bearer k");
    assert_eq!(configs[0].allow, vec!["echo"]);
    assert_eq!(configs[1].name, "b");
    assert!(!configs[1].enabled);

    // Legacy newline text still parses, mapping onto all-default configs.
    let legacy = parse_servers("https://a.example/mcp\n\nhttps://b.example\n");
    assert_eq!(legacy.len(), 2);
    assert_eq!(legacy[0].url, "https://a.example/mcp");
    assert_eq!(legacy[0].name, "a_example_mcp");
    assert!(legacy[0].enabled && legacy[0].headers.is_empty() && legacy[0].allow.is_empty());
    assert!(parse_servers("").is_empty());
}

#[test]
fn configured_headers_ride_every_post_but_cannot_clobber_protocol() {
    let transport = Rc::new(MockTransport::new());
    script_handshake(&transport);
    let mut server = cfg(SERVER);
    server
        .headers
        .insert("Authorization".into(), "Bearer k".into());
    server.headers.insert("content-type".into(), "evil".into());
    server.headers.insert("Accept".into(), "evil".into());
    let mut reg = ToolRegistry::new();
    let statuses = block_on(register_mcp(&mut reg, transport.clone(), &[server]));
    assert!(statuses[0].ok, "{:?}", statuses[0].error);
    for r in transport.requests.borrow().iter() {
        assert!(
            r.headers
                .iter()
                .any(|(k, v)| k == "Authorization" && v == "Bearer k"),
            "configured header missing on {}",
            r.body
        );
        let content_types: Vec<&str> = r
            .headers
            .iter()
            .filter(|(k, _)| k.eq_ignore_ascii_case("content-type"))
            .map(|(_, v)| v.as_str())
            .collect();
        assert_eq!(content_types, vec!["application/json"]);
        let accepts: Vec<&str> = r
            .headers
            .iter()
            .filter(|(k, _)| k.eq_ignore_ascii_case("accept"))
            .map(|(_, v)| v.as_str())
            .collect();
        assert_eq!(accepts, vec!["application/json, text/event-stream"]);
    }
}

#[test]
fn disabled_server_is_noted_but_never_contacted() {
    let transport = Rc::new(MockTransport::new());
    let mut server = cfg(SERVER);
    server.enabled = false;
    let mut reg = ToolRegistry::new();
    let statuses = block_on(register_mcp(&mut reg, transport.clone(), &[server]));
    assert_eq!(statuses.len(), 1);
    assert!(!statuses[0].ok);
    assert!(statuses[0].error.is_none(), "disabled is not an error");
    assert!(statuses[0].tools.is_empty());
    assert!(reg.names().is_empty());
    assert!(transport.requests.borrow().is_empty(), "no wire traffic");
}

#[test]
fn allowlist_filters_registration_and_status_lists_registered_tools() {
    let transport = Rc::new(MockTransport::new());
    script_handshake(&transport);
    let mut server = cfg(SERVER);
    server.allow = vec!["echo".into()];
    let mut reg = ToolRegistry::new();
    let statuses = block_on(register_mcp(&mut reg, transport, &[server]));
    assert!(statuses[0].ok, "{:?}", statuses[0].error);
    assert!(statuses[0].error.is_none(), "filtered-out is not an error");
    assert_eq!(reg.names(), vec!["mcp_srv_example_mcp_echo"]);
    assert_eq!(statuses[0].tools, vec!["mcp_srv_example_mcp_echo"]);
}
