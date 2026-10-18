// A desk: one agent team in its own folder, built on the kernel (backend/kernel), everything it needs inside it.
//
//   custom/<desk>/
//     main.js     the desk's entry (below): builds its agents on the kernel in start()
//     agents/     its agents as folders, nested by team (<team>/<agent>/agent.md + transcript)
//     tools/      host-side code only this desk uses (its tools, watchers, artifacts)
//     vendor/     applications only this desk uses (git-ignored with custom/)
//     data/       the workspace: the desk's shared files (Files page, fs/*, the wake book in data/state/)
//     state/      host state: server.json, kernel-team.jsonl, artifacts/, days/, logs its tools keep
//   custom/memory/<desk>/   the desk's and its teams' memory and reports (kernel-team passes it to start)
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
//       terminal: { toolchains: ["python"], programs: ["make"], timeoutSeconds, backgroundMinutes },
//                                          // its terminal sessions (host term/*: companion/capabilities/terminal.js)
//       mounts: { desks: { root, allow: (name) => bool } },   // desks/<name>/… in its workspace = <root>/<name>/…
//                                          // when allow(name) (fs/*, term cwd and lanes: capabilities/files.js)
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

const ENTRY = "main.js"
const entryOf = (folder) => (existsSync(join(folder, ENTRY)) ? join(folder, ENTRY) : null)

// The desk folder of a desk folder or its agents/ folder, or null.
export function deskFolder(dir) {
  if (!dir) return null
  const full = resolve(dir)
  const folder = basename(full) === "agents" ? dirname(full) : full
  return entryOf(folder) ? folder : null
}

export const deskPaths = (folder) => ({
  folder,
  agents: join(folder, "agents"),
  workspace: join(folder, "data"),
  memory: join(folder, "memory"),
  state: join(folder, "state"),
  tools: join(folder, "tools"),
})

// Every desk in a folder (e.g. custom/): the subfolders with a main.js, by name.
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
export function runDeskSetup(desk, env = process.env) {
  if (!desk?.setup || setups.has(desk.folder)) return
  setups.add(desk.folder)
  const log = (line) => console.error(`${desk.name} setup: ${line}`)
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
          // 2026-10-17: what its host API's terminal runs and which outside folders its workspace mounts.
          terminal: config.terminal && typeof config.terminal === "object" ? config.terminal : null,
          mounts: config.mounts?.desks?.root ? { desks: { root: resolve(folder, config.mounts.desks.root), allow: config.mounts.desks.allow } } : null,
          host: typeof config.host === "function" ? config.host : null,
          setup: typeof config.setup === "function" ? config.setup : null,
          start: config.start,
          // Its own tool servers (mcpServers format).
          mcp: typeof config.mcp === "string" ? resolve(folder, config.mcp) : null,
          ...deskPaths(folder),
        }
      })()
    )
  }
  return cache.get(folder)
}
