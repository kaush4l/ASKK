// ASKK reference MCP (Model Context Protocol) server.
//
// A hand-written, single-file, no-build classic Web Worker that implements a
// minimal but spec-compliant MCP server speaking JSON-RPC 2.0 over postMessage.
// There is deliberately NO bundler, NO npm dependency, and NO `import` here — the
// whole server is this one static `.js` file, loaded same-origin (via the Dioxus
// `asset!()` macro at runtime, or from a Blob URL in the headless test).
//
// Wire format (frozen — the Rust transport depends on it):
//   * Inbound:  `event.data` is a JSON *string* containing a JSON-RPC request.
//     We parse it with `JSON.parse`. (We also tolerate a pre-parsed object.)
//   * Outbound: we reply with `self.postMessage(JSON.stringify(response))` — the
//     response is always a *string* (the Rust side reads `event.data().as_string()`).
//   * Correlate by `id`: the response echoes the request's `id`.
//   * Notifications (method starts with `notifications/`, or no `id`) get NO reply.
//
// Tools exposed: `echo` (returns its `text` argument) and `add` (returns a + b).

// Protocol version we advertise in `initialize`. Matches the MCP spec revision
// the rest of the contract is written against.
const PROTOCOL_VERSION = "2024-11-05";

// Static tool definitions returned by `tools/list`. Note the key is `inputSchema`
// (camelCase) per the MCP spec, and each schema is a plain JSON Schema object.
const TOOLS = [
  {
    name: "echo",
    description: "Echo the provided text back verbatim.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "add",
    description: "Add two numbers and return the sum as text.",
    inputSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  },
];

self.onmessage = (event) => {
  let request;
  try {
    // Inbound messages are JSON strings; tolerate a pre-parsed object too.
    request =
      typeof event.data === "string" ? JSON.parse(event.data) : event.data;
  } catch (error) {
    // We could not recover an id, so reply with `id: null` per JSON-RPC.
    sendError(null, -32700, "Parse error: " + String(error));
    return;
  }

  // A request with no `id`, or any `notifications/*` method, is a notification:
  // process it but never reply.
  const isNotification =
    request == null ||
    request.id === undefined ||
    request.id === null ||
    (typeof request.method === "string" &&
      request.method.startsWith("notifications/"));

  try {
    const result = dispatch(request);
    if (isNotification) {
      // Notifications get no response, even if dispatch produced a value.
      return;
    }
    if (result && result.__error) {
      sendError(request.id, result.code, result.message);
    } else {
      sendResult(request.id, result);
    }
  } catch (error) {
    if (isNotification) {
      return;
    }
    // Any unexpected exception becomes an internal JSON-RPC error.
    sendError(
      request == null ? null : request.id,
      -32603,
      "Internal error: " + String(error),
    );
  }
};

// Route a parsed JSON-RPC request to its handler. Returns the JSON-RPC `result`
// object on success, or a `{ __error, code, message }` marker the caller turns
// into a JSON-RPC error. Throwing is also fine — onmessage maps it to -32603.
function dispatch(request) {
  const method = request && request.method;

  switch (method) {
    case "initialize":
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "askk-reference-mcp", version: "0.1.0" },
      };

    case "notifications/initialized":
      // Notification: accepted, no reply (the onmessage guard suppresses output).
      return null;

    case "tools/list":
      return { tools: TOOLS };

    case "tools/call":
      return callTool(request.params || {});

    default:
      return rpcError(-32601, "Method not found: " + String(method));
  }
}

// Handle a `tools/call` request: params are `{ name, arguments }`. Returns an MCP
// `CallToolResult` (`{ content: [{ type: "text", text }] }`) or an error marker.
function callTool(params) {
  const name = params.name;
  const args = params.arguments || {};

  switch (name) {
    case "echo": {
      const text = typeof args.text === "string" ? args.text : String(args.text);
      return textResult(text);
    }
    case "add": {
      const sum = Number(args.a) + Number(args.b);
      return textResult(String(sum));
    }
    default:
      return rpcError(-32602, "Unknown tool: " + String(name));
  }
}

// Build an MCP text `CallToolResult`.
function textResult(text) {
  return { content: [{ type: "text", text }] };
}

// Marker for "return a JSON-RPC error" from a handler.
function rpcError(code, message) {
  return { __error: true, code, message };
}

// Send a JSON-RPC 2.0 success response (always a JSON string).
function sendResult(id, result) {
  self.postMessage(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

// Send a JSON-RPC 2.0 error response (always a JSON string).
function sendError(id, code, message) {
  self.postMessage(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }),
  );
}
