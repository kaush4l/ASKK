// The default way to run ASKK: the Next dev server (hot reload, debugging)
// with the host API (companion/host-api.js) on the same origin under
// /__askk/, so the app runs in local mode with the machine's capabilities.
//
//   bun run dev [--root <dir>] [--port 3000] [--hostname 127.0.0.1] [--read-only]
//               [--agents <dir> …]   custom team folders (default: ASKK_AGENTS)
//   bun run dev --desks custom [--desk trade-desk] --port 1111
//               every desk (custom/<desk>/desk.js) in one process on one port; the header's
//               desk switcher (cookie askk_desk) or the x-askk-desk header picks the desk
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
import { createTeam, findTeamServer, teamStorageDir } from "../companion/team.js"
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { realpath } from "node:fs/promises"
import { listDesks, loadDesk } from "../companion/desk.js"

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    root: { type: "string" },
    port: { type: "string" }, // default: the desk's port, else PORT, else 3000
    hostname: { type: "string", default: "127.0.0.1" },
    "read-only": { type: "boolean", default: false },
    agents: { type: "string", multiple: true, default: [] },
    desks: { type: "string" }, // a folder of desks (custom): every desk in one process
    desk: { type: "string" }, // with --desks: the one a new tab opens (default: the first)
    "with-public": { type: "boolean", default: false },
    "browser-engines": { type: "boolean", default: false },
  },
})
const MAX_BODY = 16 * 1024 * 1024

// One process, one port, every desk: --desks custom hosts each desk in that
// folder (companion/desk.js) with its own team, host API, wakes and
// integrations. A request reaches a desk by the x-askk-desk header (scripts,
// cron: server.json names it) or the askk_desk cookie (the header's desk
// switcher, POST desks/select); otherwise the default desk.
// Without --desks: one team (--agents / --root), as before.
const hosted = new Map() // desk name -> { api, team, desk }
let fallback = null // the default desk's name
const singleLog = (line) => console.error(line)
let port
let logRoot // the default desk's workspace: its state/ holds server.log

if (args.desks) {
  const folders = listDesks(args.desks)
  if (!folders.length) {
    console.error(`No desks in ${args.desks} (folders with a desk.js).`)
    process.exit(1)
  }
  port = Number(args.port ?? process.env.PORT ?? 3000)
  for (const folder of folders) {
    const desk = await loadDesk(folder)
    const root = await realpath(desk.workspace)
    const running = findTeamServer(root)
    if (running) {
      console.error(`ASKK already runs desk ${desk.name}: http://localhost:${running.port}/ (pid ${running.pid}). Stop it first.`)
      process.exit(1)
    }
    const team = createTeam({ root, agentDirs: [folder], port, desk: desk.name, log: (line) => console.error(`${desk.name}: ${line}`) })
    const api = await createHostApi({ root, team, port, name: "askk-companion", agentDirs: [folder], desk: { name: desk.name, description: desk.description } })
    hosted.set(desk.name, { api, team, desk })
  }
  fallback = hosted.has(args.desk ?? process.env.ASKK_DESK) ? (args.desk ?? process.env.ASKK_DESK) : [...hosted.keys()][0]
  logRoot = await realpath(hosted.get(fallback).desk.workspace)
} else {
  const agentDirs = agentDirsFrom(args.agents)
  // One team for every tab (companion/team.js), unless --browser-engines: then
  // each tab runs its own engines, as the static build does.
  const root = await realpath(await rootFrom(args.root, agentDirs))
  // A desk alone brings its port and its own Next build folder (Next locks one
  // `next dev` per distDir), so it can also run beside another server.
  const desk = await loadDesk(agentDirs[0])
  if (desk) process.env.ASKK_DIST_DIR ??= `.next-desks/${desk.name}`
  port = Number(args.port ?? desk?.port ?? process.env.PORT ?? 3000)
  // One instance per workspace: a second server would run a second team on
  // the same memory and files.
  const running = args["browser-engines"] ? null : findTeamServer(root)
  if (running) {
    console.error(`ASKK already runs this workspace's team: http://localhost:${running.port}/ (pid ${running.pid}). Open that, or stop it first.`)
    process.exit(1)
  }
  const team = args["browser-engines"] ? null : createTeam({ root, readOnly: args["read-only"], agentDirs, withPublic: args["with-public"], port, log: singleLog })
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
  fallback = desk?.name ?? "default"
  logRoot = root
  hosted.set(fallback, { api, team, desk })
}

// The server's own log (launchd writes it, opened for append; ASKK_SERVER_LOG
// names it) is capped: past 5 MB it keeps its newest 1 MB.
const serverLog = process.env.ASKK_SERVER_LOG ?? join(teamStorageDir(logRoot), "server.log")
setInterval(() => {
  try {
    if (!existsSync(serverLog) || statSync(serverLog).size <= 5 * 1024 * 1024) return
    const text = readFileSync(serverLog, "utf8")
    writeFileSync(serverLog, `…(older lines cut at ${new Date().toISOString()})\n${text.slice(-1024 * 1024)}`)
  } catch {}
}, 10 * 60 * 1000).unref()

const cookieDesk = (cookie = "") => /(?:^|;\s*)askk_desk=([^;]+)/.exec(cookie)?.[1]
const pick = (req) => {
  const name = req.headers["x-askk-desk"] ?? cookieDesk(req.headers.cookie)
  return hosted.has(name) ? name : fallback
}
const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`])

// GET desks: { current, desks: [{ name, description }] }; POST desks/select
// { name }: sets the askk_desk cookie (same-origin JSON only, like the host API).
async function desksEndpoint(req, path) {
  if (!allowedHosts().has(req.headers.host)) return Response.json({ error: "Host capabilities answer on localhost only." }, { status: 421 })
  const list = () => [...hosted.values()].map(({ desk }) => ({ name: desk?.name ?? fallback, description: desk?.description ?? "" }))
  if (path === "desks" && req.method === "GET") return Response.json({ current: pick(req), default: fallback, desks: list() })
  if (path === "desks/select" && req.method === "POST") {
    const origin = req.headers.origin ?? ""
    if (!allowedHosts().has(origin.replace(/^http:\/\//, "")) || !String(req.headers["content-type"]).includes("application/json")) {
      return Response.json({ error: "Desk switches need a same-origin JSON request." }, { status: 403 })
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const name = JSON.parse(Buffer.concat(chunks).toString() || "{}").name
    if (!hosted.has(name)) return Response.json({ error: `No desk "${name}".` }, { status: 404 })
    return new Response(JSON.stringify({ current: name }), {
      headers: { "content-type": "application/json", "set-cookie": `askk_desk=${name}; Path=/; SameSite=Strict; Max-Age=31536000` },
    })
  }
  return Response.json({ error: "Not found." }, { status: 404 })
}

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
      const path = req.url.slice(API_PREFIX.length).split("?")[0]
      if (path === "desks" || path === "desks/select") return sendResponse(res, await desksEndpoint(req, path))
      const request = await toRequest(req, gone.signal)
      if (!request) return sendResponse(res, Response.json({ error: "Too large." }, { status: 413 }))
      return sendResponse(res, await hosted.get(pick(req)).api.handle(request))
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
  for (const [name, { team }] of hosted) team?.announce(port, args.desks ? name : null)
  if (args.desks) console.log(`ASKK desks · ${[...hosted.keys()].join(", ")} (default ${fallback})`)
  console.log(`ASKK dev · http://localhost:${port}/`)
  for (const [name, entry] of hosted) {
    const api = entry.api
    if (!api) continue
    console.log(`  ${args.desks ? `${name.padEnd(12)} ` : "workspace  "}${api.root} (${api.capabilities.includes("fs.write") ? "read + write" : "read-only"})`)
  }
})
