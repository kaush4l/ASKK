// Terminal sessions (capability `term`), served by the host API (companion/server/host-api.js). A session is one
// command line run in a PTY under sandbox-exec; it keeps running across agent steps and runs until it exits, is
// stopped, passes the desk's backgroundMinutes, or the desk stops (api.close(), a reload), and every session ends when
// this server exits. 2026-10-17: a desk's own terminal tool (one-shot runs and
// pipe-fed background processes) moved to the host as sessions every desk shares: a PTY (colours, progress bars,
// prompts that read stdin), live output for the Live workbench (term/stream), its tail for agents (term/list).
//
//   POST term/start { command, cwd?, name?, agent?, writes?, wait?, slot?, replace?, lease? }   { session, replaced? }
//                   wait: seconds to wait for its exit; slot: the agent's session to run it in (below); lease: a
//                   short name the session holds while it runs (below)
//   POST term/write { id, text, raw? }                                 { session }   stdin; "\n" appended unless raw
//   POST term/wait  { id, seconds, until? }                            { session, matched, timedOut, line? }
//                   until: literal text, or a list of texts (any one is enough), found in a new line (includes):
//                   ≤ 300 characters each, ≤ 8 of them; 400 for anything else (untilTexts)
//   POST term/stop  { id }                                             { session }   SIGTERM its group, SIGKILL after the grace
//   GET  term/list?tail=50                                             { sessions, policy } newest first
//   GET  term/read?id=&lines=                                          { session, lines }   lines: its scrollback
//   GET  term/stream?id=   SSE: snapshot { session, lines, raw }, then out { id, data } raw chunks, session { session }
//                          (its urls changed: the summary without tail), exit { id, exit, status }, run { session } (a
//                          slot session took its next command: status running again, the same stream goes on)
//                          (no id: every session — snapshot { sessions }, then start { session }, out, session, exit, run)
//   session: { id, name, command, cwd, agent, slot, lease, runs, status: running|exited|stopped|failed, exit, pid,
//              signal?, error?, reason?, startedAt, endedAt, urls: [localhost URLs it printed], tail: [the command's last
//              lines] }   lease: null when its command holds none
//
// Slots (2026-10-17 owner: a tab per command buried the Live terminal; at most two sessions per agent — one for its
// commands, one for a long run it keeps reading): term/start with `slot` ("main", "long": the caller names them) runs
// the command in the agent's session of that slot — the newest one of this agent with this slot — instead of a new
// one: the same id and stream, `$ <command>` and its output appended to the scrollback, `runs` counted, the fields
// (command, name, cwd, status, exit, times, urls) the new command's, `tail` its lines only. While that session runs
// a command, a start is refused (409) unless `replace` (stopped first, reason "replaced by …"; the answer's `replaced`
// {command, status, exit, startedAt, endedAt} says what was stopped). No slot: a new
// session per command (the owner's own, earlier callers). A program never keeps state between commands (no shell):
// each runs from its own cwd.
//
// Leases (2026-10-17, the owner's model line: one MPS GPU, and nothing arbitrated between sessions, so a second run on
// it would share the GPU and both runs' numbers would mean nothing): term/start with `lease` ("gpu", or any short name
// /^[a-z][a-z0-9-]{0,19}$/) is refused (409) while another running session of this desk holds the same lease — the
// answer names that session, its agent, its command and since when, so the caller waits for it (terminal.wait) and
// starts again. A slot session's next command checks again (its lease is that command's; the one it replaces is
// stopped first, so its own lease never blocks it). A command without a lease is never held back.
//
// A command is one program with its arguments, or several joined by `&&` (run in order, each in a fresh PTY, stopping
// at the first failure); `cd <dir>` moves inside the workspace (or a mounted folder: desks/<name>, a loaded project projects/<name>: files.js workspaceMounts).
// No shell: pipes, redirects, `;`, `$(…)` and backticks are refused; only the desk's programs run (its toolchains' and
// its `programs`, main.js `terminal`); work is never destroyed (sandbox.js refuseDestructive). Every program runs under
// sandbox-exec (sandbox.js sandboxProfile): it writes only the caller's lane (`writes`: globs under the workspace; none
// given = the whole workspace, the owner's own sessions; [] = none of it), its private temp folder and the toolchains'
// caches — never .env*, .mcp.json or a folder on its PATH; it never reads ~/.ssh, .env files or another desk (custom/,
// mounted desks excepted); it never connects to the desk server's ports. Its environment: PATH, HOME, LANG, TMPDIR,
// TERM=xterm-256color and the toolchains' variables — none of ASKK's keys. 2026-10-17: the toolchains' caches are the
// desk's own, <caches>/<desk>/ (~/.askk/caches/<desk>: toolchains.js), set by environment; the user's package caches
// are never written (an unsandboxed install would trust what a session planted there).
//
// Orphans: every running program group is booked in <desk state>/terminal.running.json (sandbox.js groupBook) until
// it ends; a server that crashed (no exit hook ran) leaves its groups booked, and the desk's next createTerm SIGKILLs
// the ones still led by the process booked (same pid and start time) before anything else runs.
//
// Output: the raw text (its last keepChars) and a line view (LineView: `\r` rewrites the line, escape sequences are
// dropped — what Bun.stripANSI does to a whole text, kept across chunks a sequence may straddle). Every session's whole
// output goes to <desk state>/terminal/<id>.log, one row per finished session to <desk state>/terminal.jsonl
// { at, id, agent, cwd, command, status, exit, ms, tail }. URLs it prints on this computer are collected (`urls`):
// what the preview opens.
//
//   const term = createTerm({ root, state, policy, mounts, hostPorts, log, desk?, caches? })   policy: main.js `terminal`
//     desk: the desk's name (default: its folder, <desk>/state); caches: where desks' caches live (~/.askk/caches)
//   await term.close()   every session stopped, its temp folder removed; later starts refused

import { closeSync, existsSync, mkdirSync, renameSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path"
import { HOST_LIMITS } from "../shared/config.js"
import { httpError, sseResponse } from "../shared/http.js"
import { appendJsonl } from "../shared/jsonl.js"
import { within } from "../shared/paths.js"
import { attempt } from "../shared/safe.js"
import { workspaceMounts } from "./files.js"
import { groupBook, killGroup, laneRegex, privateTmp, refuseDestructive, removeTmp, sandboxProfile, sandboxRunner, splitCommand, trackGroup, untrackGroup } from "./sandbox.js"
import { CACHES, detectToolchains } from "./toolchains.js"

const T = HOST_LIMITS.term
const HOME = homedir()
export const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d+)?[^\s"'<>)\]]*/g
export const LEASE = /^[a-z][a-z0-9-]{0,19}$/ // a lease's name ("gpu"): the kernel's terminal checks the same

// The text a terminal shows, line by line: `\r` returns to the start of the line (what follows overwrites it), `\b`
// steps back, a tab moves to the next stop, erase-in-line (ESC [ K) and the cursor's column moves (ESC [ G/C/D) apply,
// every other escape sequence (colours, cursor up/down, titles, modes) is dropped. Plain JS, no Bun API: a tab may
// parse term/stream's raw chunks the same way.
//   view.write(text)   view.tail(n) → the last n lines (the line being written last, when it has text)
//   view.total         lines finished so far; view.since(total) → the finished lines after that count
export class LineView {
  constructor({ keep = T.keepLines, lineChars = T.lineChars } = {}) {
    this.keep = keep
    this.lineChars = lineChars
    this.lines = [] // finished lines, the last `keep`
    this.total = 0
    this.line = "" // the line the cursor is on
    this.col = 0
    this.esc = null // an escape sequence in progress ("" after ESC, "[…" a CSI, "]" a string, "(" a charset)
  }

  write(text) {
    const n = text.length
    let i = 0
    while (i < n) {
      if (this.esc !== null) {
        this.#escape(text[i++])
        continue
      }
      const c = text.charCodeAt(i)
      if (c >= 0x20 && c !== 0x7f) {
        let j = i + 1
        while (j < n) {
          const d = text.charCodeAt(j)
          if (d < 0x20 || d === 0x7f) break
          j++
        }
        this.#put(text.slice(i, j))
        i = j
        continue
      }
      i++
      if (c === 0x1b) this.esc = ""
      else if (c === 0x0d) this.col = 0
      else if (c === 0x0a) this.#finish()
      else if (c === 0x08) this.col = Math.max(0, this.col - 1)
      else if (c === 0x09) this.#put(" ".repeat(8 - (this.col % 8)))
      // other control characters (bell, shift in/out): nothing to show
    }
    return this
  }

  tail(n = T.tailLines) {
    const count = Math.max(0, Number(n) || 0)
    if (!count) return []
    return (this.line ? [...this.lines.slice(-count), this.line] : this.lines.slice(-count)).slice(-count)
  }

  since(total) {
    const fresh = this.total - total
    return fresh > 0 ? this.lines.slice(-Math.min(fresh, this.lines.length)) : []
  }

  #put(s) {
    if (this.col > this.line.length) this.line = this.line.padEnd(this.col)
    this.line = this.col === this.line.length ? this.line + s : this.line.slice(0, this.col) + s + this.line.slice(this.col + s.length)
    this.col += s.length
    // A line with no end in sight (dots, a blob of JSON): its first lineChars are finished, the rest goes on.
    while (this.line.length > this.lineChars) {
      const rest = this.line.slice(this.lineChars)
      this.line = this.line.slice(0, this.lineChars)
      this.#finish()
      this.line = rest
      this.col = rest.length
    }
  }

  #finish() {
    this.lines.push(this.line)
    this.total++
    this.line = ""
    this.col = 0
    if (this.lines.length > this.keep * 1.25) this.lines.splice(0, this.lines.length - this.keep)
  }

  #escape(c) {
    const e = this.esc
    if (e === "") {
      if (c === "[") this.esc = "["
      else if ("]PX^_".includes(c)) this.esc = "]" // OSC, DCS, …: a string until BEL or ESC \
      else if ("()*+-./#%".includes(c)) this.esc = "(" // a charset: one more character
      else this.esc = null // ESC 7, ESC =, …
      return
    }
    if (e === "(") {
      this.esc = null
      return
    }
    if (e[0] === "]") {
      if (c === "\x07" || e === "]\x1b") this.esc = null
      else if (c === "\x1b") this.esc = "]\x1b"
      return
    }
    const code = c.charCodeAt(0)
    if (code >= 0x40 && code <= 0x7e) {
      this.esc = null
      this.#csi(e.slice(1), c)
    } else if (code >= 0x20 && code <= 0x3f && e.length < 64) this.esc = e + c
    else this.esc = null // not a CSI after all
  }

  #csi(params, final) {
    const n = Number.parseInt(params.replace(/^[?>=<]/, ""), 10)
    const count = Number.isNaN(n) || n < 1 ? 1 : n
    if (final === "K") {
      const mode = Number.isNaN(n) ? 0 : n
      if (mode === 0) this.line = this.line.slice(0, this.col)
      else if (mode === 1) this.line = " ".repeat(Math.min(this.col + 1, this.line.length)) + this.line.slice(this.col + 1)
      else if (mode === 2) this.line = ""
    } else if (final === "G") this.col = count - 1
    else if (final === "C") this.col += count
    else if (final === "D") this.col = Math.max(0, this.col - count)
  }
}

// term/wait's `until` → the texts a line must hold one of (null: none, wait for the exit or the time). A text or a list
// of texts, each ≤ T.untilChars, ≤ T.untilTexts of them; empty texts are left out. Anything else: 400.
export function untilTexts(until) {
  if (until === undefined || until === null) return null
  const list = Array.isArray(until) ? until : [until]
  if (list.length > T.untilTexts || list.some((t) => typeof t !== "string" || t.length > T.untilChars)) {
    throw httpError(400, `until: literal text of at most ${T.untilChars} characters (a piece of a line the program prints, e.g. "val_bpb:"), or a list of at most ${T.untilTexts} of them where any one is enough.`)
  }
  const texts = list.filter((t) => t !== "")
  return texts.length ? texts : null
}

// One glob segment (a desk name in desks/<name>/…) as a RegExp.
const segment =(glob) => new RegExp(`^${String(glob).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*?/g, ".*").replace(/\?/g, ".")}$`)

// root: the workspace; state: the desk's state folder (logs); policy: the desk's main.js `terminal` ({ toolchains,
// programs, timeoutSeconds, backgroundMinutes }); mounts: main.js `mounts`; hostPorts() → the desk server's ports.
export function createTerm({ root, state, policy = null, mounts = null, hostPorts = () => [], log = () => {}, desk = null, caches = CACHES, runner = sandboxRunner() }) {
  if (!runner?.kind) throw new Error(runner?.reason ?? "no sandbox for terminal programs")
  const realRoot = realpathSync(root)
  const mount = workspaceMounts(mounts) // desks/<name> (mounted desks) and projects/<name> (loaded projects)
  const cfg = policy ?? {}
  const logDir = join(state, "terminal")
  const rowsPath = join(state, "terminal.jsonl")
  const backgroundMs = Math.max(1, Number(cfg.backgroundMinutes) || T.backgroundMinutes) * 60000
  const waitMax = Math.min(T.waitMaxSeconds, Math.max(1, Number(cfg.timeoutSeconds) || T.waitMaxSeconds))
  const ports = () => (typeof hostPorts === "function" ? hostPorts() : hostPorts) ?? []
  // The desk's own package caches: <caches>/<desk> (custom/<desk>/state → <desk>).
  const deskName = String(desk || (basename(state) === "state" ? basename(dirname(state)) : basename(state)) || "default").replace(/[^A-Za-z0-9._-]+/g, "-")
  const cache = join(caches, deskName)

  // 2026-10-17: what a crashed server left running (a training run on the GPU, a dev server on its port) goes first.
  const book = groupBook(join(state, "terminal.running.json"), log)
  const reaped = book.reap()
  if (reaped.length) log(`term: stopped ${reaped.length} program${reaped.length === 1 ? "" : "s"} an earlier server left running: ${reaped.map((r) => `${r.command ?? r.pid} (pid ${r.pid}${r.session ? `, ${r.session}` : ""})`).join(", ")}`)

  // The desk's toolchains and programs, detected the first time they are needed (each probe runs a program).
  let tools = null
  function toolchains() {
    if (tools) return tools
    const chains = detectToolchains(Array.isArray(cfg.toolchains) ? cfg.toolchains : [], { cache })
    const extra = Array.isArray(cfg.programs) ? cfg.programs.filter((p) => typeof p === "string" && p) : []
    tools = { ...chains, programs: new Set([...chains.programs, ...extra]), PATH: chains.path.join(":") }
    log(`term: toolchains ${chains.found.map((c) => `${c.id} (${c.version})`).join(", ") || "none"}${chains.missing.length ? ` · missing ${chains.missing.join(", ")}` : ""}`)
    return tools
  }
  let tmp = null
  const tmpDir = () => (tmp ??= privateTmp()) // TMPDIR unset: a private folder under /tmp, never /tmp itself

  const sessions = new Map() // id -> session
  // The sessions running now, on disk (terminal-running.json): a hard kill writes no row, so one left at the next start
  // is recorded as killed (2026-10-23 audit).
  const runningPath = join(state, "terminal-running.json")
  try {
    if (existsSync(runningPath)) {
      for (const r of JSON.parse(readFileSync(runningPath, "utf8"))) record({ ...r, at: r.at ?? new Date().toISOString(), status: "killed", exit: null, reason: "the server was killed while it ran" })
      rmSync(runningPath, { force: true })
    }
  } catch (error) {
    const to = `${runningPath}.unreadable-${Date.now()}`
    attempt(() => renameSync(runningPath, to))
    log(`term: the sessions running at the last stop did not read (${error.message}) — kept as ${to}`)
  }
  let runningSaveWarned = false
  const saveRunning = () => {
    try {
      const now = [...sessions.values()].filter((s) => s.status === "running" && !s.earlier).map((s) => ({ at: s.startedAt, id: s.id, agent: s.agent, cwd: s.cwd, command: s.command, ms: 0, tail: rowTail(s) }))
      if (now.length) writeFileSync(runningPath, JSON.stringify(now))
      else rmSync(runningPath, { force: true })
    } catch (error) {
      if (!runningSaveWarned) log(`term: the running sessions were not saved (${error.message}) — a kill would leave no record of them`)
      runningSaveWarned = true
    }
  }
  // The sessions that finished before this start (2026-10-23 audit: terminal.jsonl kept them, the pane showed none),
  // read-only under earlier:<id> — never a slot's id, so a new command never lands in one — with their last lines.
  try {
    const rows = existsSync(rowsPath) ? readFileSync(rowsPath, "utf8").split("\n").filter(Boolean).slice(-T.keepFinished) : []
    for (const line of rows) {
      let r
      try {
        r = JSON.parse(line)
      } catch {
        log(`term: a line of terminal.jsonl did not read — one earlier session left out`) // the rest still come back
        continue
      }
      const view = new LineView()
      if (r.tail) view.write(`${r.tail}\n`)
      const id = `earlier:${r.id}`
      sessions.set(id, { id, name: `${r.id} (before the restart)`, ...(r.reason ? { reason: r.reason } : {}), agent: r.agent ?? null, slot: null, lease: r.lease ?? null, runs: r.run ?? 1, command: r.command, cwd: r.cwd, status: r.status, exit: r.exit ?? null, startedAt: new Date(Date.parse(r.at) - (r.ms || 0)).toISOString(), endedAt: r.at, urls: new Set(), raw: r.tail ?? "", view, waiters: new Set(), earlier: true })
    }
  } catch (error) {
    log(`term: terminal.jsonl did not read (${error.message}) — the earlier sessions are not listed`)
  }
  const viewers = new Set() // term/stream: { id | null, send, close }
  // a session still running when the process ends gets its row too (2026-10-23 audit: it was not back after a restart)
  const atExit = () => {
    for (const s of sessions.values()) {
      if (s.status !== "running" || s.earlier) continue
      try {
        record(rowOf(s, new Date().toISOString(), { status: "stopped", exit: null, reason: "the server stopped" }))
      } catch (error) {
        log(`term: ${s.id}'s row at the stop was not written (${error.message}) — it will not be listed after the restart`)
      }
    }
  }
  process.on("exit", atExit)
  let count = 0
  let closed = false
  const refuseClosed = () => {
    if (closed) throw httpError(410, "The terminal is closed (its desk stopped).")
  }
  const running = () => [...sessions.values()].filter((s) => s.status === "running")
  const get = (id) => {
    const s = sessions.get(String(id ?? ""))
    if (!s) throw httpError(404, `No terminal session "${id}" (term/list lists them).`)
    return s
  }
  const broadcast = (event, id = null) => {
    for (const v of viewers) if (v.id === null || v.id === id) v.send(event)
  }

  // ── paths ─────────────────────────────────────────────────────────────

  // A real folder as the workspace names it ("." the root, desks/<name>/… a mounted desk, projects/<name>/… a loaded
  // project); null outside them.
  function show(abs) {
    if (within(realRoot, abs)) return relative(realRoot, abs).split(sep).join("/") || "."
    return mount?.nameOf(abs) ?? null
  }
  // A workspace folder, `path` taken from `from` (a real folder show() names): the real folder, inside the workspace
  // or a mounted folder (realpath-contained: a link out of them is refused).
  function folder(path, from = realRoot) {
    const rel = String(path ?? ".").trim() || "."
    const named = isAbsolute(rel) ? show(resolve(rel)) : posix.normalize(posix.join(show(from) ?? ".", rel.replace(/\\/g, "/")))
    if (named === null || named === ".." || named.startsWith("../")) throw httpError(403, `${path} is outside the workspace.`)
    const parts = named.split("/").filter((p) => p && p !== ".")
    let base = realRoot
    let abs = join(realRoot, ...parts)
    const point = mount?.mounted(parts)
    if (point) {
      if (parts.length === 1) throw httpError(400, `${point.prefix}/ holds the ${point.what}s; name one: ${point.prefix}/<name> (${mount.names(point)}).`)
      base = point.folder(parts[1])
      if (!base) throw httpError(403, `${point.prefix}/${parts[1]} is not a ${point.what} (${mount.names(point)}).`)
      abs = join(base, ...parts.slice(2))
    }
    const real = attempt(() => realpathSync(abs))
    if (!real) throw httpError(400, `No folder ${named} in the workspace.`)
    if (!within(base, real)) throw httpError(403, `${named} is outside the workspace.`)
    if (!statSync(real).isDirectory()) throw httpError(400, `${named} is not a folder.`)
    return real
  }

  // The caller's lane: null (the whole workspace) or its globs.
  function laneOf(writes) {
    if (writes === undefined || writes === null) return null
    const ok = Array.isArray(writes) && writes.every((g) => typeof g === "string" && g.trim() && g.length <= 200 && !g.split("/").includes(".."))
    if (!ok) throw httpError(400, 'writes: a list of globs under the workspace, e.g. ["projects/**"].')
    return writes.map((g) => g.trim())
  }
  // What a lane reaches in the mounted folders: every one is readable; the lane's globs that name desks/<name>/… or
  // projects/<name>/… (or start with **) become write rules on that folder's real path; no lane writes them all.
  function mountAccess(lane) {
    const desks = mount?.all() ?? []
    const allow = []
    const deny = []
    for (const d of desks) {
      for (const raw of lane ?? ["**"]) {
        const g = raw.replace(/^!/, "").replace(/^\.?\/+/, "")
        const parts = g.split("/")
        let rest = null
        if (parts[0] === "**") rest = g
        else if (parts[0] === d.prefix && parts.length > 1 && segment(parts[1]).test(d.name)) rest = parts.slice(2).join("/") || "**"
        if (rest !== null) (raw.startsWith("!") ? deny : allow).push(laneRegex(d.real, rest))
      }
    }
    const readable = desks.map((d) => d.real)
    return { readable, listable: [...new Set(readable.map((r) => dirname(r)))], allow, deny }
  }
  function profileFor(lane) {
    const t = toolchains()
    const m = mountAccess(lane)
    return sandboxProfile(realRoot, t.writable, lane, {
      readable: m.readable,
      listable: m.listable,
      never: [...t.path, ...t.never],
      hidden: [...(mount?.points.filter((p) => p.base).map((p) => p.base) ?? []), state],
      tmp: tmpDir(),
      blockPorts: ports(),
      allowWrites: m.allow,
      denyWrites: m.deny,
    })
  }
  const envFor = () => {
    const t = toolchains()
    return { ...t.env, PYTHONUNBUFFERED: "1", PATH: t.PATH, HOME, LANG: "en_US.UTF-8", TMPDIR: tmpDir(), TERM: "xterm-256color" }
  }

  // A project wrapper (./mvnw, ./gradlew) is the desk's when listed, and runs from the step's folder.
  function resolveProgram(program, cwd) {
    const t = toolchains()
    if (!t.programs.has(program)) throw httpError(403, `"${program}" is not one of this desk's programs: ${[...t.programs].sort().join(", ")}.`)
    if (program.startsWith("./")) {
      const abs = resolve(cwd, program)
      const real = attempt(() => realpathSync(abs))
      if (!real || show(real) === null) throw httpError(400, `No ${program} in ${show(cwd)}.`)
      return abs
    }
    const path = Bun.which(program, { PATH: t.PATH })
    if (!path) throw httpError(400, `"${program}" is not installed.`)
    return path
  }

  // ── output ────────────────────────────────────────────────────────────

  // A session's log, opened for one command (`prev`: the slot session's log so far — appended to, its size kept).
  function openLog(id, prev = null) {
    mkdirSync(logDir, { recursive: true })
    // The oldest logs beyond keepLogs go (a log is the session's whole output; the session itself is long gone).
    if (!prev) {
      try {
        const old = readdirSync(logDir).filter((f) => f.endsWith(".log")).map((f) => ({ f, at: statSync(join(logDir, f)).mtimeMs })).sort((a, b) => a.at - b.at)
        for (const { f } of old.slice(0, Math.max(0, old.length - T.keepLogs + 1))) rmSync(join(logDir, f), { force: true })
      } catch {}
    }
    const path = join(logDir, `${id}.log`)
    let fd = null
    try {
      fd = openSync(path, prev ? "a" : "w")
    } catch (error) {
      log(`term: ${id}'s log file did not open (${error.message}) — its output is not kept on disk`)
    }
    return { path, fd, bytes: prev?.bytes ?? 0, cut: prev?.cut ?? false }
  }
  function writeLog(s, text) {
    const l = s.log
    if (l.cut || l.fd == null) return
    try {
      if (l.bytes + text.length > T.logBytes) {
        l.cut = true
        writeSync(l.fd, `\n[log cut at ${Math.round(T.logBytes / 1048576)} MB; term/read has the latest lines]\n`)
      } else writeSync(l.fd, text)
      l.bytes += text.length
    } catch (error) {
      l.cut = true // stop trying; said once (2026-10-23 audit: the saved log just ended)
      log(`term: ${s.id}'s log file stopped taking output (${error.message}) — term/read still has the latest lines`)
    }
  }
  function closeLog(s) {
    if (s.log?.fd == null) return
    attempt(() => closeSync(s.log.fd))
    s.log.fd = null
  }

  // scan: look for URLs in it (not in the lines the terminal writes itself: a `$ curl http://localhost…` header).
  function output(s, text, { scan = true } = {}) {
    if (!text) return
    s.raw += text
    if (s.raw.length > T.keepChars * 1.25) s.raw = s.raw.slice(-T.keepChars)
    const before = s.view.total
    s.view.write(text)
    writeLog(s, text)
    // URLs it printed (a dev server's address), from the clean lines: escapes may straddle chunks.
    const known = s.urls.size
    for (const line of scan ? [...s.view.since(before), s.view.line] : []) {
      for (const m of line.slice(-T.lineChars).matchAll(URL_RE)) {
        if (s.urls.size >= 20) break
        s.urls.add(m[0].replace(/[.,;:]+$/, "").replace("0.0.0.0", "127.0.0.1").replace("[::]", "localhost"))
      }
    }
    for (const w of s.waiters) w.check()
    broadcast({ type: "out", id: s.id, data: text }, s.id)
    if (s.urls.size > known) broadcast({ type: "session", session: summary(s, 0) }, s.id)
  }

  // The lines of the session's current (or last) command: what it printed since its `$` header (a slot session's
  // scrollback holds the commands before it).
  const runTail = (s, n) => {
    if (!(n > 0)) return []
    const fresh = s.view.since(s.mark ?? 0)
    return (s.view.line ? [...fresh, s.view.line] : fresh).slice(-n)
  }

  // A session's row in terminal.jsonl: finished (or stopped) at `at`, with its last lines.
  const rowTail = (s) => runTail(s, T.tailLines).join("\n").slice(-T.rowTailChars)
  const rowOf = (s, at, outcome) => ({ at, id: s.id, agent: s.agent, ...(s.slot ? { slot: s.slot, run: s.runs } : {}), ...(s.lease ? { lease: s.lease } : {}), cwd: s.cwd, command: s.command, ...outcome, ms: Date.parse(at) - Date.parse(s.startedAt), tail: rowTail(s) })

  const summary = (s, n = T.tailLines) => ({
    id: s.id,
    name: s.name,
    command: s.command,
    cwd: s.cwd,
    agent: s.agent,
    slot: s.slot ?? null,
    lease: s.lease ?? null,
    runs: s.runs ?? 1,
    status: s.status,
    exit: s.exit,
    pid: s.group?.pid ?? null,
    ...(s.signal ? { signal: s.signal } : {}),
    ...(s.error ? { error: s.error } : {}),
    ...(s.reason && (s.status === "stopped" || s.status === "killed") ? { reason: s.reason } : {}),
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    urls: [...s.urls],
    ...(n > 0 ? { tail: runTail(s, Math.min(T.maxTailLines, n)) } : {}),
  })

  // ── sessions ──────────────────────────────────────────────────────────

  async function runStep(s, argv, cwd, profile, env) {
    const decoder = new TextDecoder()
    // A fresh PTY per program: one a shell left behind no longer takes a new controlling process (2026-10-17, Bun 1.4.3).
    const tty = new Bun.Terminal({ cols: T.cols, rows: T.rows, data: (_tty, bytes) => output(s, decoder.decode(bytes, { stream: true })) })
    let proc
    try {
      // Its own session and process group (detached): stop reaches what it spawned (uv run → python).
      proc = Bun.spawn(runner.wrap(profile, argv), { cwd, env, terminal: tty, detached: true })
    } catch (error) {
      tty.close()
      throw error
    }
    const group = { pid: proc.pid, running: true }
    s.tty = tty
    s.group = group
    trackGroup(group)
    book.add({ pid: proc.pid, session: s.id, agent: s.agent, command: argv.join(" ").slice(0, T.nameChars * 4) })
    await proc.exited
    group.running = false
    untrackGroup(group)
    killGroup(proc.pid, "SIGKILL", { groupOnly: true }) // what it left running in its group
    book.remove(proc.pid)
    await Bun.sleep(30) // the PTY's last output reaches the view
    s.tty = null
    attempt(() => tty.close())
    output(s, decoder.decode())
    s.signal = proc.signalCode ?? null
    return proc.exitCode ?? null
  }

  async function runSteps(s, steps, dir) {
    try {
      const profile = profileFor(s.lane)
      const env = envFor()
      for (const argv of steps) {
        if (s.stopping) break
        if (argv[0] === "cd") {
          dir = folder(argv[1] ?? ".", dir)
          s.cwd = show(dir)
          continue
        }
        if (steps.length > 1) output(s, `$ ${argv.join(" ")}\r\n`, { scan: false })
        s.exit = await runStep(s, [resolveProgram(argv[0], dir), ...argv.slice(1)], dir, profile, env)
        if (s.exit !== 0) break
      }
      s.status = s.stopping ? "stopped" : "exited"
    } catch (error) {
      s.status = s.stopping ? "stopped" : "failed"
      s.error = error.message
      output(s, `${error.message}\r\n`)
    }
    finish(s)
  }

  function finish(s) {
    clearTimeout(s.limit)
    s.endedAt = new Date().toISOString()
    closeLog(s)
    queueMicrotask(saveRunning)
    record(rowOf(s, s.endedAt, { status: s.status, exit: s.exit }))
    for (const w of [...s.waiters]) w.check()
    broadcast({ type: "exit", id: s.id, exit: s.exit, status: s.status, ...(s.signal ? { signal: s.signal } : {}) }, s.id)
    forget()
  }

  function record(row) {
    try {
      appendJsonl(rowsPath, row)
      if (Bun.file(rowsPath).size > T.rowMaxBytes) {
        const rows = readFileSync(rowsPath, "utf8").split("\n").filter(Boolean).slice(-T.rowKeep)
        writeFileSync(rowsPath, `${rows.join("\n")}\n`)
      }
    } catch (error) {
      log(`term: ${rowsPath}: ${error.message}`)
    }
  }

  // Finished sessions beyond keepFinished are forgotten, oldest first (their log stays on disk).
  function forget() {
    const done = [...sessions.values()].filter((s) => s.status !== "running")
    for (const old of done.slice(0, Math.max(0, done.length - T.keepFinished))) sessions.delete(old.id)
  }

  const waitSeconds = (x) => Math.min(waitMax, Math.max(0, Number(x) || 0))

  // term/start's `slot` (null: a new session) and `lease` (null: none): a short name matching `re`, else 400 `message`.
  function shortName(value, re, message) {
    if (value === undefined || value === null || value === "") return null
    if (typeof value !== "string" || !re.test(value)) throw httpError(400, message)
    return value
  }
  // The running session holding `lease`, if one does (the caller's own slot session is stopped before this is asked).
  const holderOf = (lease) => (lease ? running().find((x) => x.lease === lease) : null)
  const held = (h) => httpError(409, `${h.lease} is held by ${h.id} (${h.agent ?? "the owner"}: ${h.command.slice(0, 80)}) since ${h.startedAt} — terminal.wait it, then start again`)

  async function start({ command, cwd = ".", name, agent = null, writes, wait = 0, slot, replace = false, lease } = {}) {
    refuseClosed()
    if (typeof command !== "string" || !command.trim()) throw httpError(400, 'Expected {"command": "uv run train.py"}.')
    if (command.length > T.inputChars) throw httpError(400, `A command is at most ${T.inputChars} characters.`)
    let steps
    try {
      steps = splitCommand(command.trim())
    } catch (error) {
      throw httpError(400, error.message)
    }
    const lane = laneOf(writes)
    const key = shortName(slot, /^[A-Za-z0-9._:-]{1,40}$/, 'slot: a short name for the session to run it in, e.g. "main" or "long".')
    const leased = shortName(lease, LEASE, 'lease: a short name — lowercase letters, digits and -, up to 20 chars, starting with a letter (e.g. "gpu").')
    const t = toolchains()
    for (const argv of steps) {
      if (argv[0] === "cd") {
        if (argv.length > 2) throw httpError(400, "cd takes one folder.")
        continue
      }
      if (!t.programs.has(argv[0])) throw httpError(403, `"${argv[0]}" is not one of this desk's programs: ${[...t.programs].sort().join(", ")}.`)
      refuseDestructive(argv)
    }
    const dir = folder(cwd)
    const who = agent ? String(agent).slice(0, T.nameChars) : null
    // The agent's session in this slot, if it has one still listed.
    const prev = key ? [...sessions.values()].findLast((x) => x.slot === key && x.agent === who) : null
    const busy = () => httpError(409, `${prev.id} (${who ?? "the owner"}'s ${key} session) is still running ${prev.command}: wait for it, stop it, or start with replace.`)
    let replaced = null
    if (prev?.status === "running" && !replace) throw busy()
    // The lease before anything is stopped (a replace never ends a run only to be refused), its own run aside; again
    // after the stop, should another start have taken it meanwhile.
    const holder = leased ? running().find((x) => x.lease === leased && !(x === prev && replace)) : null
    if (holder) throw held(holder)
    if (prev?.status === "running") {
      await stop({ id: prev.id }, `replaced by ${command.trim()}`.slice(0, T.nameChars * 2))
      refuseClosed()
      if (prev.status === "running") throw busy() // another start took it meanwhile
      replaced = { command: prev.command, status: prev.status, exit: prev.exit, startedAt: prev.startedAt, endedAt: prev.endedAt }
      const taken = holderOf(leased)
      if (taken) throw held(taken)
    }
    if (running().length >= T.maxSessions) throw httpError(429, `${T.maxSessions} terminal sessions are running already; stop one first (term/stop).`)
    const programs = steps.filter((a) => a[0] !== "cd").map((a) => a[0])
    const run = {
      name: String(name ?? "").trim().slice(0, T.nameChars) || programs.join(" && ").slice(0, T.nameChars) || "cd",
      command: command.trim(),
      cwd: show(dir),
      lane,
      lease: leased,
      status: "running",
      exit: null,
      signal: null,
      error: null,
      reason: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
      urls: new Set(),
      stopping: false,
    }
    let s = prev
    if (s) {
      // The slot's next command: the same session (moved last: newest in term/list), its log appended to.
      Object.assign(s, run, { runs: (s.runs ?? 1) + 1, log: openLog(s.id, s.log) })
      sessions.delete(s.id)
      sessions.set(s.id, s)
      queueMicrotask(saveRunning)
    } else {
      const id = `term-${Date.now().toString(36)}-${++count}`
      s = { id, agent: who, slot: key, runs: 1, ...run, raw: "", view: new LineView(), tty: null, group: null, waiters: new Set(), log: openLog(id) }
      sessions.set(id, s)
      queueMicrotask(saveRunning) // on disk while it runs (a hard kill leaves it there)
      forget()
    }
    if (prev) broadcast({ type: "run", session: summary(s, 0) }, s.id)
    else broadcast({ type: "start", session: summary(s, 0) })
    if (key) {
      // `<cwd> $ <command>` heads each command in a slot session's scrollback.
      if (s.view.line) output(s, "\r\n", { scan: false })
      output(s, `${s.cwd === "." ? "" : `${s.cwd} `}$ ${s.command}\r\n`, { scan: false })
    }
    s.mark = s.view.total
    s.limit = setTimeout(() => stop({ id: s.id }, `stopped after ${Math.round(backgroundMs / 60000)} min (the desk's limit)`).catch(() => {}), backgroundMs)
    s.limit.unref?.()
    s.done = runSteps(s, steps, dir)
    const seconds = waitSeconds(wait)
    if (seconds > 0) {
      let timer
      await Promise.race([s.done, new Promise((r) => (timer = setTimeout(r, seconds * 1000)))])
      clearTimeout(timer)
    }
    return { session: summary(s), ...(replaced ? { replaced } : {}) }
  }

  function write({ id, text, raw = false } = {}) {
    const s = get(id)
    if (typeof text !== "string") throw httpError(400, 'Expected {"id": "<session>", "text": "…"}.')
    if (text.length > T.inputChars) throw httpError(400, `At most ${T.inputChars} characters per write.`)
    if (s.status !== "running" || !s.tty) throw httpError(409, `Session ${s.id} is ${s.status === "running" ? "between programs" : s.status}; nothing reads its input.`)
    try {
      s.tty.write(raw ? text : `${text}\n`)
    } catch (error) {
      throw httpError(409, `Session ${s.id}: ${error.message}`)
    }
    return { session: summary(s) }
  }

  // Until it exits, a line of the output since the call (or the line the cursor is on) holds one of the `until` texts,
  // or `seconds` pass — whichever first. 2026-10-17: `until` was an agent's regex, tested in the one process hosting
  // every desk; three rounds of backtracking guards still let accepted ones stall it 1–10 s (backreferences,
  // lookarounds). Agents only wait for markers ("val_bpb:", "ready on"), so it is literal text found with includes:
  // linear in the line, nothing to refuse but size (untilTexts).
  async function wait({ id, seconds = 30, until } = {}, request = null) {
    const s = get(id)
    const texts = untilTexts(until)
    if (s.status !== "running") return { session: summary(s), matched: false, timedOut: false }
    return new Promise((done) => {
      let seen = s.view.total
      const timer = setTimeout(() => end({ matched: false, timedOut: true }), waitSeconds(seconds) * 1000)
      const waiter = {
        check() {
          if (texts) {
            const lines = [...s.view.since(seen), s.view.line]
            seen = s.view.total
            const line = lines.find((l) => texts.some((t) => l.includes(t)))
            if (line !== undefined) return end({ matched: true, timedOut: false, line })
          }
          if (s.status !== "running") end({ matched: false, timedOut: false })
        },
      }
      function end(result) {
        if (!s.waiters.delete(waiter)) return
        clearTimeout(timer)
        done({ session: summary(s), ...result })
      }
      s.waiters.add(waiter)
      request?.signal?.addEventListener("abort", () => end({ matched: false, timedOut: false }), { once: true })
      waiter.check()
    })
  }

  async function stop({ id } = {}, reason = "stopped") {
    const s = get(id)
    if (s.status !== "running") return { session: summary(s) }
    s.stopping = true
    s.reason = reason
    const signal = (sig) => s.group?.running && killGroup(s.group.pid, sig)
    signal("SIGTERM")
    const killer = setTimeout(() => signal("SIGKILL"), T.stopGraceMs)
    await s.done
    clearTimeout(killer)
    return { session: summary(s) }
  }

  function list({ tail } = {}) {
    const n = tail === undefined || tail === null || tail === "" ? T.tailLines : Math.max(0, Number(tail) || 0)
    const t = toolchains()
    return {
      sessions: [...sessions.values()].reverse().map((s) => summary(s, n)),
      policy: { programs: [...t.programs].sort(), toolchains: t.found, missing: t.missing, cache: t.cache, maxSessions: T.maxSessions, backgroundMinutes: backgroundMs / 60000, waitMaxSeconds: waitMax },
    }
  }

  function read({ id, lines } = {}) {
    const s = get(id)
    const n = Math.min(T.maxTailLines, Math.max(1, Number(lines) || T.tailLines))
    return { session: summary(s, 0), lines: s.view.tail(n) }
  }

  // SSE: one session (snapshot with its lines and raw text, then out / exit) or every session (snapshot, then start /
  // out / exit for each). Open until the tab goes or the desk stops.
  function stream(request, id = null) {
    const one = id ? get(id) : null
    return sseResponse(request, (send, close) => {
      const viewer = { id: one?.id ?? null, send, close }
      send(one ? { type: "snapshot", session: summary(one, 0), lines: one.view.tail(T.keepLines), raw: one.raw.slice(-T.keepChars) } : { type: "snapshot", sessions: [...sessions.values()].reverse().map((s) => summary(s)) })
      viewers.add(viewer)
      return () => viewers.delete(viewer)
    })
  }

  // The desk stops (a reload, the server exits): streams end, every session is stopped, the temp folder goes.
  async function close() {
    process.off("exit", atExit)
    if (closed) return
    closed = true
    for (const v of [...viewers]) v.close()
    await Promise.all(running().map((s) => stop({ id: s.id }, "the desk stopped")))
    if (tmp) removeTmp(tmp)
  }

  return { start, write, wait, stop, list, read, stream, close }
}

// The host routes (companion/server/host-api.js); term/stream is answered there, beside team/stream.
export const termRoutes = (term) => ({
  GET: {
    "term/list": (params) => term.list({ tail: params.get("tail") }),
    "term/read": (params) => term.read({ id: params.get("id"), lines: params.get("lines") }),
  },
  POST: {
    "term/start": (body) => term.start(body),
    "term/write": (body) => term.write(body),
    "term/wait": (body, request) => term.wait(body, request),
    "term/stop": (body) => term.stop({ id: body.id }),
  },
})
