#!/usr/bin/env node
// Minimal, dependency-free stdio MCP server for verifying the ASKK local
// bridge's process-backed MCP relay (`/askk/mcp/spawn | send | kill`) without
// Chrome or any npm install. It speaks newline-delimited JSON-RPC 2.0 over
// stdin/stdout, the same framing the bridge uses to talk to a real stdio MCP
// server (e.g. `npx chrome-devtools-mcp@latest`).
//
// Implements just enough of the MCP handshake to round-trip end to end:
//   - initialize          -> protocolVersion "2024-11-05" + serverInfo
//   - notifications/*      -> processed, no reply (per JSON-RPC notifications)
//   - tools/list           -> one tool, `echo`
//   - tools/call (echo)    -> echoes its `text` argument back as a text block
//
// Run it directly to eyeball the framing:
//   echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | node scripts/mcp-stdio-stub.mjs

const PROTOCOL_VERSION = "2024-11-05";

const ECHO_TOOL = {
    name: "echo",
    description: "Echo the provided text back verbatim.",
    inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
    },
};

function result(id, value) {
    return { jsonrpc: "2.0", id, result: value };
}

function error(id, code, message) {
    return { jsonrpc: "2.0", id, error: { code, message } };
}

function handle(message) {
    const { id, method, params } = message ?? {};

    // Notifications (method starts with "notifications/" or no id) get no reply.
    if (id == null || (typeof method === "string" && method.startsWith("notifications/"))) {
        return null;
    }

    switch (method) {
        case "initialize":
            return result(id, {
                protocolVersion: PROTOCOL_VERSION,
                capabilities: { tools: {} },
                serverInfo: { name: "askk-mcp-stdio-stub", version: "0.1.0" },
            });
        case "tools/list":
            return result(id, { tools: [ECHO_TOOL] });
        case "tools/call": {
            const name = params?.name;
            if (name !== "echo") {
                return error(id, -32602, `Unknown tool: ${String(name)}`);
            }
            const text = String(params?.arguments?.text ?? "");
            return result(id, { content: [{ type: "text", text }] });
        }
        default:
            return error(id, -32601, `Method not found: ${String(method)}`);
    }
}

function send(response) {
    if (response != null) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
    }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
            let message;
            try {
                message = JSON.parse(line);
            } catch {
                send(error(null, -32700, "Parse error"));
                newlineIndex = buffer.indexOf("\n");
                continue;
            }
            send(handle(message));
        }
        newlineIndex = buffer.indexOf("\n");
    }
});
process.stdin.on("end", () => process.exit(0));
