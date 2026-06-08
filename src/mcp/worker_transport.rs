//! Browser Web Worker transport for MCP (wasm only).
//!
//! Wraps a classic [`web_sys::Worker`] running the reference MCP server and speaks
//! JSON-RPC over `postMessage`. Multiple requests can be in flight at once: each is
//! correlated by its JSON-RPC id through a `pending` map of oneshot senders. Mirrors
//! the classic-worker plumbing in `src/browser_exec.rs`, but keeps the event
//! closures owned by the struct so `terminate()` + drop tears the worker down
//! cleanly.

#![cfg(target_arch = "wasm32")]

use crate::mcp::protocol::JsonRpcError;
use crate::mcp::protocol::JsonRpcRequest;
use crate::mcp::protocol::JsonRpcResponse;
use crate::mcp::transport::{McpTransport, ResponseFuture};
use crate::state::AppResult;
use futures_channel::oneshot;
use serde_json::Value;
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use wasm_bindgen::{JsCast, JsValue, closure::Closure};

/// How long to wait for a correlated response before giving up on a request, so a
/// dead or wedged server can never hang the agent loop forever.
const REQUEST_TIMEOUT_MS: u32 = 30_000;

/// The generic MCP shell worker, bundled at compile time. A shellized server is this
/// source with one `self.ASKK_MCP_DEFINITION = {...};` line prepended (see
/// [`WorkerMcpTransport::connect_shellized`]).
const SHELL_WORKER_JS: &str = include_str!("../../assets/mcp_shell_worker.js");

/// The in-flight request table: JSON-RPC id -> the oneshot sender awaiting its
/// response.
type Pending = Rc<RefCell<HashMap<u64, oneshot::Sender<JsonRpcResponse>>>>;

/// A [`McpTransport`] backed by a browser Web Worker running an MCP server.
pub struct WorkerMcpTransport {
    worker: web_sys::Worker,
    pending: Pending,
    /// For a shellized server, the Blob object URL the worker was spawned from. It is
    /// revoked on drop so the in-memory Blob is released; `None` for a server loaded
    /// from a static module URL (nothing to revoke).
    object_url: Option<String>,
    // The event handlers are kept owned (not `.forget()`-ed) so they live exactly as
    // long as the transport and are dropped when it is.
    _onmessage: Closure<dyn FnMut(web_sys::MessageEvent)>,
    _onerror: Closure<dyn FnMut(web_sys::ErrorEvent)>,
}

impl WorkerMcpTransport {
    /// Connect to an MCP server hosted at `url` as a **classic** Web Worker (the
    /// reference server is a classic worker, not a module).
    pub fn connect(url: &str) -> AppResult<Self> {
        Self::from_url(url, None)
    }

    /// "Shellize" a server definition into a running worker: prepend the definition to
    /// the bundled generic shell worker, publish the result as a Blob URL, and spawn
    /// it. `definition_json` is the already-serialized [`McpServerDefinition`] JSON the
    /// shell reads from `self.ASKK_MCP_DEFINITION`. No bundler, no static asset — the
    /// whole server is assembled and run in the tab.
    pub fn connect_shellized(definition_json: &str) -> AppResult<Self> {
        let source = format!("self.ASKK_MCP_DEFINITION = {definition_json};\n{SHELL_WORKER_JS}");
        let url = object_url_for_source(&source)?;
        match Self::from_url(&url, Some(url.clone())) {
            Ok(transport) => Ok(transport),
            Err(err) => {
                // Spawning failed: revoke the URL we just created so it doesn't leak.
                let _ = web_sys::Url::revoke_object_url(&url);
                Err(err)
            }
        }
    }

    /// Spawn the worker at `url`, wire up the message/error closures, and build the
    /// transport. `object_url`, if set, is revoked when the transport is dropped.
    fn from_url(url: &str, object_url: Option<String>) -> AppResult<Self> {
        let worker = web_sys::Worker::new(url)
            .map_err(|err| format!("Unable to start the MCP worker `{url}`: {err:?}"))?;

        let pending: Pending = Rc::new(RefCell::new(HashMap::new()));

        let pending_msg = Rc::clone(&pending);
        let onmessage = Closure::<dyn FnMut(web_sys::MessageEvent)>::wrap(Box::new(
            move |event: web_sys::MessageEvent| {
                let Some(text) = event.data().as_string() else {
                    return;
                };
                // Parse leniently: we correlate by the numeric id we issued, but a
                // spec-compliant server may reply with a string or null id (e.g. the
                // mandated `id: null` on a parse error), which a strict `u64` parse
                // would reject and silently drop — stalling the call until timeout.
                let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
                    return;
                };
                // A response carries `result` or `error`; a server-initiated
                // notification carries neither and is not correlated.
                if value.get("result").is_none() && value.get("error").is_none() {
                    return;
                }
                let mut pending = pending_msg.borrow_mut();
                let target_id = match value.get("id").and_then(serde_json::Value::as_u64) {
                    // Numeric id: correlate exactly. An unmatched numeric id is a
                    // stale/duplicate reply — drop it rather than guess.
                    Some(id) => Some(id).filter(|id| pending.contains_key(id)),
                    // Null/string/absent id can't be correlated by value. The client
                    // is strictly sequential (one request outstanding), so deliver to
                    // the sole in-flight request instead of hanging until the timeout.
                    None => (pending.len() == 1)
                        .then(|| pending.keys().next().copied())
                        .flatten(),
                };
                let Some(id) = target_id else {
                    return;
                };
                if let Some(tx) = pending.remove(&id) {
                    let response = JsonRpcResponse {
                        jsonrpc: "2.0".to_string(),
                        id,
                        result: value.get("result").cloned(),
                        error: value.get("error").and_then(|err| {
                            serde_json::from_value::<JsonRpcError>(err.clone()).ok()
                        }),
                    };
                    let _ = tx.send(response);
                }
            },
        ));
        worker.set_onmessage(Some(onmessage.as_ref().unchecked_ref()));

        let pending_err = Rc::clone(&pending);
        let onerror = Closure::<dyn FnMut(web_sys::ErrorEvent)>::wrap(Box::new(
            move |event: web_sys::ErrorEvent| {
                web_sys::console::error_1(&JsValue::from_str(&format!(
                    "MCP worker error at {}:{}: {}",
                    event.filename(),
                    event.lineno(),
                    event.message()
                )));
                // The worker failed (e.g. the module 404'd or threw on load).
                // `Worker::new` already returned Ok, so the only way an in-flight
                // request learns of this is here: drop every pending sender so the
                // awaiting `send` futures resolve immediately on the "worker closed"
                // arm instead of waiting out the 30s timeout.
                pending_err.borrow_mut().clear();
            },
        ));
        worker.set_onerror(Some(onerror.as_ref().unchecked_ref()));

        Ok(Self {
            worker,
            pending,
            object_url,
            _onmessage: onmessage,
            _onerror: onerror,
        })
    }

    /// Terminate the underlying worker. Idempotent. Teardown helper, not yet wired
    /// into the registry's disconnect path.
    #[allow(dead_code)]
    pub fn terminate(&self) {
        self.worker.terminate();
    }
}

/// Publish `source` as a same-origin Blob URL hosting a classic worker. The
/// `text/javascript` MIME type keeps strict browsers happy about starting the worker.
fn object_url_for_source(source: &str) -> AppResult<String> {
    let parts = js_sys::Array::new();
    parts.push(&JsValue::from_str(source));
    let options = web_sys::BlobPropertyBag::new();
    options.set_type("text/javascript");
    let blob = web_sys::Blob::new_with_str_sequence_and_options(&parts, &options)
        .map_err(|err| format!("Unable to build the MCP worker blob: {err:?}"))?;
    web_sys::Url::create_object_url_with_blob(&blob)
        .map_err(|err| format!("Unable to create the MCP worker URL: {err:?}"))
}

impl McpTransport for WorkerMcpTransport {
    fn send(&self, request: JsonRpcRequest) -> ResponseFuture<'_> {
        let worker = self.worker.clone();
        let pending = Rc::clone(&self.pending);
        Box::pin(async move {
            let id = request.id;
            let payload = serde_json::to_string(&request)
                .map_err(|err| format!("Unable to encode MCP request: {err}"))?;

            let (tx, rx) = oneshot::channel::<JsonRpcResponse>();
            pending.borrow_mut().insert(id, tx);

            if let Err(err) = worker.post_message(&JsValue::from_str(&payload)) {
                // Don't leak the pending entry if the post fails.
                pending.borrow_mut().remove(&id);
                return Err(format!("Unable to send MCP request: {err:?}"));
            }

            // Race the response against a hard timeout so a dead server can't hang us.
            let timeout = gloo_timers::future::TimeoutFuture::new(REQUEST_TIMEOUT_MS);
            match futures_util::future::select(rx, timeout).await {
                futures_util::future::Either::Left((Ok(response), _)) => Ok(response),
                futures_util::future::Either::Left((Err(_), _)) => {
                    pending.borrow_mut().remove(&id);
                    Err("MCP worker closed before responding.".to_string())
                }
                futures_util::future::Either::Right(_) => {
                    pending.borrow_mut().remove(&id);
                    Err(format!(
                        "MCP request timed out after {REQUEST_TIMEOUT_MS} ms."
                    ))
                }
            }
        })
    }

    fn notify(&self, notification: Value) -> AppResult<()> {
        let payload = serde_json::to_string(&notification)
            .map_err(|err| format!("Unable to encode MCP notification: {err}"))?;
        self.worker
            .post_message(&JsValue::from_str(&payload))
            .map_err(|err| format!("Unable to send MCP notification: {err:?}"))
    }
}

impl Drop for WorkerMcpTransport {
    fn drop(&mut self) {
        // Tear the worker down so the headless test gets clean teardown.
        self.worker.terminate();
        // Release the Blob a shellized server was spawned from (no-op for module URLs).
        if let Some(url) = &self.object_url {
            let _ = web_sys::Url::revoke_object_url(url);
        }
    }
}

/// Headless-browser integration test for the in-browser MCP worker round-trip.
///
/// This is an in-crate `wasm_bindgen_test` (rather than a `tests/` integration test)
/// because `askk` is a binary crate with no library target, so `tests/` files cannot
/// reach `WorkerMcpTransport`. Run it with a webdriver against a real browser:
///
/// ```text
/// wasm-pack test --headless --safari
/// ```
///
/// The reference server is loaded from a Blob URL built out of the bundled
/// `assets/mcp_reference_server.js`, so the test needs no static-asset server.
#[cfg(test)]
mod browser_tests {
    use super::WorkerMcpTransport;
    use crate::mcp::client::McpClient;
    use serde_json::json;
    use wasm_bindgen::JsValue;
    use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

    wasm_bindgen_test_configure!(run_in_browser);

    /// The reference MCP server source, bundled into the test so it can be served
    /// from a Blob URL (no asset pipeline involved).
    const REFERENCE_SERVER_JS: &str = include_str!("../../assets/mcp_reference_server.js");

    /// Build a same-origin Blob URL hosting the reference server as a classic worker.
    /// The `text/javascript` MIME type keeps Safari happy about starting the worker.
    fn reference_server_blob_url() -> String {
        let parts = js_sys::Array::new();
        parts.push(&JsValue::from_str(REFERENCE_SERVER_JS));
        let options = web_sys::BlobPropertyBag::new();
        options.set_type("text/javascript");
        let blob = web_sys::Blob::new_with_str_sequence_and_options(&parts, &options)
            .expect("create reference-server blob");
        web_sys::Url::create_object_url_with_blob(&blob).expect("create object URL")
    }

    #[wasm_bindgen_test]
    async fn mcp_worker_initialize_list_and_call_add() {
        let url = reference_server_blob_url();

        // Spawn the worker + connect the transport.
        let transport = WorkerMcpTransport::connect(&url).expect("connect to MCP worker");
        let client = McpClient::new(transport);

        // initialize handshake.
        client.initialize().await.expect("initialize handshake");

        // tools/list returns exactly the reference server's two tools.
        let tools = client.list_tools().await.expect("tools/list");
        let mut names: Vec<String> = tools.into_iter().map(|tool| tool.name).collect();
        names.sort();
        assert_eq!(names, vec!["add".to_string(), "echo".to_string()]);

        // tools/call: add(2, 3) -> "5" (numeric result carried as MCP text content).
        let result = client
            .call_tool("add", json!({ "a": 2, "b": 3 }))
            .await
            .expect("tools/call add");
        // The reference server omits `isError` on success; MCP treats an absent
        // `isError` as false, so assert only that the call was not flagged an error.
        assert_ne!(result.is_error, Some(true));
        assert_eq!(result.text().trim(), "5");
        assert_eq!(
            result.text().trim().parse::<i64>().expect("numeric result"),
            5
        );

        // Tear down cleanly: dropping the client drops the transport, whose Drop
        // terminates the worker. Revoke the Blob URL too.
        drop(client);
        let _ = web_sys::Url::revoke_object_url(&url);
    }

    /// End-to-end "shellize" round-trip: take a bare tool *definition* (no hand-written
    /// worker, no static asset), wrap it in the generic shell worker, and prove the
    /// agent can discover and call its tools — including an async handler and a handler
    /// that throws (which must surface as a tool-level error, not a transport fault).
    #[wasm_bindgen_test]
    async fn shellized_definition_runs_in_a_worker() {
        let definition = json!({
            "name": "Calc",
            "tools": [
                {
                    "name": "multiply",
                    "description": "Multiply two numbers.",
                    "inputSchema": {
                        "type": "object",
                        "properties": { "a": { "type": "number" }, "b": { "type": "number" } },
                        "required": ["a", "b"]
                    },
                    "handler": "return String(Number(args.a) * Number(args.b));"
                },
                {
                    "name": "async_echo",
                    "description": "Echo via an awaited promise.",
                    "inputSchema": { "type": "object", "properties": { "text": { "type": "string" } } },
                    "handler": "return await Promise.resolve(String(args.text));"
                },
                {
                    "name": "boom",
                    "description": "Always throws.",
                    "inputSchema": { "type": "object" },
                    "handler": "throw new Error('kaboom');"
                }
            ]
        })
        .to_string();

        // connect_shellized assembles shell + definition into a Blob and spawns it.
        let transport =
            WorkerMcpTransport::connect_shellized(&definition).expect("shellize the definition");
        let client = McpClient::new(transport);

        client.initialize().await.expect("initialize handshake");

        let mut names: Vec<String> = client
            .list_tools()
            .await
            .expect("tools/list")
            .into_iter()
            .map(|tool| tool.name)
            .collect();
        names.sort();
        assert_eq!(
            names,
            vec![
                "async_echo".to_string(),
                "boom".to_string(),
                "multiply".to_string()
            ]
        );

        // A sync handler returns text.
        let product = client
            .call_tool("multiply", json!({ "a": 6, "b": 7 }))
            .await
            .expect("tools/call multiply");
        assert_ne!(product.is_error, Some(true));
        assert_eq!(product.text().trim(), "42");

        // An async (awaiting) handler works because the shell compiles handlers as
        // async functions.
        let echoed = client
            .call_tool("async_echo", json!({ "text": "hi" }))
            .await
            .expect("tools/call async_echo");
        assert_ne!(echoed.is_error, Some(true));
        assert_eq!(echoed.text().trim(), "hi");

        // A throwing handler is a tool-level error (isError), not a transport failure:
        // the call still resolves Ok, with the message carried in the result.
        let boom = client
            .call_tool("boom", json!({}))
            .await
            .expect("tools/call boom still resolves");
        assert_eq!(boom.is_error, Some(true));
        assert!(boom.text().contains("kaboom"), "got: {}", boom.text());

        drop(client);
    }
}
