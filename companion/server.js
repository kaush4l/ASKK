// ASKK companion — the built app plus the host API, compiled into one
// program (scripts/build-companion.js). Run it from a folder and open the
// printed URL: the page and the API share one origin, so there is no CORS,
// no mixed content, and Safari works as-is. For development use `bun run dev`
// (scripts/dev.js): the same host API on the Next dev server, with hot reload.
//
//   askk [--root <dir>] [--port 7717] [--read-only] [--agents <dir> …]
//   askk ask [options] "query"     headless: answer on stdout (companion/ask.js)
//
// The app stays a static export; this only serves it and provides
// capabilities (companion/host-api.js). It never runs agents or holds app
// state. Listens on 127.0.0.1 only.

import { stat } from "node:fs/promises"
import { extname, resolve, sep } from "node:path"
import { parseArgs } from "node:util"

import { API_PREFIX, VERSION, agentDirsFrom, createHostApi, rootFrom } from "./host-api.js"
import { createTeam, findTeamServer } from "./team.js"
import { realpath } from "node:fs/promises"

// The app: embedded when compiled (assets.gen.js maps URL path -> file),
// else read from out/ next to this file (run `bun --bun next build` first).
const embedded = (await import("./assets.gen.js").catch(() => null))?.default ?? null

// `askk ask …`: headless, one query, answer on stdout (companion/ask.js).
if (Bun.argv[2] === "ask") await (await import("./ask.js")).main(Bun.argv.slice(3), { embedded })

const { values: args } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    root: { type: "string" },
    port: { type: "string", default: "7717" },
    "read-only": { type: "boolean", default: false },
    agents: { type: "string", multiple: true, default: [] },
    "with-public": { type: "boolean", default: false },
    "browser-engines": { type: "boolean", default: false },
  },
})
const port = Number(args.port)
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
  : createTeam({ root, readOnly: args["read-only"], agentDirs, withPublic: args["with-public"], embedded, port, log: (line) => console.error(line) })
const api = await createHostApi({
  root,
  team,
  readOnly: args["read-only"],
  port,
  agentDirs,
  withPublic: args["with-public"],
  listen: !team, // a continuous server: integration listeners run (Telegram, …); with a team, in the team
})

const outDir = resolve(import.meta.dir, "../out")

async function asset(pathname) {
  const candidates = pathname.endsWith("/")
    ? [`${pathname}index.html`]
    : [pathname, `${pathname}.html`, `${pathname}/index.html`]
  for (const candidate of candidates) {
    if (embedded) {
      if (embedded[candidate]) return Bun.file(embedded[candidate])
      continue
    }
    const file = resolve(outDir, `.${candidate}`)
    if (!file.startsWith(outDir + sep)) continue
    const blob = Bun.file(file)
    if ((await blob.exists()) && (await stat(file)).isFile()) return blob
  }
  return null
}

const TYPES = { ".html": "text/html; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".md": "text/markdown; charset=utf-8" }

async function serveApp(pathname) {
  const found = await asset(pathname)
  const file = found ?? (await asset("/404.html"))
  if (!file) return new Response("App not built. Run `bun --bun next build`.", { status: 404 })
  const type = TYPES[extname(file.name ?? pathname)] ?? file.type
  return new Response(file, { status: found ? 200 : 404, headers: { "content-type": type } })
}

const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  idleTimeout: 0, // a local model may think for minutes (host-api pings while streaming)
  async fetch(request) {
    // DNS-rebinding guard: only requests addressed to this server.
    if (!allowedHosts.has(request.headers.get("host"))) return new Response("Bad host", { status: 421 })
    const url = new URL(request.url)
    if (url.pathname.startsWith(API_PREFIX)) return api.handle(request)
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 })
    return serveApp(decodeURIComponent(url.pathname))
  },
})

team?.announce(server.port)
console.log(`ASKK companion ${VERSION}`)
console.log(`  workspace  ${api.root} (${api.capabilities.includes("fs.write") ? "read + write" : "read-only"})`)
console.log(`  open       http://localhost:${server.port}/`)
