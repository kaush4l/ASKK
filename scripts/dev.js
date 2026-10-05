// The default way to run ASKK: the Next dev server (hot reload, debugging)
// with the host API (companion/host-api.js) on the same origin under
// /__askk/, so the app runs in local mode with the machine's capabilities.
//
//   bun run dev [--root <dir>] [--port 3000] [--hostname 127.0.0.1] [--read-only]
//               [--agents <dir> …]   custom team folders (default: ASKK_AGENTS)
//
// No --agents: the public agents (public/agents/). --agents custom/<team>: that
// team only (its agents/ folder, tools from its mcp.json). --root is the
// workspace agents work on (default: the team's data/ folder, else the folder
// dev was started from). --hostname 0.0.0.0 lets phones on the network open the app; the host
// API still answers only on localhost, so they get the browser-only mode.

import { createServer } from "node:http"
import { parseArgs } from "node:util"
import next from "next"

import { API_PREFIX, agentDirsFrom, createHostApi, rootFrom } from "../companion/host-api.js"
import { createTeam, findTeamServer } from "../companion/team.js"
import { realpath } from "node:fs/promises"

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    root: { type: "string" },
    port: { type: "string", default: process.env.PORT ?? "3000" },
    hostname: { type: "string", default: "127.0.0.1" },
    "read-only": { type: "boolean", default: false },
    agents: { type: "string", multiple: true, default: [] },
    "with-public": { type: "boolean", default: false },
    "browser-engines": { type: "boolean", default: false },
  },
})
const port = Number(args.port)
const MAX_BODY = 16 * 1024 * 1024

const agentDirs = agentDirsFrom(args.agents)
// One team for every tab (companion/team.js), unless --browser-engines: then
// each tab runs its own engines, as the static build does.
const root = await realpath(await rootFrom(args.root, agentDirs))
// One instance per workspace: a second server would run a second team on
// the same memory and files.
const running = args["browser-engines"] ? null : findTeamServer(root)
if (running) {
  console.error(`ASKK already runs this workspace's team: http://localhost:${running.port}/ (pid ${running.pid}). Open that, or stop it first.`)
  process.exit(1)
}
const team = args["browser-engines"]
  ? null
  : createTeam({ root, readOnly: args["read-only"], agentDirs, withPublic: args["with-public"], log: (line) => console.error(line) })
const api = await createHostApi({
  root,
  team,
  readOnly: args["read-only"],
  port,
  name: "askk-companion",
  agentDirs,
  withPublic: args["with-public"],
  listen: !team, // a continuous server: integration listeners run (Telegram, …); with a team, in the team
})

// node:http request -> Fetch Request (host API requests only).
async function toRequest(req, signal) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value != null) headers.set(key, Array.isArray(value) ? value.join(", ") : value)
  }
  let body
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_BODY) return null
      chunks.push(chunk)
    }
    body = Buffer.concat(chunks)
  }
  return new Request(`http://${req.headers.host ?? "localhost"}${req.url}`, { method: req.method, headers, body, signal })
}

// Streamed as it comes (a local model's answer arrives in parts).
async function sendResponse(res, response) {
  res.writeHead(response.status, Object.fromEntries(response.headers))
  if (!response.body) return res.end()
  try {
    for await (const chunk of response.body) {
      if (res.destroyed) break
      res.write(chunk)
    }
  } finally {
    res.end()
  }
}

const server = createServer(async (req, res) => {
  if (req.url.startsWith(API_PREFIX)) {
    try {
      // The page went away (reload, Stop): abort, so a local model stops too.
      const gone = new AbortController()
      res.on("close", () => res.writableEnded || gone.abort())
      const request = await toRequest(req, gone.signal)
      if (!request) return sendResponse(res, Response.json({ error: "Too large." }, { status: 413 }))
      return sendResponse(res, await api.handle(request))
    } catch (error) {
      return sendResponse(res, Response.json({ error: error.message }, { status: 500 }))
    }
  }
  return handle(req, res)
})

const app = next({ dev: true, hostname: args.hostname, port, httpServer: server })
const handle = app.getRequestHandler()
await app.prepare()

// A team call (`ask`) lasts as long as the run, often well past node's 5 minute
// request limit.
server.requestTimeout = 0

server.listen(port, args.hostname, () => {
  team?.announce(port)
  console.log(`ASKK dev · http://localhost:${port}/`)
  console.log(`  workspace  ${api.root} (${api.capabilities.includes("fs.write") ? "read + write" : "read-only"})`)
})
