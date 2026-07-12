//! MCP client tests over the public registry surface: scripted
//! `MockTransport` handshakes, prefixed registration, Pure/Mutating mapping
//! from annotations, call round-trips, SSE-wrapped replies, and dead-server
//! resilience. Zero network.

use std::rc::Rc;

use askk_core::{Effect, ToolCtx, ToolResult};
use askk_inference::{HttpResponse, MockTransport};
use askk_runtime::testutil::block_on;
use askk_runtime::tools::{parse_server_list, register_mcp, ToolRegistry};
use serde_json::{json, Value};

const SERVER: &str = "https://srv.example/mcp";

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

fn registered(transport: Rc<MockTransport>) -> (ToolRegistry, Vec<String>) {
    let mut reg = ToolRegistry::new();
    let problems = block_on(register_mcp(&mut reg, transport, &[SERVER.to_string()]));
    (reg, problems)
}

fn call(reg: &ToolRegistry, name: &str, args: Value) -> ToolResult {
    let tool = reg.get(name).expect("tool registered");
    block_on(tool.call(args, &mut ToolCtx::default()))
}

#[test]
fn remote_tools_register_with_prefixed_names_and_effects() {
    let transport = Rc::new(MockTransport::new());
    script_handshake(&transport);
    let (reg, problems) = registered(transport.clone());
    assert!(problems.is_empty(), "{problems:?}");
    assert_eq!(
        reg.names(),
        vec!["mcp_srv_example_mcp_echo", "mcp_srv_example_mcp_write_file"]
    );
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
    let (reg, problems) = registered(transport.clone());
    assert!(problems.is_empty(), "{problems:?}");
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
fn dead_server_is_a_problem_string_not_a_boot_failure() {
    // MockTransport with an empty script answers every send with a Connect
    // error — the unreachable-server shape.
    let transport = Rc::new(MockTransport::new());
    let mut reg = ToolRegistry::new();
    let problems = block_on(register_mcp(
        &mut reg,
        transport,
        &[SERVER.to_string(), String::new()],
    ));
    assert_eq!(problems.len(), 1);
    assert!(problems[0].contains(SERVER.trim_end_matches('/')));
    assert!(problems[0].contains("unreachable"), "{}", problems[0]);
    assert!(reg.names().is_empty());
}

#[test]
fn one_dead_server_does_not_block_the_next() {
    let transport = Rc::new(MockTransport::new());
    transport.push_ok(500, "boom"); // server A dies at initialize
    script_handshake(&transport); // server B is healthy
    let mut reg = ToolRegistry::new();
    let problems = block_on(register_mcp(
        &mut reg,
        transport,
        &["https://dead.example".to_string(), SERVER.to_string()],
    ));
    assert_eq!(problems.len(), 1);
    assert!(problems[0].contains("dead.example"));
    assert!(problems[0].contains("HTTP 500"), "{}", problems[0]);
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
    let (_reg, problems) = registered(transport.clone());
    assert!(problems.is_empty(), "{problems:?}");
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
