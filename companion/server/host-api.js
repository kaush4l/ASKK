// The ASKK host API: the capabilities a browser lacks, served same-origin
// under /__askk/. Used by the dev server (scripts/dev.js, the default way to
// run ASKK) and by the compiled companion (companion/server/server.js).
//
//   const api = await createHostApi({ root, readOnly, port, name })
//   api.handle(request)   Fetch Request -> Response (for /__askk/* only)
//
// Endpoints:
//   GET wakes                  { path, open, recent } the desk's wake book (companion/team/wakes.js)
//   GET whoami                 { name, version, root, capabilities, platform }
//   GET models                 { default, models } — your model connection from
//        .env (ASKK_MODEL_*, see .env.example), so it is never in the shipped
//        app or the repo; only this machine's page can read it.
//   (fs/* below: companion/capabilities/files.js)
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
//        (companion/hardware/apple/index.js: Shortcuts, speech, notifications, clipboard,
//        Spotlight, Reminders, open a link)
//   GET speech/status          { recognize, ready, error, voice, sampleRate } — hardware/speech
//   GET speech/voices          { voices: [{ name, lang }] } — the Mac's `say` voices
//   POST speech/transcribe { audio, locale }   { text, seconds, ms } — base64 16 kHz
//        mono 16-bit PCM, recognized on-device (Apple SpeechAnalyzer)
//   POST speech/say { text, voice?, rate? }    { audio, type } — base64 WAV from `say`
//   GET sources                { sources: [{ id, name }] } — private agent folders
//   GET sources/<id>/<path>    a file from one (.md / .json only, raw text):
//        index.json, soul.md, <agent>/agent.md, skills/… (agentDirs, --agents)
//   GET web/search?q=&limit=   { engine, query, results } — web search
//   GET web/read?url=          { url, title, text } — a public page as text
//        (companion/capabilities/web.js: SearXNG if ASKK_SEARXNG_URL, else DuckDuckGo)
//   GET mcp/tools              { servers: [{ name, ok, error?, approval, tools }] }
//   POST mcp/call { server, tool, arguments }   { text, isError } — call one
//        tool on an MCP server from .mcp.json (companion/capabilities/mcp.js), or of an
//        integration (integrations/<name>/, companion/capabilities/integrations.js)
//   GET llm/<provider>/v1/models, POST llm/<provider>/v1/chat/completions
//        OpenAI-compatible: the claude/codex/gemini CLIs and Apple's on-device
//        model (companion/capabilities/local-models.js); capability models.local
//   GET team/stream            Server-Sent Events: the server's team (snapshot,
//                              then registry / state / models changes) — capability team
//   POST team/send { text, agent?, from? }   { ok, value: { engine, agent, queued } } — work into an
//        agent's inbox without waiting (cron, scripts, any source); default agent: the lead
//   POST team/call { target, method, args, timeout? }   { ok, value | error } — an action on it (timeout ms, default 30 min, max 6 h)
//   POST term/run { command, cwd?, timeout?, agent?, stream? }   { id, command, cwd, exit, ms, output } — a desk's
//        program in the workspace (companion/capabilities/terminal.js; only when its desk.js declares `terminal`).
//        stream: true answers application/x-ndjson, one event per line: {type:"start", id, command, cwd},
//        {type:"out", text}…, then {type:"result", …the JSON answer} or {type:"error", error, status};
//        closing the request kills the program.
//   POST term/start { command, cwd?, name?, port?, agent? }   { id, name, pid, status, exit, urls, output, … }
//        a background process (a dev server): ONE program, same programs and sandbox, PORT set
//        when given; answers after ~3 s with its first output and the URLs it printed. Max 4 running.
//   GET term/ps                { procs: [{ id, name, command, cwd, agent, pid, port, startedAt, status, exit, urls }] }
//   GET term/logs?id=&tail=50  { …that summary, output } — its last `tail` lines (40 000 chars kept)
//   POST term/stop { id }      { …summary } — SIGTERM to its process group, SIGKILL after 5 s
//   GET term/log?limit=5       { policy, entries, procs } — the desk's last terminal runs + background processes
//   GET term/stream            SSE: runs in progress and procs (snapshot), then start / out / end,
//        proc (a background process started or exited) and proc-out { id, text } (Live follow)
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

import { realpath } from "node:fs/promises"
import { basename, dirname, join, resolve, sep } from "node:path"
import { createApple } from "../hardware/apple/index.js"
import { loadHardware } from "../hardware/index.js"
import { modelsFromEnv } from "../capabilities/env-models.js"
import { createFiles } from "../capabilities/files.js"
import { createWeb, webRoutes } from "../capabilities/web.js"
import { loadIntegrations } from "../capabilities/integrations.js"
import { createLocalModels, localModelRoute } from "../capabilities/local-models.js"
import { createMcp } from "../capabilities/mcp.js"
import { loadDesk, runDeskSetup } from "../team/desk.js"
import { createTerminal, terminalRoutes } from "../capabilities/terminal.js"
import { teamStorageDir } from "../team/team.js"
import { wakesRoutes } from "../team/wakes.js"
import { HttpError, httpError, json } from "../shared/http.js"

export const VERSION = "0.1.0"
import { API_PREFIX, HOST_LIMITS } from "../shared/config.js"
export { API_PREFIX }
const MAX_WRITE = HOST_LIMITS.hostApi.writeBytes // bytes accepted by fs/write

// A team folder (custom/<team>/) keeps its agents in agents/ and its shared
// files in data/; pointing at the agents folder itself works too.
const teamAgents = async (dir) =>
  (await Bun.file(join(dir, "index.json")).exists()) ? dir : join(dir, "agents")

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
  team = null, // the server's team (companion/team/team.js): one set of engines every tab mirrors
  desk = null, // { name, description } when one server hosts several desks (scripts/dev.js --desks)
}) {
  const root = await realpath(resolve(rootArg))
  let envModels = modelsFromEnv()
  const apple = await createApple()
  const { speech } = await loadHardware({ log: (line) => console.log(line) }) // hardware/: optional, per machine
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
  // A desk may limit the integrations it runs (desk.js `integrations: [...]`):
  // one Telegram bot can have only one listener, so a second desk declares none.
  const desks = (await Promise.all(sources.map((s) => loadDesk(s.path)))).filter(Boolean)
  const only = desks.find((d) => Array.isArray(d.integrations))?.integrations ?? null
  const integrations = await loadIntegrations({ dir: integrationsDir, listen, only })
  for (const name of integrations?.names ?? []) {
    if (mcpServers?.names.includes(name)) throw new Error(`"${name}" is both an MCP server and an integration.`)
  }
  // MCP servers and integrations, offered to agents the same way. A desk
  // (desk.js, companion/team/desk.js) adds its own host tools: its host() hook
  // may wrap the call (innermost first), guard it (outermost, after every wrap:
  // the desk's own checks, kept where agents cannot write) and add tool servers.
  // A desk's own model (desk.js `model`) is its team's default; the .env ones stay selectable.
  const deskModel = desks.find((d) => d.model)?.model
  if (deskModel) {
    const { key, ...model } = deskModel
    envModels = { default: key, models: { ...envModels.models, [key]: { label: `${model.id} (desk)`, ...model } } }
  }
  // desk.js `models: {key: model}`: more models its agents may name (`model: <key>` in agent.md), e.g. a fast
  // model for groundwork beside the strategist's default.
  for (const desk of desks) {
    for (const [key, model] of Object.entries(desk.models ?? {})) {
      envModels = { default: envModels?.default ?? key, models: { ...envModels?.models, [key]: { label: `${model.id} (desk)`, ...model } } }
    }
  }
  const runtime = teamStorageDir(root)
  let call =
    mcpServers || integrations
      ? (server, tool, args) =>
          integrations?.has(server) ? integrations.call(server, tool, args) : mcpServers ? mcpServers.call(server, tool, args) : Promise.reject(httpError(404, `Unknown MCP server "${server}".`))
      : (server) => Promise.reject(httpError(404, `Unknown MCP server "${server}".`))
  const deskServers = []
  const guards = []
  for (const desk of desks) {
    if (listen) runDeskSetup(desk)
    if (!desk.host) continue
    // `call` for the desk's tools is the final one (after every wrap), bound late.
    // root: the workspace; listen: a continuous server (one per team), where watchers may run.
    const hooks = (await desk.host({ call: (...args) => below(...args), env: process.env, state: runtime, dir: desk.folder, root, listen })) ?? {}
    if (typeof hooks.wrap === "function") call = hooks.wrap(call)
    for (const server of hooks.servers ?? []) deskServers.push(server)
    if (typeof hooks.guard === "function") guards.push(hooks.guard)
  }
  const below = call
  const guarded = guards.reduce((inner, guard) => guard(inner), below)
  const deskServer = new Map(deskServers.map((s) => [s.name, s]))
  const mcp =
    mcpServers || integrations || deskServers.length
      ? {
          tools: async () => [
            ...((await mcpServers?.tools()) ?? []),
            ...(integrations?.servers() ?? []),
            ...deskServers.map(({ call: _call, ...server }) => ({ ok: true, approval: "auto", ...server })),
          ],
          call: (server, tool, args) => (deskServer.has(server) ? deskServer.get(server).call(tool, args) : guarded(server, tool, args)),
        }
      : null
  // term.run: a desk that declares `terminal` lets its agents run those
  // programs in the workspace (companion/capabilities/terminal.js: sandboxed, logged).
  const terminalPolicy = desks.find((d) => d.terminal)?.terminal ?? null
  const terminal = terminalPolicy && !readOnly ? createTerminal({ root, policy: terminalPolicy, logPath: join(runtime, "terminal.jsonl") }) : null
  const capabilities = [
    ...(readOnly ? ["fs.read"] : ["fs.read", "fs.write"]),
    ...(envModels.default ? ["models"] : []),
    ...(local ? ["models.local"] : []),
    ...(apple ? ["apple"] : []),
    ...(speech ? ["speech"] : []),
    "web",
    ...(mcp ? ["mcp"] : []),
    ...(sources.length ? ["agents.private"] : []),
    ...(integrations?.listening.length ? ["integrations.events"] : []),
    ...(team ? ["team"] : []),
    ...(terminal ? ["term"] : []),
    "wakes",
  ]
  const files = createFiles({ root, readOnly })
  const localModel = local ? localModelRoute(local) : null
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`])

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
    whoami: () => ({ name, version: VERSION, desk, root, runtime: team?.storageDir ?? null, capabilities, platform: process.platform, localModels: local?.providers ?? [], sources: sources.map(({ id, name }) => ({ id, name })), publicAgents: !sources.length || withPublic }),
    sources: () => ({ sources: sources.map(({ id, name }) => ({ id, name })) }),
    models: () => envModels,
    ...files.GET,
    ...(apple ? { "apple/actions": () => ({ actions: apple.actions }) } : {}),
    ...(speech ? { "speech/status": () => speech.status(), "speech/voices": () => speech.voices() } : {}),
    ...webRoutes(web).GET,
    ...(mcp ? { "mcp/tools": async () => ({ servers: await mcp.tools() }) } : {}),
    ...(terminal ? terminalRoutes(terminal).GET : {}),
    ...wakesRoutes(root).GET,
    ...(integrations?.listening.length
      ? {
          "integrations/events": (params) =>
            integrations.events({ after: params.get("after"), from: params.get("from"), wait: Number(params.get("wait")) || 0 }),
        }
      : {}),
  }
  const POST = {
    ...files.POST,
    ...(apple ? { "apple/run": ({ action, inputs }) => apple.run(action, inputs) } : {}),
    ...(speech ? { "speech/transcribe": (body) => speech.transcribe(body), "speech/say": (body) => speech.speak(body) } : {}),
    ...(mcp ? { "mcp/call": ({ server, tool, arguments: args }) => mcp.call(server, tool, args) } : {}),
    ...(team ? { "team/call": (body) => team.call(body), "team/send": (body) => team.send(body) } : {}),
    ...(terminal ? terminalRoutes(terminal).POST : {}),
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
      if (terminal && request.method === "GET" && endpoint === "term/stream") return terminal.stream(request)
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
        // A handler may answer with its own Response (a stream: term/run with stream: true).
        const value = await handler(body, request)
        return value instanceof Response ? value : json(200, value)
      }
      return json(405, { error: "Method not allowed." })
    } catch (error) {
      return json(error.status ?? 500, { error: error.message })
    }
  }

  return { root, capabilities, desks, handle }
}
