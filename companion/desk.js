// A desk: one agent team in its own folder, everything it needs inside it.
//
//   custom/<desk>/
//     desk.js     the desk's init script (below): its variables and host tools
//     agents/     index.json, soul.md, <name>/agent.md, skills/, mcp.json
//     tools/      host-side code only this desk uses, wired by desk.js
//     vendor/     applications only this desk uses (git-ignored with custom/)
//     data/       the workspace: the team's shared files (agents read and write it)
//     memory/     every engine's memory.md, history and artifacts (outside the workspace)
//     state/      host state: settings, server.json, server.log, logs a desk's tools keep
//
// desk.js default-exports a function the host calls once at start:
//
//   export default function desk({ dir, env }) {
//     return {
//       name: "dev-desk",                 // default: the folder name
//       description: "…",
//       port: 1112,                        // the always-on server's port (and its .next-desks/<name> build)
//       model: { key, label, provider: "openai", base_url, id, context_length },   // the desk's default model
//       terminal: { programs: ["uv", "python", …], timeoutSeconds: 300, backgroundMinutes: 120 },   // term.*; null = off
//       integrations: [],                  // integrations/ it runs (default all; one Telegram listener per bot)
//       async host({ call, env, state, dir }) {   // optional host tools of this desk
//         return {
//           wrap: (call) => call,          // wraps the MCP call below the order guard
//           servers: [{ name, tools, call(tool, args) }],   // extra tool servers (book.read, …)
//           beforeOpen: async () => {},    // throws to refuse a real-money opening order
//         }
//       },
//     }
//   }
//
// A folder without desk.js still loads (agents/ + data/); its memory and state
// then live in custom/<team>/runtime/ as before.

import { existsSync, readdirSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

// The desk folder of an agents folder or a desk folder, or null.
export function deskFolder(dir) {
  if (!dir) return null
  const full = resolve(dir)
  const folder = basename(full) === "agents" ? dirname(full) : full
  return existsSync(join(folder, "desk.js")) ? folder : null
}

// The desk whose workspace is `root` (custom/<desk>/data), or null.
export function deskOfRoot(root) {
  return basename(root) === "data" ? deskFolder(dirname(root)) : null
}

export const deskPaths = (folder) => ({
  folder,
  agents: join(folder, "agents"),
  workspace: join(folder, "data"),
  memory: join(folder, "memory"),
  state: join(folder, "state"),
  tools: join(folder, "tools"),
})

// Every desk in a folder (custom/): the subfolders with a desk.js, by name.
export function listDesks(dir = "custom") {
  const base = resolve(dir)
  if (!existsSync(base)) return []
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(base, d.name, "desk.js")))
    .map((d) => join(base, d.name))
    .sort()
}

const cache = new Map()

// The desk's variables: desk.js called once per process, its answer kept.
export async function loadDesk(dir, env = process.env) {
  const folder = deskFolder(dir)
  if (!folder) return null
  if (!cache.has(folder)) {
    cache.set(
      folder,
      (async () => {
        const create = (await import(pathToFileURL(join(folder, "desk.js")).href)).default
        if (typeof create !== "function") throw new Error(`${folder}/desk.js must default-export a function.`)
        const config = (await create({ dir: folder, env })) ?? {}
        const terminal = config.terminal
          ? {
              programs: [...new Set(config.terminal.programs ?? [])],
              timeoutSeconds: Math.min(1800, Number(config.terminal.timeoutSeconds) || 300),
              backgroundMinutes: Math.max(1, Number(config.terminal.backgroundMinutes) || 120),
            }
          : null
        return {
          name: config.name ?? basename(folder),
          description: config.description ?? "",
          port: Number(config.port) || null,
          model: config.model?.key && config.model?.id ? config.model : null,
          integrations: Array.isArray(config.integrations) ? config.integrations : null,
          terminal,
          host: typeof config.host === "function" ? config.host : null,
          ...deskPaths(folder),
        }
      })()
    )
  }
  return cache.get(folder)
}
