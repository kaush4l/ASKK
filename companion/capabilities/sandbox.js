// What a desk's programs may do (capability `term`, companion/capabilities/terminal.js): the command line they come
// from (no shell), the work they may never destroy, and the macOS sandbox-exec profile they run under.
// 2026-10-17: the generic parts of a desk's own terminal tool, moved to the host so every desk's terminal
// sessions share them.
//
//   splitCommand("a 'b c' && d")      [["a", "b c"], ["d"]]; throws on pipes, redirects, `;`, `$(…)`, backticks
//   refuseDestructive(argv)           throws 403 for history-rewriting git, deleting find, deleting python -c
//   sandboxProfile(root, extra, lane, { readable, listable, never, hidden, tmp, blockPorts })   the SBPL text
//   privateTmp() / removeTmp(path)    the temp folder programs get as TMPDIR (never the shared /tmp)
//   killGroup(pid, signal)            a program's whole process group (spawned detached)
//   trackGroup(entry) / untrackGroup(entry)   groups SIGKILLed when this process exits ({ pid, running })
//   groupBook(path)                   the running groups on disk: { add, remove, reap } — reap() SIGKILLs the ones a
//                                     crashed server left running (terminal.js: <desk state>/terminal.running.json)
//   processInfo(pids)                 Map pid → { pgid, started } of the live ones (ps; started = its lstart)

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { httpError } from "../shared/http.js"
import { memoryRoot } from "../shared/paths.js"
import { attempt } from "../shared/safe.js"

const HOME = homedir()
export const APP = resolve(import.meta.dir, "../..") // the repo root (its custom/ holds every desk's code and state)

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
  if (name === "find" && args.some((a) => a === "-delete" || ((a === "-exec" || a === "-execdir" || a === "-ok") && /(^|\/)(rm|rmdir|unlink|shred)$/.test(args[args.indexOf(a) + 1] ?? "")))) {
    throw httpError(403, "find that deletes files is refused. Existing code is never removed; report it as blocked for the owner.")
  }
  if (/^python3?(\.\d+)?$/.test(name) || name === "uv" || name === "uvx") {
    const i = args.indexOf("-c")
    if (i >= 0 && PY_DELETES.test(args[i + 1] ?? "")) {
      throw httpError(403, "A python -c one-liner that deletes or truncates files is refused. Existing code is never removed; report it as blocked for the owner.")
    }
  }
}

const escape = (path) => path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')

// A write lane glob (an agent's `writes`, relative to `base`) as a sandbox regex on the real path. "!glob" denies.
export function laneRegex(base, glob) {
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
  const root = base.replace(/[.+^${}()|[\]\\*?]/g, "\\$&")
  return `^${root}/${out}$`
}

// The temp folder sandboxed programs write, as the sandbox sees it (/var → /private/var): the user's own (macOS
// /var/folders/…/T); when TMPDIR is unset and the temp folder is the shared /tmp, a private folder made under it, so
// /tmp as a whole is never writable. A folder made here is removed by removeTmp when its owner closes, and whatever
// is left when this process exits.
const SHARED_TMP = new Set(["/tmp", "/private/tmp", "/var/tmp", "/private/var/tmp"])
const madeTmp = new Set() // folders privateTmp made: the only ones removeTmp deletes
const removeLeftTmp = () => {
  for (const path of madeTmp) rmSync(path, { recursive: true, force: true })
  madeTmp.clear()
}
export function privateTmp(base = tmpdir()) {
  const real = attempt(() => realpathSync(base)) ?? resolve(base)
  if (!SHARED_TMP.has(real.replace(/\/+$/, ""))) return real // the user's own temp folder: never made, never removed
  const made = realpathSync(mkdtempSync(join(real, "askk-sandbox-")))
  if (!madeTmp.size) process.on("exit", removeLeftTmp)
  madeTmp.add(made)
  return made
}
// Removes a folder privateTmp made (with what programs left in it); any other path is left alone → false.
export function removeTmp(path) {
  if (!madeTmp.delete(path)) return false
  rmSync(path, { recursive: true, force: true })
  if (!madeTmp.size) process.off("exit", removeLeftTmp)
  return true
}

// Never written by a sandboxed program, whatever else allows it (SBPL: the later rule wins): the folders toolchains
// install binaries and shims into (one left there runs later, outside the sandbox — ~/.bun/bin/bun is the binary
// launchd runs), and the config other programs read at their start. Every folder on the program's PATH is added.
export const NEVER_WRITE = [
  ".bun/bin", ".bun/install/global", ".local/bin", ".cargo/bin", ".deno/bin", "Library/pnpm/bin", "Library/pnpm/global",
  ".local/share/uv/tools", ".local/share/uv/credentials", ".cargo/config.toml", ".cargo/credentials.toml",
  ".gradle/init.d", ".gradle/init.gradle", ".gradle/init.gradle.kts", ".gradle/gradle.properties", ".m2/settings.xml", ".npmrc",
].map((p) => join(HOME, p))

// A repository's config and hooks, in any folder (SBPL regexes on real paths): what git reads to run a program of its
// own (core.fsmonitor, core.hooksPath, a hook) — never written by a sandboxed program, whatever its lane.
// 2026-10-17 (critic: config and hooks alone were not enough — a lane writing .git/commondir moved git's config and
// hooks to a folder of its own; a projects/** lane renamed .git away, rewrote its config and renamed it back; a folder
// renamed into .git/modules/<name> carried a submodule's config and hooks with it): also every place git finds them
// from — the .git entry itself (made, renamed, removed, or a "gitdir:" file in its place: git init and clone are
// host-side), commondir, and the git folders of submodules (modules/) and linked worktrees (worktrees/). The sandbox
// matches these case-insensitively on a case-insensitive volume (.GIT is .git). Commits write objects, the index, refs
// and logs as before; a hard link to a denied file is refused too (macOS checks the link's source).
export const GIT_NEVER_WRITE = [
  "/\\.git$",
  "/\\.git/config(\\.[^/]*)?$", // config, config.lock, config.worktree(.lock)
  "/\\.git/commondir$",
  "/\\.git/(hooks|modules|worktrees)$",
  "/\\.git/(hooks|modules|worktrees)/",
]

// root: the workspace; extra: more writable folders (toolchain caches, mounted desks the caller may write); lane: the
// caller's write globs under root — null: all of root is writable (the owner's own sessions); an array (even empty):
// only what it names (2026-10-17: [] means none of the workspace, so an agent without `writes:` writes nothing there).
// Options — readable: folders inside a hidden one a program may read (mounted desks); listable: folders whose own
// entry (not their contents) may be read; never: more folders never written (the PATH's); hidden: more folders whose
// contents are never read, beside the repo's custom/ (every desk's code and state) — the workspace and `readable`
// excepted; tmp: the temp folder (privateTmp()); blockPorts: ports on any host a program never connects to (the desk
// server's: its host API would write any desk's files whatever the lane — a Host or Origin header is easy to forge);
// allowWrites / denyWrites: more write rules as regexes on real paths (a lane's globs on a mounted desk, laneRegex).
// ASKK's own configuration (.env*, .mcp.json) is never written, and never read (.env.example excepted).
// 2026-10-26 owner (portability, docs/portability.md): the OS sandbox terminal programs run under, detected once per
// host. `sandbox-exec` on macOS (the profile above enforces the lane); `container` only when ASKK_SANDBOX=container AND
// this process runs inside a container (/.dockerenv, /run/.containerenv) — the container is the sandbox, so the lane is
// not enforced on what a program writes (the desk's files artifact still keeps it); else null with the reason, and the
// host leaves out capability `term` (term/* answer 501 with it). ASKK_SANDBOX=off turns the terminal off anywhere.
//   sandboxRunner() → { kind: "sandbox-exec" | "container", wrap(profile, argv) → argv } | { kind: null, reason }
export const SANDBOX_EXEC = "/usr/bin/sandbox-exec"
const CONTAINER_MARKS = ["/.dockerenv", "/run/.containerenv"]
export function sandboxRunner({ env = process.env, platform = process.platform, exists = existsSync } = {}) {
  const want = String(env.ASKK_SANDBOX ?? "").trim().toLowerCase()
  const macos = platform === "darwin" && exists(SANDBOX_EXEC)
  const contained = CONTAINER_MARKS.some((p) => exists(p))
  if (want === "off") return { kind: null, reason: "the terminal is off on this server (ASKK_SANDBOX=off)." }
  if (want === "container") {
    if (contained) return { kind: "container", wrap: (_profile, argv) => argv }
    return { kind: null, reason: "ASKK_SANDBOX=container, but this server does not run inside a container (no /.dockerenv or /run/.containerenv): terminal programs would run unsandboxed on the host." }
  }
  if (want && want !== "sandbox-exec") return { kind: null, reason: `ASKK_SANDBOX=${want} is not a sandbox: sandbox-exec (macOS), container (inside one) or off.` }
  if (macos) return { kind: "sandbox-exec", wrap: (profile, argv) => [SANDBOX_EXEC, "-p", profile, ...argv] }
  return {
    kind: null,
    reason: `no sandbox for terminal programs on ${platform}: macOS sandbox-exec${contained ? ", or ASKK_SANDBOX=container (this server runs in a container)" : ", or run ASKK in a container with ASKK_SANDBOX=container"}.`,
  }
}

let defaultTmp = null
export function sandboxProfile(root, extra = [], lane = null, { readable = [], listable = [], never = [], hidden = [], tmp = (defaultTmp ??= privateTmp()), blockPorts = [], allowWrites = [], denyWrites = [] } = {}) {
  const laned = Array.isArray(lane)
  const globs = laned ? lane.map((g) => String(g).trim()).filter(Boolean) : []
  const writable = [...new Set([...(laned ? [] : [root]), ...extra, tmp])]
  const ports = [...new Set(blockPorts.map(Number))].filter((n) => Number.isInteger(n) && n > 0 && n < 65536)
  // A folder that holds the workspace or a writable folder is never denied whole (a PATH entry like ~ would be).
  const ancestor = (d) => [root, ...writable].some((w) => w === d || w.startsWith(d.endsWith("/") ? d : `${d}/`))
  const denied = [...new Set([...NEVER_WRITE, ...never])].filter((d) => typeof d === "string" && isAbsolute(d) && d !== "/" && !ancestor(d))
  const regex = (g) => laneRegex(root, g).replace(/"/g, "")
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* ${writable.map((p) => `(subpath "${escape(p)}")`).join(" ")} (regex #"^/dev/"))`,
    ...globs.filter((g) => !g.startsWith("!")).map((g) => `(allow file-write* (regex #"${regex(g)}"))`),
    ...allowWrites.map((r) => `(allow file-write* (regex #"${String(r).replace(/"/g, "")}"))`),
    ...globs.filter((g) => g.startsWith("!")).map((g) => `(deny file-write* (regex #"${regex(g)}"))`),
    ...denyWrites.map((r) => `(deny file-write* (regex #"${String(r).replace(/"/g, "")}"))`),
    ...(denied.length ? [`(deny file-write* ${denied.map((p) => `(subpath "${escape(p)}")`).join(" ")})`] : []),
    `(deny file-write* (regex #"/\\.env$") (regex #"/\\.env\\.[^/]*$") (regex #"/\\.mcp\\.json$"))`,
    // 2026-10-17 (critic: a lane holding projects/*/.git/** put a core.fsmonitor command in .git/config, or a hook in
    // .git/hooks, and the next `git status` / `git commit` of an agent with a wider lane ran it under that lane): no
    // sandboxed program, in any lane, writes a repository's config (its lock, its worktree config) or its hooks folder or
    // anything in it, nor the .git entry, commondir, modules/ or worktrees/ that would point git elsewhere
    // (GIT_NEVER_WRITE). Commits still write objects, the index and refs; a new repository is made host-side, outside
    // the sandbox (the dev desk's project.init runs git init).
    ...GIT_NEVER_WRITE.map((r) => `(deny file-write* (regex #"${r}"))`),
    // 2026-10-17 (live run: every `uv run` failed "Failed to initialize cache … uv/sdists-v9/.git: Operation not
    // permitted"): a toolchain cache (extra) or the temp folder may hold a plain .git FILE — uv's marker that keeps git
    // out of its cache buckets. Only that entry: a cache's .git/config, hooks or commondir stay denied, and nobody runs
    // git in a cache.
    ...[...extra, tmp].filter(Boolean).map((p) => `(allow file-write* (regex #"${laneRegex(p, "**/.git").replace(/"/g, "")}"))`),
    // Contents only (file-read-data): path lookups and stat through custom/ must
    // still work, or SQLite and venv interpreters cannot open files in the workspace. memory/ (every desk's memory,
    // 2026-10-17: moved out of custom/) stays unread like custom/: a desk's tools read it, never its programs.
    `(deny file-read-data (subpath "${escape(join(HOME, ".ssh"))}") ${[...new Set([join(APP, "custom"), memoryRoot(), ...hidden])].map((p) => `(subpath "${escape(p)}")`).join(" ")} (literal "${escape(join(APP, ".mcp.json"))}"))`,
    `(allow file-read-data (subpath "${escape(root)}"))`,
    ...readable.map((p) => `(allow file-read-data (subpath "${escape(p)}"))`),
    ...listable.map((p) => `(allow file-read-data (literal "${escape(p)}"))`),
    `(deny file-read-data (regex #"/\\.env$") (regex #"/\\.env\\.[^/]*$") (regex #"/\\.mcp\\.json$"))`,
    `(allow file-read-data (regex #"/\\.env\\.example$"))`,
    ...ports.map((n) => `(deny network-outbound (remote ip "*:${n}"))`),
  ].join("\n")
}

// A process group (spawned detached: the program is its leader), else the process alone.
export const killGroup = (pid, signal, { groupOnly = false } = {}) => {
  if (!pid) return
  try {
    process.kill(-pid, signal) // its process group (spawned detached)
  } catch {
    if (!groupOnly) attempt(() => process.kill(pid, signal))
  }
}

// Every running program group, SIGKILLed when this server exits (a desk's sessions never outlive it).
const everyGroup = new Set() // { pid, running }
let exitHooked = false
function hookExit() {
  if (exitHooked) return
  exitHooked = true
  const killAll = () => {
    for (const g of everyGroup) if (g.running) killGroup(g.pid, "SIGKILL")
  }
  process.on("exit", killAll)
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
    process.once(signal, () => {
      killAll()
      // Others (the dev server, the companion) exit themselves; alone, keep the default.
      if (process.listenerCount(signal) === 0) process.exit(code)
    })
  }
}
export function trackGroup(entry) {
  hookExit()
  everyGroup.add(entry)
}
export const untrackGroup = (entry) => everyGroup.delete(entry)

// pid → { pgid, started } for the pids still alive (one ps call; started: ps lstart, to the second, in the C locale).
const PS_ENV = { LC_ALL: "C", PATH: "/bin:/usr/bin" }
export function processInfo(pids) {
  const list = [...new Set(pids.map(Number))].filter((n) => Number.isInteger(n) && n > 0)
  const found = new Map()
  if (!list.length) return found
  const text = attempt(() => Bun.spawnSync(["/bin/ps", "-o", "pid=,pgid=,lstart=", "-p", list.join(",")], { env: PS_ENV, stderr: "ignore" }).stdout.toString())
  if (text === null) return found
  for (const line of text.split("\n")) {
    const [pid, pgid, ...start] = line.trim().split(/\s+/)
    if (start.length >= 5) found.set(Number(pid), { pgid: Number(pgid), started: start.join(" ") })
  }
  return found
}
let me = null // this server: { pid, started }
const self = () => (me ??= { pid: process.pid, started: processInfo([process.pid]).get(process.pid)?.started ?? null })

// 2026-10-17: a session outlives a crash of its server (SIGKILL, a panic: no exit hook runs) — a training run keeps
// the GPU and its ports, a dev server its port. Each running group is booked on disk with the server that started it;
// the desk's next createTerm reaps the book: a group whose server is gone and whose leader is still the process booked
// (same pid, still its group's leader, the same start time — a pid used again by another program starts later) is
// SIGKILLed. Groups of a server still running (this one, or another hosting the same desk) stay booked.
//   const book = groupBook(path)   book.add({ pid, …note }) → the entry | null (already gone)   book.remove(pid)
//   book.reap() → [entries SIGKILLed]
// log: a book that does not read (set aside, its groups named) or a write that fails — said, never silent (2026-10-23)
export function groupBook(path, log = () => {}) {
  let writeWarned = false
  const read = () => {
    try {
      const rows = JSON.parse(readFileSync(path, "utf8"))
      return Array.isArray(rows) ? rows.filter((r) => r && Number.isInteger(r.pid) && r.pid > 0) : []
    } catch (error) {
      if (error.code !== "ENOENT") {
        const to = `${path}.unreadable-${Date.now()}`
        attempt(() => renameSync(path, to))
        log(`term: the book of running process groups did not read (${error.message}) — kept as ${to}; groups booked before a crash are not reaped, look there`)
      }
      return []
    }
  }
  const write = (rows) => {
    try {
      if (!rows.length) return rmSync(path, { force: true })
      mkdirSync(dirname(path), { recursive: true })
      const temp = `${path}.${process.pid}.tmp`
      writeFileSync(temp, `${JSON.stringify(rows, null, 1)}\n`)
      renameSync(temp, path)
      writeWarned = false
    } catch (error) {
      if (!writeWarned) log(`term: the book of running process groups was not written (${error.message}) — after a crash these groups would not be reaped`)
      writeWarned = true
    }
  }
  return {
    add({ pid, ...note }) {
      const info = processInfo([pid]).get(pid)
      if (!info) return null
      const entry = { pid, pgid: info.pgid, started: info.started, ...note, server: self(), at: new Date().toISOString() }
      write([...read().filter((r) => r.pid !== pid), entry])
      return entry
    },
    remove(pid) {
      const rows = read()
      const left = rows.filter((r) => r.pid !== pid)
      if (left.length !== rows.length) write(left)
    },
    reap() {
      const rows = read()
      if (!rows.length) return []
      const live = processInfo([...rows.map((r) => r.pid), ...rows.map((r) => r.server?.pid)])
      const kept = []
      const killed = []
      for (const r of rows) {
        const server = r.server && live.get(r.server.pid)
        if (server && r.server.started && server.started === r.server.started) {
          kept.push(r) // its server still runs: not an orphan
          continue
        }
        const now = live.get(r.pid)
        if (!now || r.pid === process.pid || now.started !== r.started || now.pgid !== r.pgid) continue // gone, or another program's pid now
        if (r.pgid === r.pid) killGroup(r.pid, "SIGKILL")
        else attempt(() => process.kill(r.pid, "SIGKILL")) // not its group's leader: the process alone, never a group it joined
        killed.push(r)
      }
      write(kept)
      return killed
    },
  }
}
