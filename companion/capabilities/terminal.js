// The terminal a desk may give its agents (desk.js `terminal`), capability
// `term`: POST term/run { command, cwd?, timeout?, agent?, stream? } (stream:
// NDJSON start / out / result lines), GET term/log?limit=5, GET term/stream
// (SSE, Live follow): a snapshot of the runs in progress and the background
// processes, then {type: "start" | "out" | "end" | "proc" | "proc-out", …}.
//
// Background processes (a dev server the team checks later): POST term/start
// { command, cwd?, name?, port?, agent? }, GET term/ps, GET term/logs?id=&tail=,
// POST term/stop { id }. ONE program (no `&&`), the same programs, sandbox and
// environment (+ PORT when given); its own process group, so stop reaches its
// children. At most 4 run at once; each is stopped after policy.backgroundMinutes
// (default 120) and all of them when the server exits. Output: the last 40 000
// characters; URLs it prints (http://localhost:<port>, 127.0.0.1) are collected.
// Start and exit are rows (kind "proc") in state/terminal.jsonl.
//
//   const terminal = createTerminal({ root, policy: { programs, timeoutSeconds, backgroundMinutes?, path?, writable?, env?, toolchains? }, logPath })
//
// A command is one program with its arguments, or several joined by `&&`
// (run in order, stopping at the first failure); `cd <dir>` moves inside the
// workspace. No shell: pipes, redirects, `;`, `$(...)` and backticks are
// refused, and only the desk's programs run. Each program runs under macOS
// sandbox-exec: it may WRITE only in the workspace, the temp folders and uv's
// cache; it may not READ ~/.ssh, any .env file, or the custom/ desks other
// than this workspace. The environment is minimal (PATH, HOME, LANG, TMPDIR):
// none of ASKK's keys. Output (stdout and stderr, in order) is kept to its
// last 20 000 characters; every run is a row in the desk's state/terminal.jsonl
// (newest 200 rows), which the terminal artifact tails for every agent.

import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { isAbsolute, join, relative, resolve } from "node:path"
import { httpError } from "../shared/http.js"
import { appendJsonl, readJsonl } from "../shared/jsonl.js"
import { within } from "../shared/paths.js"
import { SSE_PING_MS, TERM_BACKGROUND_MINUTES, HOST_LIMITS } from "../shared/config.js"

const MAX_OUTPUT = HOST_LIMITS.terminal.outputChars // characters kept per run
const LOG_TAIL = HOST_LIMITS.terminal.logTailChars // characters of output per log row
const KEEP_ROWS = HOST_LIMITS.terminal.logKeepRows
const LIVE_KEEP = HOST_LIMITS.terminal.liveKeepChars // characters of a run in progress a new viewer gets
const PROC_KEEP = HOST_LIMITS.terminal.procKeepChars // characters of a background process's output kept
const MAX_PROCS = HOST_LIMITS.terminal.maxProcs // background processes running at once, per terminal
const KEEP_EXITED = HOST_LIMITS.terminal.keepExited // exited background processes still listed
const START_WAIT_MS = HOST_LIMITS.terminal.startWaitMs // term/start waits this long for the first output and URLs
const STOP_GRACE_MS = HOST_LIMITS.terminal.stopGraceMs // SIGTERM, then SIGKILL
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d+)?[^\s"'<>)\]]*/g
const HOME = homedir()
const APP = resolve(import.meta.dir, "..")

// "a 'b c' && d" → [["a", "b c"], ["d"]]; throws on shell syntax outside quotes.
export function splitCommand(text) {
  const steps = [[]]
  let word = null
  let quote = null
  const push = () => {
    if (word !== null) steps.at(-1).push(word)
    word = null
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === "\\" && quote === '"' && i + 1 < text.length) word += text[++i]
      else word += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      word ??= ""
    } else if (c === "&" && text[i + 1] === "&") {
      push()
      steps.push([])
      i++
    } else if (/\s/.test(c)) push()
    else if (/[|;<>`$(){}&]/.test(c)) throw new Error(`"${c}" is shell syntax; run one program at a time (\`&&\` chains them, cwd sets the folder).`)
    else if (c === "\\" && i + 1 < text.length) word = (word ?? "") + text[++i]
    else word = (word ?? "") + c
  }
  if (quote) throw new Error("Unclosed quote.")
  push()
  if (steps.some((s) => !s.length)) throw new Error("Empty command.")
  return steps
}

// Commands that destroy work are refused whatever the desk allows: agents have
// run them under explicit "do not" instructions (Replit, 2025). History-rewriting
// and working-tree-discarding git, and python one-liners that delete files.
const GIT_DESTROYS = [
  [/^reset$/, (a) => a.includes("--hard") || a.includes("--merge") || a.includes("--keep")],
  [/^clean$/, () => true],
  [/^rm$/, () => true],
  [/^restore$/, () => true],
  [/^checkout$/, (a) => a.includes("--") || a.includes(".") || a.includes("-f") || a.includes("--force")],
  [/^switch$/, (a) => a.includes("-f") || a.includes("--discard-changes") || a.includes("--force")],
  [/^push$/, (a) => a.some((x) => /^(-f|--force|--force-with-lease|--delete|-d|--mirror)/.test(x) || x.startsWith(":"))],
  [/^branch$/, (a) => a.some((x) => /^(-D|-d|--delete)$/.test(x))],
  [/^stash$/, (a) => ["drop", "clear"].includes(a[0])],
  [/^(filter-branch|filter-repo|update-ref|reflog|gc|prune)$/, () => true],
]
const PY_DELETES = /\b(rmtree|unlink|rmdir|remove|removedirs|truncate)\s*\(|open\([^)]*["'](w|w\+)["']/

export function refuseDestructive(argv) {
  const [program, ...args] = argv
  const name = String(program).split("/").pop()
  if (name === "git") {
    let at = 0 // skip global options, and the values of -C / -c / --git-dir / --work-tree
    while (at < args.length && args[at].startsWith("-")) at += ["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(args[at]) ? 2 : 1
    const sub = args[at]
    const rest = args.slice(at + 1)
    const rule = GIT_DESTROYS.find(([re]) => re.test(sub ?? ""))
    if (rule && rule[1](rest)) {
      throw httpError(403, `"${["git", sub, ...rest].join(" ")}" discards or deletes work and is refused. Existing code is never removed; commit instead, or report it as blocked for the owner.`)
    }
  }
  if (/^python3?(\.\d+)?$/.test(name) || name === "uv" || name === "uvx") {
    const i = args.indexOf("-c")
    if (i >= 0 && PY_DELETES.test(args[i + 1] ?? "")) {
      throw httpError(403, "A python -c one-liner that deletes or truncates files is refused. Existing code is never removed; report it as blocked for the owner.")
    }
  }
}

const escape = (path) => path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')

// An agent's file lane (agent.md `writes`, globs relative to the workspace)
// as sandbox regexes: inside the workspace it may write only there, so a
// terminal command cannot get around the lane fs.* enforces. "!glob" denies.
export function laneRegex(root, glob) {
  let g = String(glob).trim().replace(/^!/, "").replace(/^\.?\/+/, "")
  if (g.endsWith("/")) g += "**"
  let out = ""
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === "*" && g[i + 1] === "*") {
      const slash = g[i + 2] === "/"
      out += slash ? "(.*/)?" : ".*"
      i += slash ? 2 : 1
    } else if (c === "*") out += "[^/]*"
    else if (c === "?") out += "[^/]"
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  }
  const base = root.replace(/[.+^${}()|[\]\\*?]/g, "\\$&")
  return `^${base}/${out}$`
}

export function sandboxProfile(root, extra = [], lane = null) {
  const laned = Array.isArray(lane) && lane.length > 0
  const writable = [...new Set([...(laned ? [] : [root]), ...extra, "/private/tmp", "/private/var/folders", tmpdir(), join(HOME, ".cache"), join(HOME, ".local/share/uv"), join(HOME, ".local/bin")])]
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* ${writable.map((p) => `(subpath "${escape(p)}")`).join(" ")} (regex #"^/dev/"))`,
    ...(laned
      ? [
          ...lane.filter((g) => !String(g).trim().startsWith("!")).map((g) => `(allow file-write* (regex #"${laneRegex(root, g).replace(/"/g, "")}"))`),
          ...lane.filter((g) => String(g).trim().startsWith("!")).map((g) => `(deny file-write* (regex #"${laneRegex(root, g).replace(/"/g, "")}"))`),
        ]
      : []),
    // Contents only (file-read-data): path lookups and stat through custom/ must
    // still work, or SQLite and venv interpreters cannot open files in the workspace.
    `(deny file-read-data (subpath "${escape(join(HOME, ".ssh"))}") (subpath "${escape(join(APP, "custom"))}") (literal "${escape(join(APP, ".mcp.json"))}"))`,
    `(allow file-read-data (subpath "${escape(root)}"))`,
    `(deny file-read-data (regex #"/\\.env$") (regex #"/\\.env\\.[^/]*$"))`,
    `(allow file-read-data (regex #"/\\.env\\.example$"))`,
  ].join("\n")
}

// Every terminal's background processes, stopped when this server exits.
const everyProc = new Set() // { pid, running }
const killGroup = (pid, signal, { groupOnly = false } = {}) => {
  try {
    process.kill(-pid, signal) // its process group (spawned detached)
  } catch {
    if (groupOnly) return
    try {
      process.kill(pid, signal)
    } catch {}
  }
}
let exitHooked = false
function hookExit() {
  if (exitHooked) return
  exitHooked = true
  const killAll = () => {
    for (const p of everyProc) if (p.running) killGroup(p.pid, "SIGKILL")
  }
  process.on("exit", killAll)
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
    process.once(signal, () => {
      killAll()
      // Others (companion/team/team.js) exit themselves; alone, keep the default.
      if (process.listenerCount(signal) === 0) process.exit(code)
    })
  }
}

export function createTerminal({ root, policy, logPath }) {
  const realRoot = realpathSync(root)
  const programs = new Set(policy.programs)
  // PATH, caches and environment come from the desk's toolchains (capabilities/toolchains.js).
  const PATH = (policy.path ?? [join(HOME, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]).join(":")
  const env = { PYTHONUNBUFFERED: "1", UV_NO_PROGRESS: "1", ...policy.env, PATH, HOME, LANG: "en_US.UTF-8", TMPDIR: tmpdir(), TERM: "dumb", NO_COLOR: "1" }
  const profile = sandboxProfile(realRoot, policy.writable ?? [])

  const inside = (abs) => within(realRoot, abs)
  const folder = (from, path) => {
    const abs = resolve(from, path ?? ".")
    if (!existsSync(abs) || !statSync(abs).isDirectory()) throw httpError(400, `No folder ${relative(realRoot, abs) || "."} in the workspace.`)
    const real = realpathSync(abs)
    if (!inside(real)) throw httpError(403, "That folder is outside the workspace.")
    return real
  }

  function record(row) {
    if (!logPath) return
    appendJsonl(logPath, row)
    if (statSync(logPath).size > HOST_LIMITS.terminal.logMaxBytes) {
      const rows = readFileSync(logPath, "utf8").split("\n").filter(Boolean).slice(-KEEP_ROWS)
      writeFileSync(logPath, `${rows.join("\n")}\n`)
    }
  }

  // Runs in progress and the viewers following them (term/stream).
  const live = new Map() // id -> { id, agent, command, cwd, at, text }
  const viewers = new Set()
  let runs = 0
  const emit = (event) => viewers.forEach((send) => send(event))

  // A project wrapper (./mvnw, ./gradlew) is the desk's when listed, and runs from the step's folder (inside the workspace).
  const resolveProgram = (program, cwd) => {
    if (!programs.has(program)) throw httpError(403, `"${program}" is not one of this desk's programs: ${[...programs].join(", ")}.`)
    if (program.startsWith("./")) {
      const abs = resolve(cwd, program)
      if (!existsSync(abs) || !inside(realpathSync(abs))) throw httpError(400, `No ${program} in ${relative(realRoot, cwd) || "."}.`)
      return abs
    }
    const path = Bun.which(program, { PATH })
    if (!path) throw httpError(400, `"${program}" is not installed.`)
    return path
  }

  const profileFor = (lane) => (Array.isArray(lane) && lane.length ? sandboxProfile(realRoot, policy.writable ?? [], lane) : profile)

  async function runStep(argv, cwd, deadline, output, onText, signal, lane = null) {
    const [program, ...args] = argv
    refuseDestructive(argv)
    const path = resolveProgram(program, cwd)
    if (signal?.aborted) throw httpError(499, "Stopped.")
    // Its own process group (detached), so a timeout or a stop reaches what it
    // spawned too, and leftovers holding the pipes open are ended after it exits.
    const proc = Bun.spawn(["/usr/bin/sandbox-exec", "-p", profileFor(lane), path, ...args], { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: true })
    const pump = async (stream) => {
      const decoder = new TextDecoder()
      for await (const chunk of stream) {
        const piece = decoder.decode(chunk, { stream: true })
        output.text += piece
        onText(piece)
        if (output.text.length > MAX_OUTPUT * 2) {
          output.text = output.text.slice(-MAX_OUTPUT)
          output.cut = true
        }
      }
    }
    const timer = setTimeout(() => {
      output.timedOut = true
      killGroup(proc.pid, "SIGKILL")
    }, Math.max(1, deadline - Date.now()))
    // The caller went away (the agent was stopped): end the program too.
    const abort = () => {
      output.stopped = true
      killGroup(proc.pid, "SIGKILL")
    }
    signal?.addEventListener("abort", abort, { once: true })
    const pumped = Promise.all([pump(proc.stdout), pump(proc.stderr)])
    await proc.exited
    killGroup(proc.pid, "SIGKILL", { groupOnly: true }) // children it left running would hold the pipes open
    await pumped
    clearTimeout(timer)
    signal?.removeEventListener("abort", abort)
    return output.timedOut ? 124 : proc.exitCode
  }

  // A command's steps; 400 when it is empty or not one splitCommand takes.
  function parseCommand(command, example) {
    if (typeof command !== "string" || !command.trim()) throw httpError(400, `Expected {"command": "${example}"}.`)
    try {
      return splitCommand(command.trim())
    } catch (error) {
      throw Object.assign(error, { status: 400 })
    }
  }

  // hooks: { onStart(run), onText(text), signal } — the caller's own view of
  // this run (term/run with stream: true); viewers of term/stream get it anyway.
  async function run({ command, cwd = ".", timeout, agent = null, lane = null } = {}, { onStart, onText: onOwnText, signal } = {}) {
    const steps = parseCommand(command, "uv run pytest -q")
    if (isAbsolute(cwd)) cwd = relative(realRoot, cwd)
    const seconds = Math.min(policy.timeoutSeconds, Number(timeout) || policy.timeoutSeconds)
    const started = Date.now()
    const deadline = started + seconds * 1000
    const output = { text: "", cut: false, timedOut: false }
    const start = folder(realRoot, cwd)
    const id = `run-${Date.now().toString(36)}-${++runs}`
    const run = { id, agent, command, cwd: relative(realRoot, start) || ".", at: new Date(started).toISOString(), text: "" }
    live.set(id, run)
    emit({ type: "start", ...run })
    onStart?.({ id, command, cwd: run.cwd })
    const onText = (text) => {
      run.text = (run.text + text).slice(-LIVE_KEEP)
      emit({ type: "out", id, text })
      onOwnText?.(text)
    }
    let dir = start
    let exit = 0
    try {
      for (const argv of steps) {
        if (argv[0] === "cd") {
          dir = folder(dir, argv[1] ?? ".")
          continue
        }
        if (steps.length > 1) onText(`$ ${argv.join(" ")}\n`)
        exit = await runStep(argv, dir, deadline, output, onText, signal, lane)
        if (exit !== 0) break
      }
    } catch (error) {
      live.delete(id)
      emit({ type: "end", id, exit: null, error: error.message, ms: Date.now() - started })
      throw error
    }
    live.delete(id)
    emit({ type: "end", id, exit, ms: Date.now() - started, ...(output.timedOut ? { timedOut: true } : {}) })
    const text = output.text.length > MAX_OUTPUT ? output.text.slice(-MAX_OUTPUT) : output.text
    const result = {
      id,
      command,
      cwd: relative(realRoot, start) || ".",
      exit,
      ms: Date.now() - started,
      ...(output.timedOut ? { timedOut: `stopped after ${seconds} s` } : {}),
      ...(output.stopped ? { stopped: true } : {}),
      truncated: output.cut || output.text.length > MAX_OUTPUT,
      output: text,
    }
    record({ at: new Date().toISOString(), agent, cwd: result.cwd, command, exit, ms: result.ms, ...(result.timedOut ? { timedOut: result.timedOut } : {}), tail: text.slice(-LOG_TAIL) })
    return result
  }

  // The last term.run rows (background-process rows, kind "proc", left out).
  function log(limit = HOST_LIMITS.terminal.recentRuns) {
    if (!logPath || !existsSync(logPath)) return []
    return readJsonl(logPath)
      .filter((row) => row.kind !== "proc")
      .slice(-Math.min(HOST_LIMITS.terminal.recentRunsMax, Math.max(1, limit)))
  }

  // term/run with stream: true — NDJSON: start, out…, then result (or error).
  function runStream(body, request) {
    const encoder = new TextEncoder()
    const controllerAbort = new AbortController()
    request?.signal?.addEventListener("abort", () => controllerAbort.abort(), { once: true })
    let closed = false
    const out = new ReadableStream({
      async start(controller) {
        const line = (event) => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
          } catch {
            closed = true
          }
        }
        try {
          const result = await run(body, {
            signal: controllerAbort.signal,
            onStart: (info) => line({ type: "start", ...info }),
            onText: (text) => line({ type: "out", text }),
          })
          line({ type: "result", ...result })
        } catch (error) {
          line({ type: "error", error: error.message, status: error.status ?? 500 })
        }
        closed = true
        try {
          controller.close()
        } catch {}
      },
      cancel() {
        closed = true
        controllerAbort.abort()
      },
    })
    return new Response(out, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } })
  }

  // ── background processes ────────────────────────────────────────────────

  const backgroundMs = Math.max(1, Number(policy.backgroundMinutes) || TERM_BACKGROUND_MINUTES) * 60000
  const procs = new Map() // id -> proc record
  let procCount = 0

  const summary = (p) => ({
    id: p.id,
    name: p.name,
    command: p.command,
    cwd: p.cwd,
    agent: p.agent,
    pid: p.pid,
    port: p.port,
    startedAt: p.startedAt,
    status: p.status,
    exit: p.exit,
    ...(p.endedAt ? { endedAt: p.endedAt } : {}),
    ...(p.reason ? { reason: p.reason } : {}),
    urls: [...p.urls],
  })
  const running = () => [...procs.values()].filter((p) => p.status === "running")
  const getProc = (id) => {
    const p = procs.get(id)
    if (!p) throw httpError(404, `No background process "${id}" (term.ps lists them).`)
    return p
  }

  async function start({ command, cwd = ".", name, port, agent = null, lane = null } = {}, { wait = START_WAIT_MS } = {}) {
    const steps = parseCommand(command, "uv run uvicorn app:app --port 8000")
    if (isAbsolute(cwd)) cwd = relative(realRoot, cwd)
    if (steps.length > 1) throw httpError(400, "term.start runs ONE program (no `&&`); set cwd for its folder, run setup steps with term.run first.")
    const [argv] = steps
    if (argv[0] === "cd") throw httpError(400, "Use cwd to choose the folder.")
    if (port !== undefined && port !== null) {
      port = Number(port)
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw httpError(400, "port must be an integer from 1024 to 65535.")
    } else port = null
    if (running().length >= MAX_PROCS) throw httpError(429, `${MAX_PROCS} background processes are already running; stop one first (term.ps, term.stop).`)
    refuseDestructive(argv)
    const dir = folder(realRoot, cwd)
    const path = resolveProgram(argv[0], dir)
    const id = `proc-${Date.now().toString(36)}-${++procCount}`
    const p = {
      id,
      name: String(name ?? "").trim().slice(0, HOST_LIMITS.terminal.procNameChars) || `${argv[0]}${port ? `:${port}` : ""}`,
      command,
      cwd: relative(realRoot, dir) || ".",
      agent,
      pid: null,
      port,
      startedAt: new Date().toISOString(),
      status: "running",
      exit: null,
      endedAt: null,
      reason: null,
      urls: new Set(),
      text: "",
      scanned: "",
      running: true,
    }
    const proc = Bun.spawn(["/usr/bin/sandbox-exec", "-p", profileFor(lane), path, ...argv.slice(1)], {
      cwd: dir,
      env: port ? { ...env, PORT: String(port) } : env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      detached: true, // its own process group: stop reaches what it spawns (uv run → python)
    })
    p.pid = proc.pid
    p.proc = proc
    hookExit()
    everyProc.add(p)
    procs.set(id, p)
    // Exited ones beyond KEEP_EXITED are forgotten, oldest first.
    const exited = [...procs.values()].filter((x) => x.status !== "running")
    for (const old of exited.slice(0, Math.max(0, exited.length - KEEP_EXITED))) procs.delete(old.id)

    const onText = (text) => {
      p.text = (p.text + text).slice(-PROC_KEEP)
      // URLs may straddle chunks: scan the new text with a little of the old.
      const scan = p.scanned.slice(-HOST_LIMITS.terminal.urlScanChars) + text
      p.scanned = scan
      const known = p.urls.size
      for (const match of scan.matchAll(URL_RE)) p.urls.add(match[0].replace(/[.,;:]+$/, "").replace("0.0.0.0", "127.0.0.1").replace("[::]", "localhost"))
      emit({ type: "proc-out", id, text })
      if (p.urls.size > known) emit({ type: "proc", ...summary(p) }) // a URL printed after the start
    }
    const pump = async (stream) => {
      const decoder = new TextDecoder()
      try {
        for await (const chunk of stream) onText(decoder.decode(chunk, { stream: true }))
      } catch {}
    }
    p.limit = setTimeout(() => stop({ id }, `stopped after ${Math.round(backgroundMs / 60000)} min (the desk's limit)`), backgroundMs)
    p.limit.unref?.()
    p.done = Promise.all([pump(proc.stdout), pump(proc.stderr), proc.exited]).then(() => {
      clearTimeout(p.limit)
      p.running = false
      p.status = "exited"
      p.exit = proc.exitCode ?? (proc.signalCode ? `signal ${proc.signalCode}` : null)
      p.endedAt = new Date().toISOString()
      everyProc.delete(p)
      killGroup(p.pid, "SIGKILL", { groupOnly: true }) // anything it left behind in its group
      emit({ type: "proc", ...summary(p) })
      record({ at: p.endedAt, kind: "proc", event: "exit", id, agent, name: p.name, cwd: p.cwd, command, pid: p.pid, exit: p.exit, ...(p.reason ? { reason: p.reason } : {}), ms: Date.parse(p.endedAt) - Date.parse(p.startedAt), tail: p.text.slice(-LOG_TAIL) })
    })
    emit({ type: "proc", ...summary(p) })
    record({ at: p.startedAt, kind: "proc", event: "start", id, agent, name: p.name, cwd: p.cwd, command, pid: p.pid, ...(port ? { port } : {}) })

    // The first output and URLs: wait a little (less if it exits or prints a URL).
    const until = Date.now() + Math.max(0, Math.min(HOST_LIMITS.terminal.startWaitMaxMs, wait))
    while (Date.now() < until && p.status === "running" && !p.urls.size) await Bun.sleep(100)
    if (p.urls.size && p.status === "running") await Bun.sleep(200)
    return { ...summary(p), output: p.text.split("\n").slice(0, HOST_LIMITS.terminal.startOutputLines).join("\n").slice(0, HOST_LIMITS.terminal.startOutputChars) }
  }

  function ps() {
    return [...procs.values()].map(summary)
  }

  // tail: lines from the end (default 50, max 1000); the kept output is 40 000 characters.
  function logs({ id, tail = HOST_LIMITS.terminal.logsTailLines } = {}) {
    const p = getProc(id)
    const lines = Math.min(HOST_LIMITS.terminal.logsTailMaxLines, Math.max(1, Number(tail) || HOST_LIMITS.terminal.logsTailLines))
    return { ...summary(p), output: p.text.split("\n").slice(-lines - 1).join("\n") }
  }

  async function stop({ id } = {}, reason = "stopped") {
    const p = getProc(id)
    if (p.status !== "running") return summary(p)
    p.reason = reason
    killGroup(p.pid, "SIGTERM")
    const killer = setTimeout(() => killGroup(p.pid, "SIGKILL"), STOP_GRACE_MS)
    await p.done
    clearTimeout(killer)
    return summary(p)
  }

  // SSE: the runs in progress (their output so far), then every start / out / end.
  function stream(request) {
    const encoder = new TextEncoder()
    let send = null
    let ping = null
    const stop = () => {
      viewers.delete(send)
      clearInterval(ping)
    }
    const body = new ReadableStream({
      start(controller) {
        send = (event) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          } catch {
            stop()
          }
        }
        send({ type: "snapshot", runs: [...live.values()], recent: log(HOST_LIMITS.terminal.recentRuns), procs: [...procs.values()].map((p) => ({ ...summary(p), text: p.text.slice(-LIVE_KEEP) })) })
        viewers.add(send)
        ping = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"))
          } catch {
            stop()
          }
        }, SSE_PING_MS)
        request.signal?.addEventListener("abort", () => {
          stop()
          try {
            controller.close()
          } catch {}
        })
      },
      cancel: stop,
    })
    return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } })
  }

  return {
    run,
    runStream,
    log,
    stream,
    start,
    ps,
    logs,
    stop,
    policy: { programs: [...programs], toolchains: policy.toolchains ?? null, timeoutSeconds: policy.timeoutSeconds, backgroundMinutes: backgroundMs / 60000, maxProcesses: MAX_PROCS },
  }
}

// The host routes (companion/server/host-api.js); term/stream is wired there.
export const terminalRoutes = (terminal) => ({
  GET: {
    "term/log": (params) => ({ policy: terminal.policy, entries: terminal.log(Number(params.get("limit")) || HOST_LIMITS.terminal.recentRuns), procs: terminal.ps() }),
    "term/ps": () => ({ procs: terminal.ps() }),
    "term/logs": (params) => terminal.logs({ id: params.get("id"), tail: params.get("tail") }),
  },
  POST: {
    "term/run": (body, request) => (body.stream ? terminal.runStream(body, request) : terminal.run(body)),
    "term/start": (body) => terminal.start(body),
    "term/stop": (body) => terminal.stop({ id: body.id }),
  },
})
