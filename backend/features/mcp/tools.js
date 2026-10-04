// MCP tools: every tool of an MCP server the owner configured (.mcp.json,
// read by the host: companion/mcp.js) is one Tool object, McpTool. Calling
// it asks the host to call the tool on that server.
//
// agent.md lists servers under `mcp:` — `mcp: [github]` gives the agent
// every tool of the github server; `mcp: [github.create_issue]` only that
// one; `mcp: ["*"]` every server in .mcp.json (and says nothing when there
// is none). Tools are named `<server>.<tool>`.
//
// Approval follows the server's entry: "auto" (default) asks the owner
// before every call except tools the server marks read-only (readOnlyHint),
// "always" asks for all, "never" for none. MCP needs the local host (bun run
// dev / askk); in the browser-only build the agent is told they are
// unavailable.

import { Tool } from "@/backend/core/tool"
import { withBase } from "@/backend/platform/base-path"
import { detectHost, hasCapability } from "@/backend/platform/host"

async function api(endpoint, body) {
  let response
  try {
    response = await fetch(withBase(`/__askk/${endpoint}`), {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    })
  } catch {
    throw new Error("The ASKK companion is not reachable.")
  }
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) throw new Error(data?.error ?? `MCP request failed (${response.status}).`)
  return data
}

const NAME = /[^A-Za-z0-9_.-]/g // characters a tool call cannot name
const quote = (s = "", n = 120) => (s.length > n ? `${s.slice(0, n)}…` : s)

export class McpTool extends Tool {
  constructor({ server, tool, approval = "auto" }) {
    const readOnly = tool.annotations?.readOnlyHint === true
    super({
      name: `${server}.${tool.name.replace(NAME, "_")}`,
      description: [tool.title, tool.description].filter(Boolean).join(" — ") || `${tool.name} (MCP server ${server})`,
      inputs: tool.inputSchema ?? { type: "object" },
      effect: readOnly ? "read" : "write",
      approval: approval === "always" || (approval === "auto" && !readOnly),
      describe: (inputs) => {
        const args = JSON.stringify(inputs ?? {})
        return `Call ${tool.title ?? tool.name} on the MCP server “${server}”${args === "{}" ? "" : ` with ${quote(args)}`}.`
      },
    })
    this.server = server
    this.tool = tool.name
  }

  async invoke(inputs = {}) {
    const { text, isError } = await api("mcp/call", { server: this.server, tool: this.tool, arguments: inputs ?? {} })
    if (isError) throw new Error(text)
    return text
  }
}

// What the host offers, fetched once per thread (again after a failure).
let offered = null
function offeredServers() {
  offered ??= detectHost().then(async (host) => {
    if (!hasCapability(host, "mcp")) return null
    return (await api("mcp/tools")).servers
  })
  offered.catch(() => (offered = null))
  return offered
}

// The tools for an agent's `mcp:` entries, and the CONTEXT lines saying what
// is connected. Never throws: a server that fails is reported in a line.
export async function loadMcpTools(entries = []) {
  if (!entries.length) return { tools: [], lines: [] }
  let servers
  try {
    servers = await offeredServers()
  } catch (error) {
    return { tools: [], lines: [`MCP: could not list tools (${error.message}).`] }
  }
  const everything = entries.includes("*")
  if (!servers) {
    if (everything && entries.length === 1) return { tools: [], lines: [] }
    return { tools: [], lines: ["MCP: not available here (needs ASKK running locally with a .mcp.json); MCP tools are missing."] }
  }

  const tools = []
  const lines = []
  const byName = new Map(servers.map((s) => [s.name, s]))
  // "github" -> every tool; "github.create_issue" -> that tool.
  const wanted = new Map(everything ? servers.map((s) => [s.name, new Set(["*"])]) : [])
  for (const entry of entries.filter((e) => e !== "*")) {
    const [server, ...rest] = entry.split(".")
    if (!wanted.has(server)) wanted.set(server, new Set())
    wanted.get(server).add(rest.length ? rest.join(".") : "*")
  }
  for (const [name, picks] of wanted) {
    const server = byName.get(name)
    if (!server) {
      lines.push(`MCP ${name}: not configured in .mcp.json.`)
      continue
    }
    if (!server.ok) {
      lines.push(`MCP ${name}: unavailable (${server.error}).`)
      continue
    }
    const chosen = picks.has("*") ? server.tools : server.tools.filter((t) => picks.has(t.name))
    for (const tool of chosen) tools.push(new McpTool({ server: name, tool, approval: server.approval }))
    const missing = [...picks].filter((p) => p !== "*" && !server.tools.some((t) => t.name === p))
    lines.push(
      `MCP ${name}: ${chosen.length} tool${chosen.length === 1 ? "" : "s"} (${name}.*)` +
        (missing.length ? `; not offered by the server: ${missing.join(", ")}` : "") +
        "."
    )
  }
  return { tools, lines }
}
