// A fake host for the inbuilt kit's tests (not a test file): the routes the kit calls — fs/list, fs/read, fs/write,
// term/*, browser/*, web/* — over an in-memory workspace, sessions and pages, answering and failing the way
// companion/team/compose.js hostClient does (a non-2xx: an Error "<METHOD> <path>: HTTP <status> {"error": …}" with
// .status). Every call is recorded: host.calls [{method, path, body}]. term/start's `slot` reuses the agent's session
// of that slot the way companion/capabilities/terminal.js does (same id, `$` line and lines appended to its scrollback,
// `runs` counted, 409 while it runs unless `replace`); its `lease` (2026-10-17) is refused (409, the host's reason) while
// another running session holds it.
//
//   const host = fakeHost({ files: {"projects/x/train.py": "…"}, onStart: (body) => ({status, exit, tail}) })

const fail = (method, path, status, message) => Object.assign(new Error(`${method} ${path}: HTTP ${status} ${JSON.stringify({ error: message })}`), { status })
const revisionOf = (text) => {
  let h = 0
  for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h.toString(16).padStart(8, "0")
}
const bytes = (text) => new TextEncoder().encode(String(text)).length

export function fakeHost({ files = {}, binary = [], onStart = null, search = null, read = null, clock = () => Date.now() } = {}) {
  const fs = new Map(Object.entries(files)) // path -> text
  const mtimes = new Map([...fs.keys()].map((p, i) => [p, 1_700_000_000_000 + i]))
  const binaries = new Set(binary)
  const sessions = [] // oldest first
  const pages = []
  const calls = []
  let n = 0

  const dirs = () => {
    const out = new Set()
    for (const p of fs.keys()) {
      const parts = p.split("/")
      for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join("/"))
    }
    return out
  }
  const isDir = (p) => p === "" || dirs().has(p)

  // ---- fs ----
  function list(path) {
    if (fs.has(path)) throw fail("GET", `fs/list?path=${encodeURIComponent(path)}`, 400, "Not a folder.")
    if (!isDir(path)) throw fail("GET", `fs/list?path=${encodeURIComponent(path)}`, 404, `Not found: ${path || "."}`)
    const prefix = path ? `${path}/` : ""
    const seen = new Map()
    for (const p of [...fs.keys(), ...dirs()]) {
      if (!p.startsWith(prefix) || p === path) continue
      const name = p.slice(prefix.length).split("/")[0]
      if (seen.has(name)) continue
      const full = prefix + name
      seen.set(name, fs.has(full) ? { name, type: "file", size: bytes(fs.get(full)), mtime: mtimes.get(full) + 0.25 } : { name, type: "dir", size: 96, mtime: 1_600_000_000_000 })
    }
    return { path, entries: [...seen.values()] }
  }
  function readFile(path) {
    if (!fs.has(path)) throw fail("GET", `fs/read?path=${encodeURIComponent(path)}`, isDir(path) ? 400 : 404, isDir(path) ? "Not a file." : `Not found: ${path}`)
    const text = fs.get(path)
    const bin = binaries.has(path)
    return { path, size: bytes(text), binary: bin, truncated: false, text: bin ? null : text, revision: revisionOf(text) }
  }
  function write({ path, text, revision }) {
    if (/(^|\/)\.env(\..+)?$/.test(path) && !path.endsWith(".env.example")) throw fail("POST", "fs/write", 403, ".env is ASKK's configuration; only the owner edits it.")
    const exists = fs.has(path)
    const current = exists ? revisionOf(fs.get(path)) : null
    if (revision !== undefined && revision !== current) throw fail("POST", "fs/write", 409, current ? `${path} changed since it was read.` : `${path} no longer exists.`)
    fs.set(path, text)
    mtimes.set(path, 1_700_000_000_000 + 1000 * ++n)
    return { path, size: bytes(text), revision: revisionOf(text), created: !exists }
  }

  // ---- term ----
  const summary = (s, tail = 50) => {
    const { lines, before, head, ...rest } = s
    return { ...rest, ...(tail > 0 ? { tail: lines.slice(-tail) } : {}) }
  }
  const scrollback = (s) => [...s.before, ...(s.head ? [s.head] : []), ...s.lines] // every command's lines
  const session = (method, path, id) => {
    const s = sessions.find((x) => x.id === id)
    if (!s) throw fail(method, path, 404, `No session "${id}".`)
    return s
  }
  function start(body) {
    const agent = body.agent ?? null
    const slot = body.slot ?? null
    const prev = slot ? sessions.findLast((x) => x.slot === slot && x.agent === agent) : null
    let replaced = null
    if (prev?.status === "running") {
      if (!body.replace) throw fail("POST", "term/start", 409, `${prev.id} (${agent ?? "the owner"}'s ${slot} session) is still running ${prev.command}: wait for it, stop it, or start with replace.`)
    }
    const holder = body.lease ? sessions.find((x) => x.status === "running" && x.lease === body.lease && !(x === prev && body.replace)) : null
    if (holder) throw fail("POST", "term/start", 409, `${body.lease} is held by ${holder.id} (${holder.agent ?? "the owner"}: ${String(holder.command).slice(0, 80)}) since ${holder.startedAt} — terminal.wait it, then start again`)
    if (prev?.status === "running") {
      Object.assign(prev, { status: "stopped", endedAt: new Date(Date.parse(prev.startedAt) + 2000).toISOString(), reason: `replaced by ${body.command}` })
      replaced = { command: prev.command, status: prev.status, exit: prev.exit, startedAt: prev.startedAt, endedAt: prev.endedAt }
    }
    const cwd = body.cwd ?? "."
    const run = { name: body.name || String(body.command).split(" ")[0], command: body.command, cwd, lease: body.lease ?? null, status: "running", exit: null, pid: 4000 + ++n, startedAt: new Date(clock()).toISOString(), endedAt: null, urls: [], lines: [], head: slot ? `${cwd === "." ? "" : `${cwd} `}$ ${body.command}` : null }
    let s = prev
    if (s) {
      s.before.push(...(s.head ? [s.head] : []), ...s.lines)
      delete s.reason
      Object.assign(s, run, { runs: s.runs + 1 })
      sessions.splice(sessions.indexOf(s), 1) // newest again
    } else s = { id: `term-${n}`, agent, slot, runs: 1, ...run, before: [] }
    const out = onStart?.(body, s) ?? (String(body.command).startsWith("sleep") ? {} : { status: "exited", exit: 0, lines: [`ran ${body.command}`] })
    Object.assign(s, out)
    if (s.status !== "running" && !s.endedAt) s.endedAt = new Date(Date.parse(s.startedAt) + 1500).toISOString()
    sessions.push(s)
    return { session: summary(s), ...(replaced ? { replaced } : {}) }
  }

  // ---- browser ----
  const pageOf = (path, id) => {
    const p = pages.find((x) => x.id === id)
    if (!p) throw fail("POST", path, 404, `No preview page "${id}" (browser/list lists them).`)
    if (p.status !== "open" && path !== "browser/close") throw fail("POST", path, 410, `Page ${id} is closed (closed).`)
    return p
  }
  const pageSummary = (p) => {
    const { text, ...rest } = p
    return { ...rest, width: 1280, height: 800, console: p.console.slice(-20) }
  }
  const shoot = (p) => {
    const k = (p.shot?.n ?? 0) + 1
    p.shot = { n: k, at: new Date(clock()).toISOString(), width: 1280, height: 800, url: `/__askk/browser/shot?id=${p.id}&n=${k}` }
  }

  async function get(path) {
    calls.push({ method: "GET", path })
    const url = new URL(`http://host/${path}`)
    const q = (k) => url.searchParams.get(k)
    switch (url.pathname.slice(1)) {
      case "fs/list":
        return list(q("path") ?? "")
      case "fs/read":
        return readFile(q("path") ?? "")
      case "term/list": {
        const tail = q("tail") == null ? 50 : Number(q("tail"))
        return { sessions: [...sessions].reverse().map((s) => summary(s, tail)), policy: { programs: ["bun", "python", "uv"], toolchains: ["python", "javascript"], missing: [] } }
      }
      case "term/read": {
        const s = session("GET", path, q("id"))
        return { session: summary(s, 0), lines: scrollback(s).slice(-(Number(q("lines")) || 50)) }
      }
      case "browser/list":
        return { pages: [...pages].reverse().map(pageSummary) }
      case "web/search":
        if (!search) throw fail("GET", path, 500, "no search")
        return search({ q: q("q"), limit: Number(q("limit")), source: q("source") })
      case "web/read":
        if (!read) throw fail("GET", path, 500, "no read")
        return read(q("url"))
      default:
        throw fail("GET", path, 404, `No route ${url.pathname}`)
    }
  }

  async function post(path, body = {}) {
    calls.push({ method: "POST", path, body })
    switch (path) {
      case "fs/write":
        return write(body)
      case "term/start":
        return start(body)
      case "term/wait": {
        const s = session("POST", path, body.id)
        // 2026-10-17: until is literal text, or a list where any one is enough (the host's includes).
        const texts = (Array.isArray(body.until) ? body.until : [body.until]).filter((t) => typeof t === "string" && t !== "")
        const line = texts.length ? s.lines.find((l) => texts.some((t) => l.includes(t))) : undefined
        return { session: summary(s), matched: line !== undefined, timedOut: s.status === "running" && line === undefined, ...(line !== undefined ? { line } : {}) }
      }
      case "term/write": {
        const s = session("POST", path, body.id)
        s.lines.push(`> ${body.text}`)
        return { session: summary(s) }
      }
      case "term/stop": {
        const s = session("POST", path, body.id)
        Object.assign(s, { status: "stopped", endedAt: new Date(Date.parse(s.startedAt) + 2000).toISOString(), reason: "stopped" })
        return { session: summary(s) }
      }
      case "browser/open": {
        if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+/.test(String(body.url))) throw fail("POST", path, 403, "only pages on this computer (localhost, 127.0.0.1, [::1])")
        const p = { id: `page-x-${++n}`, url: body.url, title: "Dashboard", status: "open", by: body.by ?? null, at: new Date(clock()).toISOString(), shot: null, console: [], errors: 0, text: "# Dashboard\nloss 3.10\n[button] Train" }
        shoot(p)
        pages.push(p)
        return { page: pageSummary(p) }
      }
      case "browser/navigate":
      case "browser/click":
      case "browser/type":
      case "browser/press":
      case "browser/scroll": {
        const p = pageOf(path, body.id)
        if (body.url) p.url = body.url
        shoot(p)
        return { page: pageSummary(p) }
      }
      case "browser/text": {
        const p = pageOf(path, body.id)
        return { url: p.url, title: p.title, text: p.text }
      }
      case "browser/eval":
        return { value: { expression: body.expression }, page: pageSummary(pageOf(path, body.id)) }
      case "browser/console":
        return { lines: pageOf(path, body.id).console }
      case "browser/shot": {
        const p = pageOf(path, body.id)
        shoot(p)
        return { shot: p.shot, page: pageSummary(p) }
      }
      case "browser/close": {
        const p = pageOf(path, body.id)
        p.status = "closed"
        return { page: pageSummary(p) }
      }
      default:
        throw fail("POST", path, 404, `No route ${path}`)
    }
  }

  return { get, post, calls, fs, sessions, pages }
}
