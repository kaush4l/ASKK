// ASKK generic MCP (Model Context Protocol) shell worker.
//
// This is the "shell" that turns a server *definition* into a running MCP server,
// entirely in the browser. It is a single, no-build classic Web Worker: NO bundler,
// NO npm dependency, NO `import`. The Rust runtime ("shellize") prepends one line
//
//     self.ASKK_MCP_DEFINITION = { ...the server's tools... };
//
// to this file, turns the result into a Blob URL, and spawns it as a worker. The
// definition author writes ONLY tool logic; this shell supplies all of the MCP /
// JSON-RPC protocol around it.
//
// Wire format (frozen — identical to assets/mcp_reference_server.js, which the Rust
// transport depends on):
//   * Inbound:  `event.data` is a JSON *string* (a JSON-RPC request). Parsed here.
//   * Outbound: `self.postMessage(JSON.stringify(response))` — always a string.
//   * Correlate by `id`; the response echoes the request's `id`.
//   * Notifications (`notifications/*`, or no `id`) get NO reply.
//
// The injected definition is `{ name?, tools: [ { name, description?, inputSchema?,
// handler } ] }` where `handler` is the JS *body* of an async function taking `args`
// (the parsed tool arguments). Its return value is normalized into an MCP result:
//   * string / number / boolean  -> a single text block
//   * an object shaped like `{ content: [...], isError? }` -> passed through verbatim
//   * any other object / array    -> pretty-printed JSON text block
//   * a thrown error              -> a tool-level error result (`isError: true`)

const PROTOCOL_VERSION = "2024-11-05";

// The constructor for `async function` literals, so a handler body can use `await`.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// The injected definition (see header). Default to an empty server so a missing or
// malformed injection degrades to "no tools" instead of throwing on load.
const DEFINITION =
  self.ASKK_MCP_DEFINITION && typeof self.ASKK_MCP_DEFINITION === "object"
    ? self.ASKK_MCP_DEFINITION
    : { name: "askk-shell-mcp", tools: [] };

const SERVER_NAME =
  typeof DEFINITION.name === "string" && DEFINITION.name.trim()
    ? DEFINITION.name.trim()
    : "askk-shell-mcp";

// Compile each tool once at load: build the public `tools/list` shape and a handler
// table keyed by name. A handler that fails to compile is kept as a deferred error so
// calling it returns a clean tool-level error rather than crashing the worker.
const TOOLS = [];
const HANDLERS = new Map();

for (const tool of Array.isArray(DEFINITION.tools) ? DEFINITION.tools : []) {
  if (!tool || typeof tool.name !== "string" || !tool.name) {
    continue; // Unnamed tools are unaddressable; skip them.
  }
  TOOLS.push({
    name: tool.name,
    description: typeof tool.description === "string" ? tool.description : "",
    inputSchema:
      tool.inputSchema && typeof tool.inputSchema === "object"
        ? tool.inputSchema
        : { type: "object" },
  });
  const body = typeof tool.handler === "string" ? tool.handler : "";
  try {
    HANDLERS.set(tool.name, { fn: new AsyncFunction("args", body) });
  } catch (error) {
    HANDLERS.set(tool.name, { error: "Handler failed to compile: " + String(error) });
  }
}

self.onmessage = async (event) => {
  let request;
  try {
    request =
      typeof event.data === "string" ? JSON.parse(event.data) : event.data;
  } catch (error) {
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
    const result = await dispatch(request);
    if (isNotification) {
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
    sendError(
      request == null ? null : request.id,
      -32603,
      "Internal error: " + String(error),
    );
  }
};

// Route a parsed JSON-RPC request. Returns the JSON-RPC `result` on success, or a
// `{ __error, code, message }` marker the caller turns into a JSON-RPC error. May be
// async (tool handlers can await).
async function dispatch(request) {
  const method = request && request.method;

  switch (method) {
    case "initialize":
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: "0.1.0" },
      };

    case "notifications/initialized":
      return null;

    case "tools/list":
      return { tools: TOOLS };

    case "tools/call":
      return await callTool(request.params || {});

    default:
      return rpcError(-32601, "Method not found: " + String(method));
  }
}

// Handle `tools/call`: params are `{ name, arguments }`. Returns an MCP
// `CallToolResult`, or a JSON-RPC error marker for an unknown tool.
async function callTool(params) {
  const name = params.name;
  const entry = HANDLERS.get(name);
  if (!entry) {
    return rpcError(-32602, "Unknown tool: " + String(name));
  }
  if (entry.error) {
    return errorResult(entry.error);
  }

  const args =
    params.arguments && typeof params.arguments === "object"
      ? params.arguments
      : {};
  try {
    const value = await entry.fn(args);
    return normalizeResult(value);
  } catch (error) {
    // A handler throwing is a tool-level error, not a protocol error: report it as a
    // result with `isError: true` so the agent sees the message and can react.
    return errorResult(String((error && error.message) || error));
  }
}

// Normalize whatever a handler returned into an MCP `CallToolResult`.
function normalizeResult(value) {
  if (value == null) {
    return textResult("");
  }
  // A handler may return a full MCP result (with optional `isError`); pass it through.
  if (typeof value === "object" && Array.isArray(value.content)) {
    return value;
  }
  const type = typeof value;
  if (type === "string") {
    return textResult(value);
  }
  if (type === "number" || type === "boolean" || type === "bigint") {
    return textResult(String(value));
  }
  // Any other object/array: pretty JSON so the agent gets structured output as text.
  try {
    return textResult(JSON.stringify(value, null, 2));
  } catch (_error) {
    return textResult(String(value));
  }
}

// Build an MCP text `CallToolResult`.
function textResult(text) {
  return { content: [{ type: "text", text }] };
}

// Build a tool-level error `CallToolResult` (`isError: true`).
function errorResult(message) {
  return { content: [{ type: "text", text: message }], isError: true };
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
