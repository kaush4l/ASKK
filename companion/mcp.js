// MCP (Model Context Protocol) client for the host API: ASKK connects to the
// MCP servers the owner lists in `.mcp.json` and offers their tools to
// agents (backend/features/mcp/). Servers are connected lazily, on first use,
// and kept running.
//
//   const mcp = await createMcp({ files })  null when no file lists a server
//   mcp.names                               configured server names
//   await mcp.tools()                       [{ name, ok, error?, approval, tools: [{ name, title, description, inputSchema, annotations }] }]
//   await mcp.call(server, tool, args)      { text, isError }
//
// `.mcp.json`, in the folder ASKK starts in (the common format):
//
//   { "mcpServers": {
//       "files":  { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
//                   "env": { "KEY": "value" }, "cwd": "." },
//       "remote": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer …" } },
//       "oauth":  { "url": "https://…/mcp", "oauth": "${TOKEN_FILE}" },  (companion/oauth-file.js)
//       "…":      { …, "approval": "auto" | "always" | "never" } } }
//
// Several files merge (the owner's .mcp.json, then each private agent
// folder's mcp.json); a server name may appear once. A stdio server's cwd
// is resolved against its own file's folder.
//
// stdio servers are local programs (newline-delimited JSON-RPC on stdin and
// stdout); url servers speak Streamable HTTP (JSON or SSE replies,
// Mcp-Session-Id). approval: "auto" (default) asks the owner before every
// call except tools the server marks read-only (readOnlyHint); "always"
// asks for every call; "never" asks for none. The file is read once, at
// startup, and the host API refuses agent writes to it.

import { dirname, resolve } from "node:path"
import { expandEnv, oauthHeaders } from "./oauth-file.js"

const PROTOCOL = "2025-06-18"
const TIMEOUT = 60_000 // ms per request (tools/call: 5 min)
const MAX_TEXT = 60_000 // characters of a result returned
const SAFE = /^[a-z][a-z0-9_-]*$/i // server names (they prefix tool names)

class McpError extends Error {
  status = 502
}

// ── transports: send(message) and onMessage(handler) ───────────────────────

function stdioTransport({ command, args = [], env = {}, cwd }, base) {
  const proc = Bun.spawn([command, ...args], {
    cwd: cwd ? resolve(base, cwd) : base,
    env: { ...process.env, ...env },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  let handler = () => {}
  let stderr = ""
  let closed = null
  ;(async () => {
    const decoder = new TextDecoder()
    let buffer = ""
    for await (const chunk of proc.stdout) {
      buffer += decoder.decode(chunk, { stream: true })
      let newline
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        let message
        try {
          message = JSON.parse(line)
        } catch {
          continue // a log line on stdout; not a message
        }
        handler(message)
      }
    }
  })().catch(() => {})
  ;(async () => {
    const decoder = new TextDecoder()
    for await (const chunk of proc.stderr) stderr = (stderr + decoder.decode(chunk, { stream: true })).slice(-2000)
  })().catch(() => {})
  proc.exited.then((code) => {
    closed = `exited (${code})${stderr.trim() ? `: ${stderr.trim().split("\n").at(-1)}` : ""}`
    handler(null)
  })
  return {
    onMessage: (fn) => (handler = fn),
    send: async (message) => {
      if (closed) throw new McpError(`The server ${closed}.`)
      proc.stdin.write(`${JSON.stringify(message)}\n`)
      proc.stdin.flush()
    },
    closed: () => closed,
    close: () => proc.kill(),
  }
}

function httpTransport({ url, headers = {}, oauth }, base) {
  let handler = () => {}
  let session = null
  const tokenFile = oauth ? resolve(base, expandEnv(oauth)) : null
  const post = async (message, force) =>
    fetch(url, {
      method: "POST",
      headers: {
        ...headers,
        ...(tokenFile ? await oauthHeaders(tokenFile, { force }) : {}),
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL,
        ...(session ? { "mcp-session-id": session } : {}),
      },
      body: JSON.stringify(message),
    }).catch((error) => {
      throw new McpError(error instanceof McpError ? error.message : `Cannot reach ${url}: ${error.message}`)
    })
  return {
    onMessage: (fn) => (handler = fn),
    async send(message) {
      let response = await post(message, false)
      // A token revoked early: refresh once and retry.
      if (response.status === 401 && tokenFile) response = await post(message, true)
      session = response.headers.get("mcp-session-id") ?? session
      if (!response.ok && response.status !== 202) throw new McpError(`${url} answered ${response.status}.`)
      if (response.status === 202 || !response.body) return
      const type = response.headers.get("content-type") ?? ""
      if (type.includes("text/event-stream")) {
        // One SSE stream per request: every `data:` event is a message.
        const text = await response.text()
        for (const event of text.split(/\r?\n\r?\n/)) {
          const data = event
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n")
          if (data) handler(JSON.parse(data))
        }
      } else {
        const body = await response.json().catch(() => null)
        for (const item of Array.isArray(body) ? body : body ? [body] : []) handler(item)
      }
    },
    closed: () => null,
    close: () => {
      if (session) fetch(url, { method: "DELETE", headers: { ...headers, "mcp-session-id": session } }).catch(() => {})
    },
  }
}

// ── one server: JSON-RPC over a transport ──────────────────────────────────

function connection(name, config, base) {
  const transport = config.url ? httpTransport(config, base) : stdioTransport(config, base)
  const pending = new Map()
  let nextId = 0

  transport.onMessage((message) => {
    if (message === null) {
      // The process ended: fail everything still waiting.
      for (const { reject } of pending.values()) reject(new McpError(`MCP server ${name} ${transport.closed()}.`))
      pending.clear()
      return
    }
    if (message.id != null && !message.method && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new McpError(`${name}: ${message.error.message ?? "error"}`))
      else resolve(message.result)
      return
    }
    // A request from the server: answer ping; ASKK offers no sampling,
    // roots or elicitation.
    if (message.id != null && message.method) {
      const reply =
        message.method === "ping"
          ? { jsonrpc: "2.0", id: message.id, result: {} }
          : { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Not supported by ASKK." } }
      transport.send(reply).catch(() => {})
    }
  })

  function request(method, params, timeout = TIMEOUT) {
    const id = ++nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new McpError(`${name}: ${method} timed out after ${timeout / 1000}s.`))
      }, timeout)
      pending.set(id, {
        resolve: (value) => (clearTimeout(timer), resolve(value)),
        reject: (error) => (clearTimeout(timer), reject(error)),
      })
      transport.send({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }).catch((error) => {
        pending.get(id)?.reject(error)
        pending.delete(id)
      })
    })
  }

  const ready = (async () => {
    await request("initialize", {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: "askk", version: "0.1.0" },
    })
    await transport.send({ jsonrpc: "2.0", method: "notifications/initialized" })
  })()

  return {
    ready,
    request,
    alive: () => !transport.closed(),
    close: () => transport.close(),
  }
}

// MCP content blocks -> text for the agent.
function resultText(result) {
  const parts = (result?.content ?? []).map((block) => {
    if (block.type === "text") return block.text
    if (block.type === "resource") return block.resource?.text ?? `[resource ${block.resource?.uri ?? ""}]`
    if (block.type === "resource_link") return `[resource ${block.uri}${block.name ? ` — ${block.name}` : ""}]`
    return `[${block.type}${block.mimeType ? ` ${block.mimeType}` : ""}]`
  })
  if (!parts.length && result?.structuredContent) parts.push(JSON.stringify(result.structuredContent, null, 2))
  const text = parts.join("\n").trim() || "(no output)"
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n… (cut at ${MAX_TEXT} characters)` : text
}

// ── the configured servers ─────────────────────────────────────────────────

export async function readMcpConfig(file) {
  const source = Bun.file(file)
  if (!(await source.exists())) return null
  let parsed
  try {
    parsed = JSON.parse(await source.text())
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`)
  }
  const servers = parsed?.mcpServers ?? parsed?.servers ?? {}
  for (const [name, config] of Object.entries(servers)) {
    if (!SAFE.test(name)) throw new Error(`${file}: server name "${name}" must be letters, digits, _ or - (it prefixes tool names).`)
    if (!config?.command && !config?.url) throw new Error(`${file}: server "${name}" needs "command" or "url".`)
  }
  return servers
}

export async function createMcp({ files = [] }) {
  const servers = {}
  const bases = {}
  for (const file of files) {
    for (const [name, config] of Object.entries((await readMcpConfig(file)) ?? {})) {
      if (Object.hasOwn(servers, name)) throw new Error(`MCP server "${name}" is defined twice (${bases[name]} and ${dirname(file)}).`)
      servers[name] = config
      bases[name] = dirname(file)
    }
  }
  if (!Object.keys(servers).length) return null
  const live = new Map() // name -> connection
  const lists = new Map() // name -> Promise<tools>

  async function connect(name) {
    let conn = live.get(name)
    if (conn && !conn.alive()) {
      live.delete(name)
      lists.delete(name)
      conn = null
    }
    if (!conn) {
      conn = connection(name, servers[name], bases[name])
      const started = conn
      live.set(name, started)
      started.ready.catch(() => {
        started.close()
        if (live.get(name) === started) live.delete(name)
      })
    }
    await conn.ready
    return conn
  }

  async function listTools(name) {
    const conn = await connect(name)
    const tools = []
    let cursor
    do {
      const page = await conn.request("tools/list", cursor ? { cursor } : {})
      tools.push(...(page?.tools ?? []))
      cursor = page?.nextCursor
    } while (cursor && tools.length < 1000)
    return tools.map(({ name: tool, title, description, inputSchema, annotations }) => ({
      name: tool,
      title: title ?? annotations?.title ?? null,
      description: description ?? "",
      inputSchema: inputSchema ?? { type: "object" },
      annotations: annotations ?? {},
    }))
  }

  const approvalOf = (name) => (["always", "never"].includes(servers[name].approval) ? servers[name].approval : "auto")

  process.on("exit", () => {
    for (const conn of live.values()) conn.close()
  })

  return {
    names: Object.keys(servers),
    async tools() {
      return Promise.all(
        Object.keys(servers).map(async (name) => {
          if (!lists.has(name)) {
            const list = listTools(name)
            lists.set(name, list)
            list.catch(() => lists.delete(name)) // try again next time
          }
          try {
            return { name, ok: true, approval: approvalOf(name), tools: await lists.get(name) }
          } catch (error) {
            return { name, ok: false, approval: approvalOf(name), error: error.message, tools: [] }
          }
        })
      )
    },
    async call(server, tool, args = {}) {
      if (!Object.hasOwn(servers, server)) throw Object.assign(new McpError(`Unknown MCP server "${server}".`), { status: 404 })
      if (typeof tool !== "string" || !tool) throw Object.assign(new McpError("A tool name is required."), { status: 400 })
      const conn = await connect(server)
      const result = await conn.request("tools/call", { name: tool, arguments: args ?? {} }, 5 * TIMEOUT)
      return { text: resultText(result), isError: !!result?.isError }
    },
  }
}
