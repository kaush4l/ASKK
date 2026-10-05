// The ASKK host API: the capabilities a browser lacks, served same-origin
// under /__askk/. Used by the dev server (scripts/dev.js, the default way to
// run ASKK) and by the compiled companion (companion/server.js).
//
//   const api = await createHostApi({ root, readOnly, port, name })
//   api.handle(request)   Fetch Request -> Response (for /__askk/* only)
//
// Endpoints:
//   GET whoami                 { name, version, root, capabilities, platform }
//   GET models                 { default, models } — your model connection from
//        .env (ASKK_MODEL_*, see .env.example), so it is never in the shipped
//        app or the repo; only this machine's page can read it.
//   GET fs/list?path=<rel>     { path, entries: [{ name, type, size, mtime }] }
//   GET fs/read?path=<rel>     { path, size, binary, truncated, text, revision }
//   GET fs/tree?path=<rel>     { path, entries: [{ name, type, children?, skipped?, omitted? }] }
//        Names only, every level. Heavy folders (TREE_SKIP) are listed but
//        not expanded (skipped: true); past MAX_TREE entries the rest of a
//        folder is counted (omitted: n) instead of listed.
//   POST fs/write { path, text, revision? }   { path, size, revision, created }
//        revision: the one read (409 if the file changed since); null = must
//        be a new file; omitted = write regardless. Parents are created; the
//        file is replaced atomically (temp file + rename).
//   POST fs/delete { path, recursive?, revision? }   { path, type }
//        A file, link, or empty folder; a folder with contents needs
//        recursive: true. A link is removed, never what it points to.
//        revision (files): 409 if the file changed since it was read.
//   GET apple/actions          { actions: [{ id, available }] } — macOS only
//   POST apple/run { action, inputs }   { text } — run one Apple action
//        (companion/apple.js: Shortcuts, speech, notifications, clipboard,
//        Spotlight, Reminders, open a link)
//   GET sources                { sources: [{ id, name }] } — private agent folders
//   GET sources/<id>/<path>    a file from one (.md / .json only, raw text):
//        index.json, soul.md, <agent>/agent.md, skills/… (agentDirs, --agents)
//   GET web/search?q=&limit=   { engine, query, results } — web search
//   GET web/read?url=          { url, title, text } — a public page as text
//        (companion/web.js: SearXNG if ASKK_SEARXNG_URL, else DuckDuckGo)
//   GET mcp/tools              { servers: [{ name, ok, error?, approval, tools }] }
//   POST mcp/call { server, tool, arguments }   { text, isError } — call one
//        tool on an MCP server from .mcp.json (companion/mcp.js), or of an
//        integration (integrations/<name>/, companion/integrations.js)
//   GET llm/<provider>/v1/models, POST llm/<provider>/v1/chat/completions
//        OpenAI-compatible: the claude/codex/gemini CLIs and Apple's on-device
//        model (companion/local-models.js); capability models.local
//   GET team/stream            Server-Sent Events: the server's team (snapshot,
//                              then registry / state / models changes) — capability team
//   POST team/call { target, method, args }   { ok, value | error } — an action on it
//   GET integrations/events?after=<seq>&from=<boot>&wait=<ms>
//        { boot, next, events } — messages integrations received (long poll;
//        only while listening: bun run dev / askk)
//
// Capabilities: fs.read and fs.write (write + delete) on `root`; readOnly
// drops fs.write; apple on macOS; mcp when .mcp.json lists servers. The app
// asks the owner before an agent changes anything or reaches outside ASKK.
//
// Security: the Host header must name this machine's loopback address and
// port (blocks DNS rebinding and other machines on the network); a
// cross-origin Origin is refused and no CORS headers are sent; POST needs a
// same-origin Origin and a JSON body; every path is resolved through realpath
// and must stay inside the root (symlinks out of it are refused). Agents
// cannot write or delete ASKK's own configuration (.env*, .mcp.json), which
// would let them give themselves a model, a key or a program to run.

import { createHash } from "node:crypto"
import { lstat, mkdir, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { createApple } from "./apple.js"
import { createWeb } from "./web.js"
import { loadIntegrations } from "./integrations.js"
import { createLocalModels } from "./local-models.js"
import { createMcp } from "./mcp.js"

export const VERSION = "0.1.0"
export const API_PREFIX = "/__askk/"
const MAX_READ = 1024 * 1024 // bytes returned by fs/read
const MAX_WRITE = 8 * 1024 * 1024 // bytes accepted by fs/write
const MAX_TREE = 3000 // entries returned by fs/tree
// Folders listed but never expanded in a tree (same list as backend/features/filesystem/workspace.js).
// ASKK's own configuration: never written or deleted through the API.
const PROTECTED = (name) => name === ".mcp.json" || (/^\.env(\..+)?$/.test(name) && name !== ".env.example")
const TREE_SKIP = new Set([".git", "node_modules", ".next", "out", "dist", "build", ".turbo", ".cache", "coverage", "__pycache__", ".venv", "venv", ".DS_Store"])

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } })

// Short SHA-256 of a file's bytes (same as the app's revisionOf).
const revisionOf = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 16)

const readBytes = async (path) => new Uint8Array(await Bun.file(path).arrayBuffer())

// The model connections configured in the environment (.env, which Bun loads
// from the folder ASKK starts in): { default, models } in the models.json
// format, or an empty catalogue when ASKK_MODEL_ID is unset. ASKK_MODEL_* is
// the default; ASKK_BACKUP_* (optional) is its fallback, used when the default
// fails before answering. A model this machine runs (provider claude-cli,
// codex-cli, gemini-cli, apple) needs no URL.
const RUN_HERE = ["claude-cli", "codex-cli", "gemini-cli", "apple"]
function envModel(env, prefix, fallbackKey) {
  const value = (name) => env[`${prefix}_${name}`]?.trim() || undefined
  const number = (name) => (Number(value(name)) > 0 ? Number(value(name)) : undefined)
  const id = value("ID")
  const provider = value("PROVIDER") || "openai"
  if (!id || (!value("BASE_URL") && !RUN_HERE.includes(provider))) return null
  return [
    value("KEY") || fallbackKey,
    {
      label: value("LABEL") || `${id} (from .env)`,
      provider,
      base_url: value("BASE_URL"),
      id,
      api_key: value("API_KEY"),
      max_tokens: number("MAX_TOKENS"),
      context_length: number("CONTEXT_LENGTH"),
    },
  ]
}

export function modelsFromEnv(env = process.env) {
  const main = envModel(env, "ASKK_MODEL", "local")
  if (!main) return { default: null, models: {} }
  const backup = envModel(env, "ASKK_BACKUP", "backup")
  if (backup && backup[0] !== main[0]) main[1].fallback = backup[0]
  return { default: main[0], models: Object.fromEntries(backup ? [backup, main] : [main]) }
}

// Private agent folders: every --agents flag, else ASKK_AGENTS (.env), a
// list separated by ":" or ",".
export function agentDirsFrom(flags = []) {
  if (flags.length) return flags
  return (process.env.ASKK_AGENTS ?? "").split(/[:,]/).map((d) => d.trim()).filter(Boolean)
}

// A team folder (custom/<team>/) keeps its agents in agents/ and its shared
// files in data/; pointing at the agents folder itself works too.
const teamAgents = async (dir) =>
  (await Bun.file(join(dir, "index.json")).exists()) ? dir : join(dir, "agents")

// The workspace: --root, else the first team's data/ folder, else the folder
// ASKK starts in.
export async function rootFrom(rootFlag, agentDirs = []) {
  if (rootFlag) return rootFlag
  if (agentDirs.length) {
    const team = resolve(agentDirs[0])
    const data = join(basename(team) === "agents" ? dirname(team) : team, "data")
    if (await stat(data).then((s) => s.isDirectory(), () => false)) return data
  }
  return process.cwd()
}

export async function createHostApi({
  root: rootArg,
  readOnly = false,
  port,
  name = "askk-companion",
  mcpFile = resolve(process.cwd(), ".mcp.json"),
  agentDirs = [],
  withPublic = false, // with agentDirs: also load the shipped public/agents/
  integrationsDir = resolve(process.cwd(), "integrations"),
  listen = false, // run integration listeners (a continuous server, not askk ask)
  team = null, // the server's team (companion/team.js): one set of engines every tab mirrors
}) {
  const root = await realpath(resolve(rootArg))
  const envModels = modelsFromEnv()
  const apple = await createApple()
  const web = createWeb()
  const local = await createLocalModels() // claude/codex/gemini CLIs, Apple on-device
  // Private agent folders (index.json + soul.md + <name>/agent.md, optional
  // skills/ and mcp.json): served read-only to the app, never written.
  const sources = await Promise.all(
    agentDirs.map(async (dir, id) => {
      const path = await realpath(await teamAgents(resolve(dir))).catch(() => {
        throw new Error(`Agents folder not found: ${dir} (expected index.json or agents/index.json)`)
      })
      if (!(await Bun.file(join(path, "index.json")).exists())) throw new Error(`${dir} has no index.json (the agent manifest).`)
      // "custom/<team>/agents" is that team: named after its folder.
      return { id, name: basename(path) === "agents" ? basename(dirname(path)) : basename(path), path }
    })
  )
  const mcpServers = await createMcp({ files: [mcpFile, ...sources.map((s) => join(s.path, "mcp.json"))] })
  const integrations = await loadIntegrations({ dir: integrationsDir, listen })
  for (const name of integrations?.names ?? []) {
    if (mcpServers?.names.includes(name)) throw new Error(`"${name}" is both an MCP server and an integration.`)
  }
  // MCP servers and integrations, offered to agents the same way.
  const mcp =
    mcpServers || integrations
      ? {
          tools: async () => [...((await mcpServers?.tools()) ?? []), ...(integrations?.servers() ?? [])],
          call: (server, tool, args) =>
            integrations?.has(server) ? integrations.call(server, tool, args) : mcpServers ? mcpServers.call(server, tool, args) : Promise.reject(Object.assign(new Error(`Unknown MCP server "${server}".`), { status: 404 })),
        }
      : null
  const capabilities = [
    ...(readOnly ? ["fs.read"] : ["fs.read", "fs.write"]),
    ...(envModels.default ? ["models"] : []),
    ...(local ? ["models.local"] : []),
    ...(apple ? ["apple"] : []),
    "web",
    ...(mcp ? ["mcp"] : []),
    ...(sources.length ? ["agents.private"] : []),
    ...(integrations?.listening.length ? ["integrations.events"] : []),
    ...(team ? ["team"] : []),
  ]
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`])

  // ── paths ─────────────────────────────────────────────────────────────

  const relPath = (abs) => relative(root, abs).split(sep).join("/")
  const inside = (abs) => abs === root || abs.startsWith(root + sep)

  // Resolve an existing root-relative path, refusing anything outside the root.
  async function inRoot(rel = "") {
    const target = resolve(root, `.${sep}${rel}`)
    let real
    try {
      real = await realpath(target)
    } catch {
      throw new HttpError(404, `Not found: ${rel || "."}`)
    }
    if (!inside(real)) throw new HttpError(403, "Path is outside the workspace.")
    return real
  }

  const pathParts = (rel) => {
    const parts = String(rel ?? "").split(/[\\/]/).filter((p) => p && p !== ".")
    if (parts.includes("..")) throw new HttpError(403, "Path is outside the workspace.")
    return parts
  }

  // Where a (possibly new) file may go: its nearest existing ancestor must
  // resolve inside the root, and an existing file must too.
  async function writeTarget(rel) {
    const parts = pathParts(rel)
    if (!parts.length) throw new HttpError(400, "A file path is required.")
    const target = join(root, ...parts)
    let ancestor = dirname(target)
    while (true) {
      try {
        if (!inside(await realpath(ancestor))) throw new HttpError(403, "Path is outside the workspace.")
        break
      } catch (error) {
        if (error instanceof HttpError) throw error
        ancestor = dirname(ancestor) // not there yet; check its parent
      }
    }
    try {
      const real = await realpath(target)
      if (!inside(real)) throw new HttpError(403, "Path is outside the workspace.")
      if (!(await stat(real)).isFile()) throw new HttpError(400, "Not a file.")
      return real
    } catch (error) {
      if (error instanceof HttpError) throw error
      return target
    }
  }

  // Changes to one path run one after another.
  const queues = new Map()
  async function serialize(path, task) {
    const run = (queues.get(path) ?? Promise.resolve()).catch(() => {}).then(task)
    queues.set(path, run)
    try {
      return await run
    } finally {
      if (queues.get(path) === run) queues.delete(path)
    }
  }

  // ── fs ────────────────────────────────────────────────────────────────

  async function list(rel) {
    const dir = await inRoot(rel)
    if (!(await stat(dir)).isDirectory()) throw new HttpError(400, "Not a folder.")
    const names = await readdir(dir)
    const entries = await Promise.all(
      names.map(async (entry) => {
        try {
          const info = await lstat(join(dir, entry))
          const type = info.isSymbolicLink() ? "link" : info.isDirectory() ? "dir" : info.isFile() ? "file" : "other"
          return { name: entry, type, size: info.size, mtime: info.mtimeMs }
        } catch {
          return null // vanished or unreadable
        }
      })
    )
    const order = { dir: 0, link: 1, file: 2, other: 3 }
    return {
      path: relPath(dir),
      entries: entries.filter(Boolean).sort((a, b) => order[a.type] - order[b.type] || a.name.localeCompare(b.name)),
    }
  }

  async function tree(rel) {
    const top = await inRoot(rel)
    if (!(await stat(top)).isDirectory()) throw new HttpError(400, "Not a folder.")
    let budget = MAX_TREE
    const order = { dir: 0, link: 1, file: 2, other: 3 }
    async function walk(dir) {
      const names = (await readdir(dir).catch(() => [])).sort()
      const entries = []
      for (const [i, entry] of names.entries()) {
        if (budget <= 0) {
          entries.push({ name: null, type: "omitted", omitted: names.length - i })
          break
        }
        budget--
        let info
        try {
          info = await lstat(join(dir, entry))
        } catch {
          continue
        }
        const type = info.isSymbolicLink() ? "link" : info.isDirectory() ? "dir" : info.isFile() ? "file" : "other"
        if (type !== "dir") entries.push({ name: entry, type })
        else if (TREE_SKIP.has(entry)) entries.push({ name: entry, type, skipped: true })
        else entries.push({ name: entry, type, children: await walk(join(dir, entry)) })
      }
      return entries.sort((a, b) => (order[a.type] ?? 4) - (order[b.type] ?? 4) || (a.name ?? "").localeCompare(b.name ?? ""))
    }
    return { path: relPath(top), entries: await walk(top) }
  }

  async function read(rel) {
    const path = await inRoot(rel)
    const info = await stat(path)
    if (!info.isFile()) throw new HttpError(400, "Not a file.")
    const all = await readBytes(path)
    const bytes = all.subarray(0, MAX_READ)
    const binary = bytes.subarray(0, 8000).includes(0)
    return {
      path: relPath(path),
      size: info.size,
      binary,
      truncated: info.size > MAX_READ,
      text: binary ? null : new TextDecoder().decode(bytes),
      revision: revisionOf(all),
    }
  }

  async function write({ path: rel, text, revision }) {
    if (typeof text !== "string") throw new HttpError(400, "text must be a string.")
    const path = await writeTarget(rel)
    if (PROTECTED(basename(path))) throw new HttpError(403, `${basename(path)} is ASKK's configuration; only the owner edits it.`)
    return serialize(path, async () => {
      const existing = await Bun.file(path).exists()
      const current = existing ? revisionOf(await readBytes(path)) : null
      if (revision !== undefined && revision !== current) {
        throw new HttpError(409, current ? `${relPath(path)} changed since it was read.` : `${relPath(path)} no longer exists.`)
      }
      await mkdir(dirname(path), { recursive: true })
      const temp = join(dirname(path), `.${basename(path)}.askk-${process.pid}-${Date.now()}`)
      const bytes = new TextEncoder().encode(text)
      try {
        await writeFile(temp, bytes)
        await rename(temp, path)
      } catch (error) {
        await rm(temp, { force: true })
        throw error
      }
      return { path: relPath(path), size: bytes.length, revision: revisionOf(bytes), created: !existing }
    })
  }

  // The parent must resolve inside the root; the entry itself is not
  // followed, so a link is unlinked, not its target.
  async function remove({ path: rel, recursive = false, revision }) {
    const parts = pathParts(rel)
    if (!parts.length) throw new HttpError(400, "The workspace root cannot be deleted.")
    const parent = await inRoot(parts.slice(0, -1).join("/"))
    const target = join(parent, parts.at(-1))
    if (PROTECTED(parts.at(-1))) throw new HttpError(403, `${parts.at(-1)} is ASKK's configuration; only the owner edits it.`)
    let info
    try {
      info = await lstat(target)
    } catch {
      throw new HttpError(404, `Not found: ${parts.join("/")}`)
    }
    const type = info.isSymbolicLink() ? "link" : info.isDirectory() ? "dir" : info.isFile() ? "file" : "other"
    if (type === "dir" && !recursive && (await readdir(target)).length) {
      throw new HttpError(400, `${relPath(target)} is not empty; pass recursive: true to delete it with its contents.`)
    }
    return serialize(target, async () => {
      if (type === "file" && revision !== undefined && revision !== revisionOf(await readBytes(target))) {
        throw new HttpError(409, `${relPath(target)} changed since it was read.`)
      }
      await rm(target, { recursive: type === "dir" })
      return { path: relPath(target), type }
    })
  }

  // A file of a private agent folder, as raw text.
  async function sourceFile(endpoint) {
    const [, idText, ...rest] = endpoint.split("/")
    const source = sources[Number(idText)]
    const rel = rest.join("/")
    if (!source || !/^\d+$/.test(idText)) throw new HttpError(404, "Unknown agent folder.")
    if (!/\.(md|json)$/.test(rel) || rel.split("/").some((p) => !p || p === "." || p === "..")) {
      throw new HttpError(404, "Not found.")
    }
    let real
    try {
      real = await realpath(join(source.path, ...rel.split("/")))
    } catch {
      throw new HttpError(404, `Not found: ${rel}`)
    }
    if (!real.startsWith(source.path + sep)) throw new HttpError(403, "Path is outside the agents folder.")
    return new Response(Bun.file(real), {
      headers: { "content-type": rel.endsWith(".json") ? "application/json" : "text/markdown; charset=utf-8", "cache-control": "no-store" },
    })
  }

  const GET = {
    whoami: () => ({ name, version: VERSION, root, runtime: team?.storageDir ?? null, capabilities, platform: process.platform, localModels: local?.providers ?? [], sources: sources.map(({ id, name }) => ({ id, name })), publicAgents: !sources.length || withPublic }),
    sources: () => ({ sources: sources.map(({ id, name }) => ({ id, name })) }),
    models: () => envModels,
    "fs/list": (params) => list(params.get("path") ?? ""),
    "fs/read": (params) => read(params.get("path") ?? ""),
    "fs/tree": (params) => tree(params.get("path") ?? ""),
    ...(apple ? { "apple/actions": () => ({ actions: apple.actions }) } : {}),
    "web/search": (params) => web.search(params.get("q"), params.get("limit")),
    "web/read": (params) => web.read(params.get("url")),
    ...(mcp ? { "mcp/tools": async () => ({ servers: await mcp.tools() }) } : {}),
    ...(integrations?.listening.length
      ? {
          "integrations/events": (params) =>
            integrations.events({ after: params.get("after"), from: params.get("from"), wait: Number(params.get("wait")) || 0 }),
        }
      : {}),
  }
  const POST = {
    ...(readOnly ? {} : { "fs/write": write, "fs/delete": remove }),
    ...(apple ? { "apple/run": ({ action, inputs }) => apple.run(action, inputs) } : {}),
    ...(mcp ? { "mcp/call": ({ server, tool, arguments: args }) => mcp.call(server, tool, args) } : {}),
    ...(team ? { "team/call": (body) => team.call(body) } : {}),
  }

  // ── local models (OpenAI-compatible) ──────────────────────────────────

  async function localModel(request, provider, path, sameOrigin) {
    if (path === "models") {
      if (request.method !== "GET") return json(405, { error: "Method not allowed." })
      return json(200, { object: "list", data: local.models(provider).map((m) => ({ object: "model", ...m })) })
    }
    if (request.method !== "POST") return json(405, { error: "Method not allowed." })
    if (!sameOrigin) return json(403, { error: "Model calls need a same-origin request." })
    const body = await request.json().catch(() => null)
    if (!body) return json(400, { error: "Invalid JSON body." })
    const prompt = (body.messages ?? [])
      .map((m) => (typeof m.content === "string" ? m.content : (m.content ?? []).map((part) => part.text ?? "").join("")))
      .join("\n\n")
    const parts = local.complete(provider, { model: body.model, prompt, signal: request.signal })
    const id = `askk-${Date.now()}`
    const chunk = (delta, finish = null) => ({ id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })
    if (!body.stream) {
      let text = ""
      for await (const part of parts) text += part
      return json(200, { id, object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] })
    }
    const encoder = new TextEncoder()
    const send = (controller, data) => controller.enqueue(encoder.encode(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`))
    const stream = new ReadableStream({
      async start(controller) {
        // A CLI writes nothing until it is done: keep the connection alive.
        const ping = setInterval(() => controller.enqueue(encoder.encode(": working\n\n")), 5000)
        try {
          for await (const part of parts) send(controller, chunk({ content: part }))
          send(controller, chunk({}, "stop"))
        } catch (error) {
          send(controller, { error: { message: error.message } })
        } finally {
          clearInterval(ping)
        }
        send(controller, "[DONE]")
        controller.close()
      },
    })
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } })
  }

  // ── requests ──────────────────────────────────────────────────────────

  async function handle(request) {
    const url = new URL(request.url)
    // DNS-rebinding guard: only requests addressed to this machine's loopback.
    if (!allowedHosts.has(request.headers.get("host"))) return json(421, { error: "Host capabilities answer on localhost only." })

    // Same origin only: browsers send Origin on cross-origin requests (and
    // on every POST, which must carry it).
    const origin = request.headers.get("origin")
    const sameOrigin = !!origin && allowedHosts.has(origin.replace(/^http:\/\//, ""))
    if (origin && !sameOrigin) return json(403, { error: "Cross-origin request refused." })

    const endpoint = url.pathname.slice(API_PREFIX.length)
    try {
      if (request.method === "GET" && endpoint.startsWith("sources/")) return await sourceFile(endpoint)
      if (team && request.method === "GET" && endpoint === "team/stream") return team.stream(request)
      const llm = local && endpoint.match(/^llm\/([a-z-]+)\/v1\/(models|chat\/completions)$/)
      if (llm) return await localModel(request, llm[1], llm[2], sameOrigin)
      if (request.method === "GET") {
        const handler = GET[endpoint]
        if (!handler) return json(404, { error: "Unknown endpoint." })
        return json(200, await handler(url.searchParams))
      }
      if (request.method === "POST") {
        const handler = POST[endpoint]
        if (!handler) return json(404, { error: GET[endpoint] ? "Method not allowed." : "Unknown or disabled endpoint." })
        if (!sameOrigin) return json(403, { error: "Writes need a same-origin request." })
        if (!request.headers.get("content-type")?.startsWith("application/json")) return json(415, { error: "Send JSON." })
        if (Number(request.headers.get("content-length") ?? 0) > MAX_WRITE * 2) return json(413, { error: "Too large." })
        const body = await request.json().catch(() => null)
        if (!body) return json(400, { error: "Invalid JSON body." })
        if (typeof body.text === "string" && body.text.length > MAX_WRITE) return json(413, { error: "File too large (8 MB max)." })
        return json(200, await handler(body))
      }
      return json(405, { error: "Method not allowed." })
    } catch (error) {
      return json(error.status ?? 500, { error: error.message })
    }
  }

  return { root, capabilities, handle }
}
