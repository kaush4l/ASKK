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
//       name: "my-desk",                   // default: the folder name
//       description: "…",
//       port: 1112,                        // the always-on server's port (and its .next-desks/<name> build)
//       model: { key, label, provider: "openai", base_url, id, context_length },   // the desk's default model
//       models: { <key>: { label, provider, id, … } },   // more models its agents may name (agent.md `model:`)
//       terminal: { programs: ["uv", "python", …], toolchains: [], timeoutSeconds: 300, backgroundMinutes: 120 },   // term.*; null = off
//       integrations: [],                  // integrations/ it runs (default all; one Telegram listener per bot)
//       artifacts: ["./tools/x/artifact.js"],   // modules (relative to the desk folder) whose exported Artifact
//                                          // subclasses join the artifact catalogue (agent.md `artifacts:`)
//       async setup({ dir, env, log }) {},  // optional startup script: once per continuous server, in the
//                                          // background (update vendor clones, build tools, …); never blocks
//       async host({ call, env, state, dir, root, listen }) {   // optional host tools of this desk
//         return {
//           wrap: (call) => call,          // wraps the MCP call (innermost first)
//           guard: (call) => call,         // wraps it last, outermost: the desk's own checks on every call
//           servers: [{ name, tools, call(tool, args) }],   // extra tool servers
//         }
//       },
//     }
//   }
//
// A folder without desk.js still loads (agents/ + data/); its memory and state
// then live in custom/<team>/runtime/ as before.

import { detectToolchains } from "../capabilities/toolchains.js"
import { existsSync, readdirSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { TERM_BACKGROUND_MINUTES, HOST_LIMITS } from "../shared/config.js"

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

// Every desk in a folder (e.g. custom/): the subfolders with a desk.js, by name.
export function listDesks(dir = "custom") {
  const base = resolve(dir)
  if (!existsSync(base)) return []
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(base, d.name, "desk.js")))
    .map((d) => join(base, d.name))
    .sort()
}

const cache = new Map()
const setups = new Set()

// The desk's startup script (desk.js `setup`), once per process, in the background.
export function runDeskSetup(desk, env = process.env) {
  if (!desk?.setup || setups.has(desk.folder)) return
  setups.add(desk.folder)
  const log = (line) => console.error(`${desk.name} setup: ${line}`)
  Promise.resolve()
    .then(() => desk.setup({ dir: desk.folder, env, log }))
    .catch((error) => log(`failed: ${error?.message ?? error}`))
}

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
        // Toolchains (python, javascript, java, rust): only those installed here (capabilities/toolchains.js).
        const chains = config.terminal?.toolchains?.length ? detectToolchains(config.terminal.toolchains) : null
        const terminal = config.terminal
          ? {
              programs: [...new Set([...(chains?.programs ?? []), ...(config.terminal.programs ?? [])])],
              path: chains?.path ?? null,
              writable: chains?.writable ?? [],
              env: chains?.env ?? {},
              toolchains: chains ? { found: chains.found, missing: chains.missing } : null,
              timeoutSeconds: Math.min(HOST_LIMITS.desk.termTimeoutMaxSeconds, Number(config.terminal.timeoutSeconds) || HOST_LIMITS.desk.termTimeoutSeconds),
              backgroundMinutes: Math.max(1, Number(config.terminal.backgroundMinutes) || TERM_BACKGROUND_MINUTES),
            }
          : null
        return {
          name: config.name ?? basename(folder),
          description: config.description ?? "",
          port: Number(config.port) || null,
          model: config.model?.key && config.model?.id ? config.model : null,
          // More models the desk's agents may name (agent.md `model: <key>`), beside the default above.
          models: Object.fromEntries(Object.entries(config.models ?? {}).filter(([, m]) => m?.id && m?.provider)),
          integrations: Array.isArray(config.integrations) ? config.integrations : null,
          terminal,
          host: typeof config.host === "function" ? config.host : null,
          artifacts: (Array.isArray(config.artifacts) ? config.artifacts : []).map((path) => resolve(folder, path)),
          setup: typeof config.setup === "function" ? config.setup : null,
          ...deskPaths(folder),
        }
      })()
    )
  }
  return cache.get(folder)
}

// The artifact types of these desks (desk.js `artifacts`), joined to the
// catalogue before any engine starts. Call after the browser shims: the
// modules import app code.
export async function registerDeskArtifacts(desks = []) {
  const paths = [...new Set(desks.flatMap((d) => d?.artifacts ?? []))]
  if (!paths.length) return []
  const { registerArtifacts } = await import("../../backend/features/index.js")
  const types = []
  for (const path of paths) {
    const module = await import(pathToFileURL(path).href)
    types.push(...Object.values(module).filter((x) => typeof x === "function" && typeof x.type === "string"))
  }
  registerArtifacts(types)
  return types.map((t) => t.type)
}
