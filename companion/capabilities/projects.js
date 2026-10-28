// Projects outside ASKK a desk works on (2026-10-17 owner: "I can load a new project location and the agent can work on
// the project"). A desk opts in with main.js `projects` — true, or {name: path} loaded at start (paths relative to the
// desk folder) — and the owner loads more at run time (host API POST projects/load), kept in the desk's memory folder
// (memory/<desk>/projects.json, plain JSON the owner may edit: {"projects": {"<name>": {"path": "/abs", "at": iso}}}).
// Each loaded project is mounted in the desk's workspace as projects/<name>/ (files.js, terminal.js): read, written and
// run in like one of the desk's own projects, its lanes and sandbox included.
//
// On load (and for every configured one at start) the project gets an .agents/ folder that ignores itself
// (.agents/.gitignore: "*"): what the agents set up for the project — their notes (.agents/project.md), how to run its
// live preview (.agents/preview.json), the data their live artifacts read — never lands in the project's git, and the
// project's own files (.gitignore included) are untouched.
//
//   const registry = projectRegistry({ file, seed, base, local, askkRoot, home })
//   registry.list() → [{name, path, source: "config" | "owner", at, missing, setup}]   setup: .agents/project.md exists
//   registry.folder(name) → the real folder | null
//   registry.load({path, name?}) → {entry, created}   (the same folder again → that entry, created false)
//   registry.unload(name) → true | throws (a configured one is main.js's)
//   registry.init(name) → {name, path, branch, created, setup} — a configured worktree made ready (below)
//
// A configured project may be a git worktree of another repository (2026-10-25 owner: "the artifact will initialize the
// current project to allow the dev desk to make changes"): main.js `projects: {<name>: {path, worktree: <repo>, branch,
// setup: [argv]}}` (paths relative to the desk folder). init(name) — the dev artifact's dev.init through the host's
// POST projects/init — makes the folder with `git worktree add` (the branch made when missing) and runs `setup` there
// once (bun install), both on the host from main.js's own words: an agent names only the project.
// 2026-10-25 owner ("configure dev desk … on the same project folder … the application is already live running"):
// `{path, self: true}` is ASKK itself — the repository the live server runs — main.js's word only (never the owner's
// load, never an agent's): the path must be ASKK's root exactly, never a folder inside it or holding it.
//   checkProjectPath(path, {askkRoot, home}) → the real folder, or throws why not

import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync, renameSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { within } from "../shared/paths.js"
import { attempt } from "../shared/safe.js"

export const PROJECT_NAME = /^[a-z][a-z0-9-]{1,40}$/ // a loaded project's name: its folder under projects/
export const AGENTS_DIR = ".agents"
export const AGENTS_IGNORE = "# The agents' files for this project (ASKK): never committed.\n*\n"
// System folders a project never is or sits in: the agents would write where the machine keeps itself.
export const SYSTEM = ["/System", "/usr", "/bin", "/sbin", "/etc", "/private", "/var", "/dev", "/cores", "/Library", "/Applications", "/opt/homebrew", "/nix"]

export class ProjectError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
const refuse = (message, status = 400) => {
  throw new ProjectError(status, message)
}

// "~/code/app" → "/Users/me/code/app".
const expand = (path, home) => (path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : path)
const realOr = (p) => attempt(() => realpathSync(p)) ?? resolve(p)

// The real folder a project path names, or throws why it cannot be one: an existing folder (absolute, or ~/…), never
// the root, the home folder or a folder holding it, a system folder, a dot folder in the home (~/.ssh, ~/.config …),
// ~/Library, ASKK itself or a folder inside it or holding it (ASKK's own projects live in a desk's data/projects/).
// system: the system folders (a test passes its own: a temp folder is under /private).
export function checkProjectPath(path, { askkRoot = process.cwd(), home = homedir(), system = SYSTEM } = {}) {
  const raw = typeof path === "string" ? path.trim() : ""
  if (!raw) refuse("path: the project's folder, e.g. ~/code/my-app.")
  const full = expand(raw, home)
  if (!isAbsolute(full)) refuse(`path: ${raw} is relative; give the full folder (/Users/…/my-app or ~/my-app).`)
  const real = attempt(() => realpathSync(resolve(full))) ?? refuse(`No folder at ${raw}.`, 404)
  if (!statSync(real).isDirectory()) refuse(`${raw} is a file, not a folder.`)
  const realHome = realOr(home)
  const askk = realOr(askkRoot)
  if (real === sep || within(real, realHome)) refuse(`${real} holds your home folder; load the project's own folder.`, 403)
  for (const s of system) if (within(realOr(s), real) || within(s, real)) refuse(`${real} is a system folder.`, 403)
  if (within(realHome, real)) {
    const first = relative(realHome, real).split(sep)[0]
    if (first.startsWith(".") || first === "Library") refuse(`${real} is in ~/${first}, where your machine and apps keep their settings.`, 403)
  }
  if (within(askk, real) || within(real, askk)) refuse(`${real} is ASKK itself (or holds it); a desk's own projects are made in its data/projects/.`, 403)
  return real
}

// A name for a folder: its base name in lower case, dashes for anything else ("My App 2" → "my-app-2").
export function projectName(folder) {
  let name = basename(folder).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  if (!/^[a-z]/.test(name)) name = `p-${name}`
  name = name.slice(0, 41).replace(/-+$/, "")
  return PROJECT_NAME.test(name) ? name : "project"
}

// The project's .agents/ folder, made when missing, with its own .gitignore ("*": it ignores itself and all it holds).
// An existing .gitignore there is the owner's and is kept.
export function prepareAgents(real) {
  const dir = join(real, AGENTS_DIR)
  const fresh = !existsSync(dir)
  mkdirSync(dir, { recursive: true })
  const ignore = join(dir, ".gitignore")
  if (!existsSync(ignore)) writeFileSync(ignore, AGENTS_IGNORE)
  return { dir, fresh }
}

// file: the registry (memory/<desk>/projects.json), null for config only; seed: main.js `projects` ({name: path},
// relative to `base`); local(name) → true when the desk's workspace has its own projects/<name> (a name taken).
export function projectRegistry({ file = null, seed = null, base = process.cwd(), local = () => false, askkRoot = process.cwd(), home = homedir(), system = SYSTEM, clock = () => new Date(), log = () => {}, spawn = Bun.spawnSync } = {}) {
  const check = (path) => checkProjectPath(path, { askkRoot, home, system })
  const checkSelf = (path) => {
    const real = attempt(() => realpathSync(path)) ?? refuse(`No folder at ${path}.`, 404)
    if (real !== realOr(askkRoot)) refuse(`${real}: self: true is ASKK's own folder (${realOr(askkRoot)}), nothing else.`, 403)
    return real
  }
  const full = (path) => {
    const given = expand(String(path), home)
    return isAbsolute(given) ? given : resolve(base, given)
  }
  // Configured at start: checked once; one that fails is left out with a log line, never fatal. A worktree not made yet
  // waits for init (missing until then).
  const configured = new Map()
  for (const [name, spec] of Object.entries(seed && typeof seed === "object" ? seed : {})) {
    try {
      if (!PROJECT_NAME.test(name)) refuse(`"${name}" is not a project name (${PROJECT_NAME}).`)
      if (local(name)) refuse(`projects/${name} is already one of the desk's own projects.`)
      const { path, worktree, branch, setup, self } = typeof spec === "object" && spec ? spec : { path: spec }
      const tree = worktree ? { repo: full(worktree), branch: String(branch ?? `desk-${name}`), setup: Array.isArray(setup) ? setup.map(String) : null } : null
      const wanted = full(path)
      if (tree && !existsSync(wanted)) {
        configured.set(name, { name, path: wanted, source: "config", at: null, worktree: tree })
        continue
      }
      const real = self === true && !tree ? checkSelf(wanted) : check(wanted)
      prepareAgents(real)
      configured.set(name, { name, path: real, source: "config", at: null, ...(tree ? { worktree: tree } : {}), ...(self === true && !tree ? { self: true } : {}) })
    } catch (error) {
      log(`projects: main.js projects.${name} left out: ${error.message}`)
    }
  }
  const git = (repo, ...args) => {
    const r = spawn(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" })
    return { ok: r.exitCode === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() }
  }

  // The owner's, read again when the file changes (an edit by hand counts).
  let cache = { mtime: -1, entries: new Map() }
  function owned() {
    if (!file) return new Map()
    const mtime = attempt(() => statSync(file).mtimeMs)
    if (mtime === null) return (cache = { mtime: 0, entries: new Map() }).entries
    if (mtime === cache.mtime) return cache.entries
    const entries = new Map()
    try {
      const raw = JSON.parse(readFileSync(file, "utf8"))?.projects ?? {}
      for (const [name, v] of Object.entries(raw)) {
        if (!PROJECT_NAME.test(name) || configured.has(name) || typeof v?.path !== "string") continue
        entries.set(name, { name, path: v.path, source: "owner", at: v.at ?? null })
      }
    } catch (error) {
      log(`projects: ${file} unreadable (${error.message}); no loaded projects until it is fixed`)
    }
    cache = { mtime, entries }
    return entries
  }
  function save(entries) {
    mkdirSync(dirname(file), { recursive: true })
    const projects = Object.fromEntries([...entries.values()].map((e) => [e.name, { path: e.path, at: e.at }]))
    const temp = `${file}.${process.pid}.tmp`
    writeFileSync(temp, `${JSON.stringify({ projects }, null, 2)}\n`)
    renameSync(temp, file)
    cache.mtime = -1
  }

  const all = () => [...configured.values(), ...owned().values()]
  // Still a real folder (moved or deleted since: false). A hand-edited path that is a link or outside the rules is not
  // mounted either: the same check as a load.
  const alive = (e) => attempt(() => (e.self ? checkSelf(e.path) : check(e.path)) === e.path, false)

  return {
    list: () =>
      all()
        .map(({ worktree, ...e }) => ({ ...e, missing: !alive(e), setup: existsSync(join(e.path, AGENTS_DIR, "project.md")), ...(worktree ? { branch: worktree.branch } : {}) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    // The real folder of projects/<name>, or null (unknown, moved, gone or not allowed).
    folder(name) {
      if (typeof name !== "string" || !PROJECT_NAME.test(name)) return null
      const e = configured.get(name) ?? owned().get(name)
      return e && alive(e) ? e.path : null
    },
    load({ path, name } = {}) {
      if (!file) refuse("This desk loads projects from its main.js only.", 403)
      const real = check(path)
      const same = all().find((e) => e.path === real)
      if (same) {
        prepareAgents(real)
        return { entry: same, created: false }
      }
      const chosen = name === undefined || name === null || name === "" ? projectName(real) : String(name)
      if (!PROJECT_NAME.test(chosen)) refuse(`name: "${chosen}" — lower case letters, digits and dashes, starting with a letter (2–41).`)
      const other = configured.get(chosen) ?? owned().get(chosen)
      const taken = other ? `another loaded project (${other.path})` : local(chosen) ? "one of the desk's own projects" : null
      if (taken) refuse(`projects/${chosen} is ${taken}; load it with another name.`, 409)
      prepareAgents(real)
      const entry = { name: chosen, path: real, source: "owner", at: clock().toISOString() }
      const entries = new Map(owned())
      entries.set(chosen, entry)
      save(entries)
      return { entry, created: true }
    },
    init(name) {
      const e = configured.get(name) ?? owned().get(name) ?? refuse(`No project ${name}.`, 404)
      const tree = e.worktree
      let created = false
      let setup = null
      if (tree && !existsSync(e.path)) {
        const has = git(tree.repo, "rev-parse", "--verify", "--quiet", `refs/heads/${tree.branch}`).ok
        const made = git(tree.repo, "worktree", "add", ...(has ? [e.path, tree.branch] : ["-b", tree.branch, e.path]))
        if (!made.ok) refuse(`git worktree add failed: ${made.out.slice(-400)}`, 500)
        e.path = check(e.path)
        prepareAgents(e.path)
        created = true
        if (tree.setup?.length) {
          const r = spawn(tree.setup, { cwd: e.path, stdout: "pipe", stderr: "pipe" })
          setup = { command: tree.setup.join(" "), exit: r.exitCode, tail: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-8) }
        }
        log(`projects: ${name} made — git worktree of ${tree.repo} on ${tree.branch} at ${e.path}${setup ? `; ${setup.command} exit ${setup.exit}` : ""}`)
      } else if (!alive(e)) refuse(`${name} is missing (${e.path}).`, 404)
      return { name, path: e.path, branch: tree?.branch ?? null, created, setup, ...(e.self ? { self: true } : {}) }
    },
    unload(name) {
      if (configured.has(name)) refuse(`${name} is configured in the desk's main.js (projects); remove it there.`, 403)
      const entries = new Map(owned())
      if (!entries.delete(name)) refuse(`No loaded project ${name}.`, 404)
      save(entries)
      return true
    },
  }
}
