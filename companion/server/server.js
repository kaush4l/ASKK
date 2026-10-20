// ASKK companion — the desks and the built live UI, compiled into one program (scripts/build-companion.js). Run it
// from the repository and open the printed URL: the page and the host API share one origin, so there is no CORS,
// no mixed content, and Safari works as-is. For development use `bun run dev` (scripts/dev.js): the same desks on
// the Next dev server, with hot reload.
//
//   askk [--desks custom] [--desk <name>] [--only a,b] [--port 7717] [--read-only]
//   askk --agents custom/<desk>      that desk alone (default ASKK_AGENTS), on its own port
//
// The UI stays a static export (out/); this serves it and hosts the desks (companion/server/desks.js). Listens on
// 127.0.0.1 only.

import { extname, resolve, sep } from "node:path"
import { parseArgs } from "node:util"

import { API_PREFIX, VERSION } from "./host-api.js"
import { hostDesks } from "./desks.js"
import { DESK_OPTIONS, deskDirFrom } from "../shared/args.js"
import { hostedDeskFolders, loadDesk } from "../team/desk.js"

// The app: embedded when compiled (assets.gen.js maps URL path -> file), else read from out/ next to this file
// (run `bun --bun next build` first).
const embedded = (await import("./assets.gen.js").catch(() => null))?.default ?? null

const { values: args } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    ...DESK_OPTIONS,
    port: { type: "string" },
    "read-only": { type: "boolean", default: false },
    desks: { type: "string" },
    desk: { type: "string" },
    only: { type: "string" },
  },
})

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
  port = Number(args.port ?? desk.port ?? 7717)
} else {
  const only = args.only ? new Set(args.only.split(",").map((s) => s.trim()).filter(Boolean)) : null
  folders = hostedDeskFolders({ desks: args.desks ?? "custom", only }) // the core desks (desks/) and the local ones
  port = Number(args.port ?? 7717)
}
if (!folders.length) {
  console.error(`No desks in ${args.desks ?? "custom"} (folders with a main.js).`)
  process.exit(1)
}
const desks = await hostDesks({ folders, port, defaultDesk: args.desk ?? process.env.ASKK_DESK, readOnly: args["read-only"] }).catch((error) => {
  console.error(error.message)
  process.exit(1)
})

const outDir = resolve(import.meta.dir, "../../out")

async function asset(pathname) {
  const candidates = pathname.endsWith("/") ? [`${pathname}index.html`] : [pathname, `${pathname}.html`, `${pathname}/index.html`]
  for (const candidate of candidates) {
    if (embedded) {
      if (embedded[candidate]) return Bun.file(embedded[candidate])
      continue
    }
    const file = resolve(outDir, `.${candidate}`)
    if (!file.startsWith(outDir + sep)) continue
    const blob = Bun.file(file)
    if ((await blob.exists()) && (await blob.stat()).isFile()) return blob
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

Bun.serve({
  hostname: "127.0.0.1",
  port,
  idleTimeout: 0, // a team call and team/stream last as long as the run
  async fetch(request) {
    // DNS-rebinding guard: only requests addressed to this server.
    if (!allowedHosts.has(request.headers.get("host"))) return new Response("Bad host", { status: 421 })
    const url = new URL(request.url)
    if (url.pathname.startsWith(API_PREFIX)) return desks.handleApi(request)
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 })
    return serveApp(decodeURIComponent(url.pathname))
  },
})

desks.announce()
console.log(`ASKK companion ${VERSION} · ${[...desks.hosted.keys()].join(", ")} · http://localhost:${port}/`)
desks.startTelegram()
