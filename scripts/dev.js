// The default way to run ASKK: the desks (companion/server/desks.js: each desk's kernel team, host API, wake book,
// tool servers, integrations) and the live UI on the Next dev server (hot reload, debugging), on one port, the
// host API same-origin under /__askk/.
//
//   bun run dev [--desks custom] [--desk <name>] [--only a,b] [--port 1111] [--hostname 127.0.0.1] [--read-only]
//               every desk (custom/<desk>/main.js) in one process; the header's desk switcher (cookie askk_desk)
//               or the x-askk-desk header picks the desk
//   bun run dev --agents custom/<desk>
//               that desk alone (default ASKK_AGENTS), on its own port and Next build folder (.next-desks/<name>),
//               so it can run beside the desks' server
//
// --hostname 0.0.0.0 lets phones on the network open the app; the host API still answers only on localhost, so
// they get the "no desk here" page.

import { createServer } from "node:http" // Next's adapter only (see "Next.js renders the pages" below)
import { parseArgs } from "node:util"
import next from "next"

import { API_PREFIX } from "../companion/server/host-api.js"
import { hostDesks } from "../companion/server/desks.js"
import { DESK_OPTIONS, deskDirFrom } from "../companion/shared/args.js"
import { hostedDeskFolders, loadDesk } from "../companion/team/desk.js"
import { DEFAULT_PORT } from "../companion/shared/config.js"
import { rankImports, walkImports, writeImports } from "./home-imports.js"
import { warmPages, writeWarm } from "./warm-pages.js"

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    ...DESK_OPTIONS,
    port: { type: "string" }, // default: the desk's port, else PORT, else 3000
    hostname: { type: "string", default: "127.0.0.1" },
    "read-only": { type: "boolean", default: false },
    desks: { type: "string" }, // a folder of desks (custom): every desk in one process
    desk: { type: "string" }, // with --desks: the one a new tab opens (default: the first)
    only: { type: "string" }, // with --desks: host only these desks (comma list of folder names)
  },
})
const MAX_BODY = 16 * 1024 * 1024

// One desk alone (--agents / ASKK_AGENTS, without --desks), else every desk of --desks (default custom/).
const alone = args.desks ? null : deskDirFrom(args.agents)
let folders
let port
if (alone) {
  const desk = await loadDesk(alone)
  if (!desk) {
    console.error(`${alone} is not a desk (no main.js).`)
    process.exit(1)
  }
  folders = [desk.folder]
  process.env.ASKK_DIST_DIR ??= `.next-desks/${desk.name}` // Next allows one `next dev` per build folder
  port = Number(args.port ?? desk.port ?? process.env.PORT ?? DEFAULT_PORT)
} else {
  const only = args.only ? new Set(args.only.split(",").map((s) => s.trim()).filter(Boolean)) : null
  folders = hostedDeskFolders({ desks: args.desks ?? "custom", only }) // the core desks (desks/) and the local ones
  port = Number(args.port ?? process.env.PORT ?? DEFAULT_PORT)
}
if (!folders.length) {
  console.error(`No desks in ${args.desks ?? "custom"} (folders with a main.js).`)
  process.exit(1)
}
const desks = await hostDesks({ folders, port, defaultDesk: args.desk ?? process.env.ASKK_DESK, readOnly: args["read-only"] }).catch((error) => {
  console.error(error.message)
  process.exit(1)
})

// The server's own log (launchd writes it, opened for append; ASKK_SERVER_LOG names it) is capped: past 5 MB it
// keeps its newest 1 MB.
setInterval(async () => {
  try {
    const log = Bun.file(desks.serverLog) // size 0 when missing
    if (log.size <= 5 * 1024 * 1024) return
    const text = await log.text()
    await Bun.write(desks.serverLog, `…(older lines cut at ${new Date().toISOString()})\n${text.slice(-1024 * 1024)}`) // in place: launchd's append fd stays valid
  } catch {}
}, 10 * 60 * 1000).unref()

// Next.js renders the pages. Its custom-server API takes node req/res (and node's `upgrade` event for
// hot reload), so it runs on a private loopback port only this process reaches; Bun.serve owns the
// public port, answers the host API itself and passes everything else to Next.
const nextServer = createServer((req, res) => handle(req, res))
const app = next({ dev: true, hostname: args.hostname, port, httpServer: nextServer })
const handle = app.getRequestHandler()
await app.prepare()
nextServer.requestTimeout = 0
await new Promise((resolve, reject) => nextServer.once("error", reject).listen(0, "127.0.0.1", resolve))
const nextOrigin = `http://127.0.0.1:${nextServer.address().port}`

const HOP_BY_HOP = ["connection", "keep-alive", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]
function toNext(request, url) {
  const headers = new Headers(request.headers) // Host, Origin and cookies as the browser sent them
  for (const name of HOP_BY_HOP) headers.delete(name)
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : request.body
  return fetch(`${nextOrigin}${url.pathname}${url.search}`, {
    method: request.method,
    headers,
    body,
    duplex: "half",
    redirect: "manual", // the browser follows Next's redirects itself
    decompress: false, // passed on as Next encoded it
    signal: request.signal,
  })
}

// Hot reload: each browser WebSocket is paired with one to Next (messages queued until it opens).
const HMR_HEADERS = ["host", "origin", "cookie", "user-agent"]
const hotReload = {
  open(ws) {
    const upstream = new WebSocket(ws.data.url, { headers: ws.data.headers })
    upstream.binaryType = "arraybuffer"
    ws.data.upstream = upstream
    upstream.onopen = () => ws.data.queue.splice(0).forEach((message) => upstream.send(message))
    upstream.onmessage = (event) => ws.send(event.data)
    upstream.onclose = () => ws.close()
    upstream.onerror = () => ws.close()
  },
  message(ws, message) {
    if (ws.data.upstream.readyState === WebSocket.OPEN) ws.data.upstream.send(message)
    else ws.data.queue.push(message)
  },
  close(ws) {
    ws.data.upstream?.close()
  },
}

Bun.serve({
  hostname: args.hostname,
  port,
  idleTimeout: 0, // a team call (`ask`) and team/stream last as long as the run
  maxRequestBodySize: MAX_BODY,
  development: false,
  websocket: hotReload,
  async fetch(request, server) {
    const url = new URL(request.url)
    if (url.pathname.startsWith(API_PREFIX)) {
      try {
        // request.signal aborts when the page goes away (reload, Stop), so a local model stops too.
        if (Number(request.headers.get("content-length")) > MAX_BODY) return Response.json({ error: "Too large." }, { status: 413 })
        return await desks.handleApi(request)
      } catch (error) {
        return Response.json({ error: error.message }, { status: 500 })
      }
    }
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const headers = Object.fromEntries(HMR_HEADERS.map((name) => [name, request.headers.get(name)]).filter(([, value]) => value))
      const data = { url: `${nextOrigin.replace(/^http/, "ws")}${url.pathname}${url.search}`, headers, queue: [] }
      return server.upgrade(request, { data }) ? undefined : new Response("WebSocket upgrade failed.", { status: 400 })
    }
    try {
      return await toNext(request, url)
    } catch (error) {
      if (request.signal.aborted) return new Response(null, { status: 499 })
      return new Response(`Next.js did not answer: ${error.message}`, { status: 502 })
    }
  },
})

desks.announce()
console.log(`ASKK dev · ${[...desks.hosted.keys()].join(", ")} (default ${desks.fallback}) · http://localhost:${port}/`)
for (const [name, { api }] of desks.hosted) console.log(`  ${name.padEnd(14)} ${api.root} (${api.capabilities.includes("fs.write") ? "read + write" : "read-only"})`)
desks.startTelegram()

// The first load after a restart is warm: each page is compiled now, on Next's private origin, not when the owner opens it.
// logs/warm.json keeps the results for dev.health; a failed write never stops the server.
warmPages(nextOrigin, ["/", "/live", "/compose", "/agents", "/canvas"]).then((pages) => {
  try {
    writeWarm(`${import.meta.dir}/../logs/warm.json`, pages)
  } catch (error) {
    console.error(`warm.json not written: ${error.message}`)
  }
  try {
    writeImports(`${import.meta.dir}/../logs/home-imports.json`, rankImports(walkImports(`${import.meta.dir}/..`)))
  } catch (error) {
    console.error(`home-imports.json not written: ${error.message}`)
  }
  console.log(`warmed ${pages.map(({ path, status, ms }) => `${path} ${status} ${(ms / 1000).toFixed(1)} s`).join(" · ")}`)
})
