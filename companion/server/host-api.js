// The ASKK host API: what a desk and its live UI get from the machine, served same-origin under /__askk/. Used
// by the dev server (scripts/dev.js, the default way to run ASKK) and by the compiled companion
// (companion/server/server.js), one per hosted desk (companion/server/desks.js).
//
//   const api = await createHostApi({ root, desk, team, port, readOnly, listen })
//   api.handle(request)   Fetch Request -> Response (for /__askk/* only)
//
// Endpoints:
//   GET whoami                 { name, version, desk, root, runtime, capabilities, platform, localModels }
//   GET wakes                  { path, open, recent } the desk's wake book (companion/shared/wakes.js)
//   (fs/* below: companion/capabilities/files.js; with the desk's `mounts`, desks/<name>/… is a mounted desk's folder)
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
//   GET fs/watch?path=<rel>    Server-Sent Events: ready { path }, then change { paths: [workspace paths], more? } —
//        recursive, gathered 300 ms; .git, node_modules, .venv, __pycache__, .cache left out
//   (term/* below: companion/capabilities/terminal.js — sessions in a PTY under sandbox-exec, kept running; the
//   desk's main.js `terminal: { toolchains, programs, timeoutSeconds, backgroundMinutes }` sets what runs)
//   POST term/start { command, cwd?, name?, agent?, writes?, wait?, slot?, replace? }   { session } — one program or
//        an `&&` chain (no shell), cwd in the workspace; writes: the caller's lane (globs); wait: seconds to wait for
//        its exit; slot ("main", "long"): run it in the agent's session of that slot (same id, appended), 409 while
//        that one runs unless replace (stopped first)
//   POST term/write { id, text, raw? }   { session } — stdin of the running program ("\n" appended unless raw)
//   POST term/wait { id, seconds, until? }   { session, matched, timedOut, line? } — until it exits, a new
//        output line holds `until` (literal text, or [texts] where any one is enough: ≤ 300 chars each, ≤ 8; 400
//        otherwise), or seconds (≤ 600) pass
//   POST term/stop { id }      { session } — SIGTERM to its process group, SIGKILL after the grace
//   GET term/list?tail=50      { sessions, policy } — session: { id, name, command, cwd, agent, slot, runs, status
//        (running|exited|stopped|failed), exit, startedAt, endedAt, urls, tail (its current command's lines) };
//        policy.cache: the desk's own package caches (~/.askk/caches/<desk>; the user's are never written)
//   GET term/read?id=&lines=   { session, lines } — the session's last lines, its scrollback (\r rewrites a line, no
//        escapes; a slot session's commands each headed by `$ <command>`)
//   GET term/stream?id=        Server-Sent Events: snapshot { session, lines, raw }, then out { id, data } (raw
//        chunks), session { session } (its urls changed; the summary without tail), exit { id, exit, status }, run
//        { session } (a slot session's next command); no id: every session (snapshot { sessions }, start, out,
//        session, exit, run)
//        Programs a crashed server left running (booked in <desk state>/terminal.running.json) are SIGKILLed when
//        the desk's terminal starts again.
//   (browser/* below: companion/capabilities/browser.js — headless pages, Bun.WebView, on this computer's apps only:
//   http(s)://localhost|127.0.0.1|[::1]:<port>, never the desk server's ports; a page that leaves is closed)
//   POST browser/open { url, width?, height?, by? }   { page } — page: { id, url, title, status, by, at, shot:
//        { n, at, width, height, url } | null, console: [last 20], errors }
//   POST browser/navigate { id, url }   POST browser/click { id, selector | x, y }   POST browser/type { id, text,
//        selector? }   POST browser/press { id, key }   POST browser/scroll { id, dy, dx? }   → { page }, each
//        with a fresh screenshot
//   POST browser/eval { id, expression }   { value, truncated? } (capped)   POST browser/text { id }   { url,
//        title, text } — the visible text outline   POST browser/shot { id }   { shot }   POST browser/console
//        { id }   { lines }   POST browser/close { id }   { page }
//   GET browser/list           { pages }
//   GET browser/shot?id=&n=    the screenshot (image/png; state/browser/<id>/<n>.png, by id and number only)
//   GET apple/actions          { actions: [{ id, available }] } — macOS only
//   POST apple/run { action, inputs }   { text } — run one Apple action
//        (companion/hardware/apple/index.js: Shortcuts, speech, notifications, clipboard,
//        Spotlight, Reminders, open a link)
//   GET speech/status          { recognize, ready, error, voice, sampleRate } — hardware/speech
//   GET speech/voices          { voices: [{ name, lang }] } — the Mac's `say` voices
//   POST speech/transcribe { audio, locale }   { text, seconds, ms } — base64 16 kHz
//        mono 16-bit PCM, recognized on-device (Apple SpeechAnalyzer)
//   POST speech/say { text, voice?, rate? }    { audio, type } — base64 WAV from `say`
//   GET web/search?q=&limit=&source=   { engine, query, results: [{ title, url, snippet, source }], note? }
//        source web (SearXNG if ASKK_SEARXNG_URL, else DuckDuckGo; on failure the wikipedia + arxiv + hn
//        fallback, engine "fallback", note says why) | wikipedia | arxiv | hn
//   GET web/read?url=          { url, title, text } — a public page as text
//        (companion/capabilities/web.js: per-engine queues, retries, cooling, cache)
//   GET mcp/tools              { servers: [{ name, ok, error?, approval, tools }] }
//   POST mcp/call { server, tool, arguments }   { text, isError } — call one tool on an MCP server (.mcp.json, the
//        desk's own mcp.json; companion/capabilities/mcp.js), an integration (integrations/<name>/,
//        companion/capabilities/integrations.js) or a server the desk's host() hook adds
//   GET llm/<provider>/v1/models, POST llm/<provider>/v1/chat/completions
//        OpenAI-compatible: the claude/codex/gemini CLIs and Apple's on-device
//        model (companion/capabilities/local-models.js); capability models.local
//   GET team/stream            Server-Sent Events: the desk's team (companion/team/kernel-team.js): snapshot, then
//                              state / kernel / log events — capability team
//   POST team/send { text, agent?, from? }   { ok, value: { engine, agent, queued } } — work for an agent without
//        waiting (cron, scripts, any source); default agent: the lead
//   POST team/call { target, method, args }   { ok, value | error } — an action on an agent or the desk
//
// Capabilities: fs.read and fs.write (write + delete) on `root`; readOnly drops fs.write, term and browser (they run
// code); apple on macOS; mcp when a tool server is configured; team when the desk's team runs here.
// A GET handler answers with a value (sent as JSON) or its own Response (a stream, an image).
//
// Security: the Host header must name this machine's loopback address and
// port (blocks DNS rebinding and other machines on the network); a
// cross-origin Origin is refused and no CORS headers are sent; POST needs a
// same-origin Origin and a JSON body; every path is resolved through realpath
// and must stay inside the root (symlinks out of it are refused). Agents
// cannot write or delete ASKK's own configuration (.env*, .mcp.json), which
// would let them give themselves a model, a key or a program to run.
// Terminal programs run sandboxed (companion/capabilities/sandbox.js: their lane, no .env, no desk server port);
// preview pages never show the desk server's own ports (a page same-origin with this API could POST to it). Both
// end with the desk: close() stops every session and closes every page (a reload, companion/server/desks.js).

import { realpath } from "node:fs/promises"
import { join, resolve } from "node:path"
import { createApple } from "../hardware/apple/index.js"
import { loadHardware } from "../hardware/index.js"
import { createFiles } from "../capabilities/files.js"
import { createTerm, termRoutes } from "../capabilities/terminal.js"
import { browserRoutes, createBrowser } from "../capabilities/browser.js"
import { createWeb, webRoutes } from "../capabilities/web.js"
import { loadIntegrations } from "../capabilities/integrations.js"
import { createLocalModels, localModelRoute } from "../capabilities/local-models.js"
import { createMcp } from "../capabilities/mcp.js"
import { runDeskSetup } from "../team/desk.js"
import { wakesRoutes } from "../shared/wakes.js"
import { httpError, json } from "../shared/http.js"

export const VERSION = "0.2.0"
import { API_PREFIX, DESKS_PORT, HOST_LIMITS } from "../shared/config.js"
export { API_PREFIX }
const MAX_WRITE = HOST_LIMITS.hostApi.writeBytes // bytes accepted by fs/write

export async function createHostApi({
  root: rootArg,
  desk = null, // the desk's config (companion/team/desk.js loadDesk): its name, state folder, tool servers, hooks
  team = null, // the desk's team (companion/team/kernel-team.js): agents every tab follows
  readOnly = false,
  port,
  name = "askk-companion",
  mcpFile = resolve(process.cwd(), ".mcp.json"),
  integrationsDir = resolve(process.cwd(), "integrations"),
  listen = false, // run integration listeners (a continuous server)
  hostPorts = [], // more ports of desk servers (desks.js: every hosted desk's), or a function returning them
}) {
  const root = await realpath(resolve(rootArg))
  const apple = await createApple()
  const { speech } = await loadHardware({ log: (line) => console.log(line) }) // hardware/: optional, per machine
  const web = createWeb()
  const local = await createLocalModels() // claude/codex/gemini CLIs, Apple on-device
  const mcpServers = await createMcp({ files: [mcpFile, ...(desk?.mcp ? [desk.mcp] : [])] })
  // A desk may limit the integrations it runs (desk `integrations: [...]`): one Telegram bot can have only one
  // listener, so a second desk declares none.
  const integrations = await loadIntegrations({ dir: integrationsDir, listen, only: Array.isArray(desk?.integrations) ? desk.integrations : null })
  for (const n of integrations?.names ?? []) {
    if (mcpServers?.names.includes(n)) throw new Error(`"${n}" is both an MCP server and an integration.`)
  }
  // MCP servers and integrations, offered to the desk the same way. The desk's host() hook may wrap the call
  // (innermost first), guard it (outermost, after every wrap: the desk's own checks, kept where agents cannot
  // write) and add tool servers.
  const runtime = desk?.state ?? join(root, "state")
  let call =
    mcpServers || integrations
      ? (server, tool, args) =>
          integrations?.has(server) ? integrations.call(server, tool, args) : mcpServers ? mcpServers.call(server, tool, args) : Promise.reject(httpError(404, `Unknown MCP server "${server}".`))
      : (server) => Promise.reject(httpError(404, `Unknown MCP server "${server}".`))
  const deskServers = []
  const guards = []
  if (desk) {
    if (listen) runDeskSetup(desk)
    if (desk.host) {
      // `call` for the desk's tools is the final one (after every wrap), bound late.
      // root: the workspace; listen: a continuous server (one per desk), where watchers may run.
      const hooks = (await desk.host({ call: (...args) => below(...args), env: process.env, state: runtime, dir: desk.folder, root, listen })) ?? {}
      if (typeof hooks.wrap === "function") call = hooks.wrap(call)
      for (const server of hooks.servers ?? []) deskServers.push(server)
      if (typeof hooks.guard === "function") guards.push(hooks.guard)
    }
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
  const capabilities = [
    ...(readOnly ? ["fs.read"] : ["fs.read", "fs.write"]),
    ...(local ? ["models.local"] : []),
    ...(apple ? ["apple"] : []),
    ...(speech ? ["speech"] : []),
    "web",
    ...(mcp ? ["mcp"] : []),
    ...(team ? ["team"] : []),
    "wakes",
    ...(readOnly ? [] : ["term", "browser"]),
  ]
  const files = createFiles({ root, readOnly, mounts: desk?.mounts ?? null })
  // 2026-10-17: terminal sessions and preview pages live here, per desk, so they outlast agent steps and runs and
  // end with the desk (close()). The desk server's ports: no program connects to them, no page shows them.
  const hostLog = (line) => (team?.log ? team.log(line) : console.error(line))
  const deskPorts = () =>
    [...new Set([port, DESKS_PORT, desk?.port, ...((typeof hostPorts === "function" ? hostPorts() : hostPorts) ?? [])].map(Number))].filter((n) => Number.isInteger(n) && n > 0)
  const term = readOnly ? null : createTerm({ root, state: runtime, policy: desk?.terminal ?? null, mounts: desk?.mounts ?? null, hostPorts: deskPorts, log: hostLog })
  const browser = readOnly ? null : createBrowser({ state: runtime, blockedPorts: deskPorts, log: hostLog })
  const localModel = local ? localModelRoute(local) : null
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`])

  const GET = {
    whoami: () => ({ name, version: VERSION, desk: desk ? { name: desk.name, description: desk.description } : null, root, runtime, capabilities, platform: process.platform, localModels: local?.providers ?? [] }),
    ...files.GET,
    ...(apple ? { "apple/actions": () => ({ actions: apple.actions }) } : {}),
    ...(speech ? { "speech/status": () => speech.status(), "speech/voices": () => speech.voices() } : {}),
    ...webRoutes(web).GET,
    ...(mcp ? { "mcp/tools": async () => ({ servers: await mcp.tools() }) } : {}),
    ...wakesRoutes(root).GET,
    ...(term ? termRoutes(term).GET : {}),
    ...(browser ? browserRoutes(browser).GET : {}),
  }
  const POST = {
    ...files.POST,
    ...(term ? termRoutes(term).POST : {}),
    ...(browser ? browserRoutes(browser).POST : {}),
    ...(apple ? { "apple/run": ({ action, inputs }) => apple.run(action, inputs) } : {}),
    ...(speech ? { "speech/transcribe": (body) => speech.transcribe(body), "speech/say": (body) => speech.speak(body) } : {}),
    ...(mcp ? { "mcp/call": ({ server, tool, arguments: args }) => mcp.call(server, tool, args) } : {}),
    ...(team ? { "team/call": (body) => team.call(body), "team/send": (body) => team.send(body) } : {}),
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
      if (team && request.method === "GET" && endpoint === "team/stream") return team.stream(request)
      if (term && request.method === "GET" && endpoint === "term/stream") return term.stream(request, url.searchParams.get("id"))
      if (request.method === "GET" && endpoint === "fs/watch") return await files.watch(url.searchParams, request)
      const llm = local && endpoint.match(/^llm\/([a-z-]+)\/v1\/(models|chat\/completions)$/)
      if (llm) return await localModel(request, llm[1], llm[2], sameOrigin)
      if (request.method === "GET") {
        const handler = GET[endpoint]
        if (!handler) return json(404, { error: "Unknown endpoint." })
        const value = await handler(url.searchParams, request)
        return value instanceof Response ? value : json(200, value)
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
        // A handler may answer with its own Response (a stream).
        const value = await handler(body, request)
        return value instanceof Response ? value : json(200, value)
      }
      return json(405, { error: "Method not allowed." })
    } catch (error) {
      return json(error.status ?? 500, { error: error.message })
    }
  }

  // integrations: for host code beside the API (a desk's Telegram bridge, companion/server/desks.js). close(): the
  // tool servers it started and its integration listeners stop, its file watches end, its preview pages close and
  // its terminal sessions are stopped (a desk reloaded without a restart); resolves once every session has ended.
  const close = () => {
    mcpServers?.close()
    integrations?.close()
    files.close()
    browser?.closeAll()
    return term?.close() ?? Promise.resolve()
  }
  // routes: what this API answers (the header above documents each; host-api.test.js checks it does).
  const routes = { GET: [...Object.keys(GET), ...(team ? ["team/stream"] : []), ...(term ? ["term/stream"] : []), "fs/watch"], POST: Object.keys(POST) }
  return { root, capabilities, handle, integrations, close, routes }
}
