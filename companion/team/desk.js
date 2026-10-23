// A desk: one agent team in its own folder, built on the kernel (backend/kernel), everything it needs inside it.
//
//   custom/<desk>/ (or desks/<desk>/, the core desks)
//     main.js     the desk's entry (below): builds its agents on the kernel in start()
//     <lead>/     its lead (2026-10-21, the standard): <lead>.md, tools.js, practice.md, history.md; members nested
//                 as <member>/<member>.md (layout.js; the legacy layout: agents/<lead>/agent.md, members nested)
//     tools/      host-side code only this desk uses (its tools, watchers, artifacts)
//     vendor/     applications only this desk uses (git-ignored with custom/)
//     data/       the workspace: the desk's shared files (Files page, fs/*, the wake book in data/state/)
//     state/      host state: server.json, kernel-team.jsonl, artifacts/, days/, logs its tools keep
//   memory/<desk>/          at ASKK's root (companion/shared/paths.js memoryFolder): the desk's and its teams' memory —
//                           reports, practice, <team>/board.md — (kernel-team passes it to start) and its loaded
//                           projects (projects.json)
//
// main.js default-exports a function the host calls once at start:
//
//   export default function desk({ dir, env }) {
//     return {
//       name: "my-desk",                   // default: the folder name
//       title, description,
//       port: 1112,                        // its own port when it runs alone (and its .next-desks/<name> build)
//       mcp: "./mcp.json",                 // its tool servers (mcpServers format), beside .mcp.json
//       integrations: ["telegram"],        // integrations/ it runs (one Telegram listener per bot)
//       telegram: false,                   // no live status of its runs on Telegram (default: every desk posts it)
//       terminal: { toolchains: ["python"], programs: ["make"], timeoutSeconds, backgroundMinutes },
//                                          // its terminal sessions (host term/*: companion/capabilities/terminal.js)
//       mounts: { desks: { root, allow: (name) => bool } },   // desks/<name>/… in its workspace = <root>/<name>/…
//                                          // when allow(name) (fs/*, term cwd and lanes: capabilities/files.js)
//       projects: true | { name: path },   // projects outside ASKK it works on, as projects/<name>/ in its workspace:
//                                          // these at start (paths relative to the desk folder), and true or not, the
//                                          // owner's loads (host projects/load; capabilities/projects.js)
//       start: async ({ port, live, log, memory }) => ({ desk, ready?, run? }),   // builds the agents
//                                          // (backend/kernel buildDesk); the host serves them as the team
//                                          // (companion/team/kernel-team.js); run({wake, busy, log}) → stop
//                                          // is its background work on a continuous server
//       async setup({ dir, env, log }) {},  // optional: once per continuous server, in the background
//       async host({ call, env, state, dir, root, listen }) {   // optional host tools of this desk
//         return {
//           wrap: (call) => call,          // wraps the MCP call (innermost first)
//           guard: (call) => call,         // wraps it last, outermost: the desk's own checks on every call
//           servers: [{ name, tools, call(tool, args) }],   // extra tool servers
//         }
//       },
//     }
//   }

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { memoryFolder } from "../shared/paths.js"
import { agentTreeRoot } from "./layout.js"

const ENTRY = "main.js"
const entryOf = (folder) => (existsSync(join(folder, ENTRY)) ? join(folder, ENTRY) : null)

// The desk folder of a desk folder or its (legacy) agents/ folder, or null.
export function deskFolder(dir) {
  if (!dir) return null
  const full = resolve(dir)
  const folder = basename(full) === "agents" ? dirname(full) : full
  return entryOf(folder) ? folder : null
}

export const deskPaths = (folder) => ({
  folder,
  agents: agentTreeRoot(folder), // the lead's folder (agents/ in the legacy layout)
  workspace: join(folder, "data"),
  memory: memoryFolder(basename(folder)),
  state: join(folder, "state"),
  tools: join(folder, "tools"),
})

// The core desks ASKK ships (2026-10-20: desks/agent, the single capable agent), hosted beside the local ones.
export const CORE_DESKS = resolve(import.meta.dir, "..", "..", "desks")

// The desks a server hosts: the core desks (desks/) and the local ones (--desks, default custom/: never pushed); a local
// desk named like a core one wins; no local folder (or an empty one): the core desks alone (2026-10-21 owner: "the
// default mode where we read the default single agent folder"). only: just these names.
export function hostedDeskFolders({ desks = "custom", core = CORE_DESKS, only = null } = {}) {
  const local = listDesks(desks)
  const names = new Set(local.map((f) => basename(f)))
  const shipped = core ? listDesks(core).filter((f) => !names.has(basename(f))) : []
  return [...shipped, ...local].filter((f) => !only || only.has(basename(f)))
}

// Every desk in a folder (e.g. custom/): the subfolders with a main.js, by name; none when the folder is missing.
export function listDesks(dir = "custom") {
  const base = resolve(dir)
  if (!existsSync(base)) return []
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && entryOf(join(base, d.name)))
    .map((d) => join(base, d.name))
    .sort()
}

// The running server of a desk, if any: { port, pid, root, desk? } from its state/server.json (kernel-team
// announce). Scripts hand it work (scripts/send.js) instead of starting another.
export function findDeskServer(desk) {
  try {
    const found = JSON.parse(readFileSync(join(desk.state, "server.json"), "utf8"))
    process.kill(found.pid, 0) // throws when that process is gone
    return found
  } catch {
    return null
  }
}

const cache = new Map()
const setups = new Set()

// The desk's startup script (`setup`), once per process, in the background.
// log: the desk log (host-api.js), else the console.
export function runDeskSetup(desk, env = process.env, deskLog = null) {
  if (!desk?.setup || setups.has(desk.folder)) return
  setups.add(desk.folder)
  const log = deskLog ?? ((line) => console.error(`${desk.name} setup: ${line}`))
  Promise.resolve()
    .then(() => desk.setup({ dir: desk.folder, env, log }))
    .catch((error) => log(`failed: ${error?.message ?? error}`))
}

// A desk's config is loaded again at its next loadDesk (desks/load reloads a desk: companion/server/desks.js).
export function forgetDesk(dir) {
  cache.delete(deskFolder(dir) ?? resolve(dir))
}

// The desk's config: main.js called once per process, its answer kept. null when `dir` is not a desk.
export async function loadDesk(dir, env = process.env) {
  const folder = deskFolder(dir)
  if (!folder) return null
  if (!cache.has(folder)) {
    cache.set(
      folder,
      (async () => {
        const entry = entryOf(folder)
        const create = (await import(Bun.pathToFileURL(entry).href)).default
        if (typeof create !== "function") throw new Error(`${entry} must default-export a function.`)
        const config = (await create({ dir: folder, env })) ?? {}
        if (typeof config.start !== "function") throw new Error(`${entry}: a desk builds its agents in start({port, live, log, memory}).`)
        return {
          name: config.name ?? basename(folder),
          title: config.title ?? null,
          description: config.description ?? "",
          port: Number(config.port) || null,
          integrations: Array.isArray(config.integrations) ? config.integrations : null,
          // 2026-10-23: false keeps its runs' live status off Telegram (every desk posts it, in its own topic)
          telegram: config.telegram !== false,
          // 2026-10-17: what its host API's terminal runs and which outside folders its workspace mounts.
          terminal: config.terminal && typeof config.terminal === "object" ? config.terminal : null,
          mounts: config.mounts?.desks?.root ? { desks: { root: resolve(folder, config.mounts.desks.root), allow: config.mounts.desks.allow } } : null,
          // Projects outside ASKK (true: the owner loads them; {name: path}: these too, at start).
          projects: config.projects === true || (config.projects && typeof config.projects === "object") ? config.projects : null,
          host: typeof config.host === "function" ? config.host : null,
          setup: typeof config.setup === "function" ? config.setup : null,
          start: config.start,
          // Its own tool servers (mcpServers format).
          mcp: typeof config.mcp === "string" ? resolve(folder, config.mcp) : null,
          ...deskPaths(folder),
          memory: memoryFolder(config.name ?? basename(folder), env),
        }
      })()
    )
  }
  return cache.get(folder)
}
