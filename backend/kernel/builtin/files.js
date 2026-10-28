import { Artifact } from "../artifact/artifact.js"

// Files: the desk's workspace as an artifact (2026-10-17 owner: a developer view — the live file tree, the files the
// agents open and change as tabs; any agent attaches it by name: artifacts: [files]). One instance per desk (id
// "files", backend/kernel/builtin/index.js), shared by its holders; {type: files, id} makes another.
//
// Commands (the table below has their inputs): list, read, search, focus, open, close; write, edit, append only inside
// the holder's `writes:` lane (globs; none → refused).
//
// Open files (2026-10-25 owner: "remove the open file limits and let the agent open files as required … instructed to
// close files to preserve context. The maximum open file limit can be 25"): files.open puts a file in its holder's prompt
// — its current text, read again before every step and after every change, so an edit never works from a stale copy —
// until files.close; at most OPEN_MAX per holder, each shown up to OPEN_FILE_CHARS and all of a holder's up to
// OPEN_CHARS (past it a file shows its name only: close what is done). files.read is a one-off look.
//
// Lanes: a write needs the holder's agent.config.writes globs (agent.md `writes:`; none = refused, the error says to
// add `writes:`); when agent.config.reads is set (agent.md `reads:` — the critic's "outputs only" lane) every read,
// list, search and focus must fall in it, and the holder's prompt shows only what it may read. Globs are the
// terminal sandbox's (companion/capabilities/sandbox.js laneRegex): * within a folder, ** across, a trailing / = all
// below it, "!glob" excludes. .env* (but .env.example) and .mcp.json are never read or written; what git runs as code
// (a .git config, a hook, a .git file: gitExec) is never written, whatever the lane.
//
// The machine only through an adapter: the default is the host (ctx.host: GET fs/list, fs/read, POST fs/write — the
// tree is built from fs/list, which carries sizes and times); a desk may pass its own (BUILTIN.artifacts.files({adapter})):
//   {list(path, ctx) → [{name, type: dir|file|link|other, size, mtime}], read(path, ctx, {tail?}) → {text, binary,
//    truncated, size, revision, tail?, from?, head?} | null (tail: a file past the read cap from its end), write(path, text, {revision}, ctx) → {revision, created}, tree?(root, ctx) → {tree, truncated}}
//
// refresh(agent) (before each step, coalesced across holders, at most every REFRESH_MS unless a write made it stale)
// pulls the tree under the root; changed() only when the twin state differs.
// Twin state: {root, tree: [{path, size, mtime, dir}] ≤ 800, truncated, open: [{path, by, at, lines}] ≤ OPEN_MAX per holder,
//   modified: [{path, by, at, op: create | write | edit | append, added, removed, diff ≤ 80 lines, why, notes: [{at, by,
//   op, why}] ≤ 6}] ≤ 30 (one per path, its latest change; newest last; 2026-10-25 owner: "the coder … opens the files,
//   makes a note on changes and makes the changes" — a write's `why`, the change's note, kept beside its diff), focus: {path, by, at} | null} — workspace paths throughout.

const TREE_MAX = 800 // entries in the twin's tree
const WHY = "the change's note: what it changes and why (optional; the owner sees it beside the diff)"
const NOTES_MAX = 6
const TREE_DEPTH = 8 // folder levels the tree walks below its root
const OPEN_MAX = 25 // open files per holder
const OPEN_FILE_CHARS = 12000 // one open file's text in the prompt
const OPEN_CHARS = 60000 // all of a holder's open files in the prompt
const MODIFIED_MAX = 30
const DIFF_MAX = 80 // lines of one change's diff (its @@ head included)
const CONTEXT = 3 // unchanged lines kept around a change
const PROMPT_TREE = 60 // tree lines in the prompt
const PROMPT_DEPTH = 3 // folder levels the prompt's tree shows below its root
const PROMPT_MODIFIED = 8
const READ_CHARS = 20000 // a files.read result
const LIST_MAX = 300 // entries in a files.list result
const SEARCH_FILES = 300 // files a search reads at most
const SEARCH_BYTES = 512 * 1024 // a file bigger than this is not searched
const SEARCH_HITS = 60
const LINE_CHARS = 200 // a search hit's line
const REFRESH_MS = 1500 // a tree pulled this recently is fresh enough (unless a write made it stale)
const PARALLEL = 8 // folders listed at once
// Folders listed but never walked into (an install or a cache would bury the project's own files).
const SKIP = new Set([".git", "node_modules", ".venv", "venv", "vendor", "__pycache__", ".cache", ".next", ".turbo", ".pytest_cache", ".mypy_cache"])

// ---- paths and lanes ---------------------------------------------------------------------------

const list = (v) => (v == null || v === "" ? [] : Array.isArray(v) ? v : String(v).split(",")).map((x) => String(x).trim()).filter(Boolean)

// A workspace path as the host names it: no leading ./ or /, no trailing /, "" = the workspace itself.
export function cleanPath(path) {
  const parts = String(path ?? "").split(/[\\/]+/).filter((p) => p && p !== ".")
  if (parts.includes("..")) throw new Error(`${path}: ".." is not a workspace path`)
  return parts.join("/")
}
const join = (dir, name) => (dir ? `${dir}/${name}` : name)
const secret = (path) => {
  const name = path.split("/").at(-1) ?? ""
  return name === ".mcp.json" || (/^\.env(\..+)?$/.test(name) && name !== ".env.example")
}
// What git runs as code (2026-10-17 critic: a member's lane "projects/*/.git/**" let it plant a core.fsmonitor command
// or a hook that the lead's or the coder's git then ran under their wider lanes): a repository's config (config,
// config.lock, config.worktree) and anything under its hooks/ — below any .git folder (a submodule's or a worktree's
// too), case-insensitively (macOS) — and a .git file itself (a "gitdir:" pointer to a config elsewhere). Never written
// through files; read as any file. Commits (objects, index, refs) stay the terminal's.
export function gitExec(path) {
  const parts = String(path ?? "").toLowerCase().split("/").filter(Boolean)
  const at = parts.indexOf(".git")
  if (at < 0) return false
  const rest = parts.slice(at + 1)
  return !rest.length || rest.includes("hooks") || /^config(\.lock|\.worktree)?$/.test(rest.at(-1))
}

// A lane glob as a regex on workspace paths — sandbox.js laneRegex's rules.
export function globRegex(glob) {
  let g = String(glob).trim().replace(/^!/, "").replace(/^\.?\/+/, "")
  if (g.endsWith("/")) g += "**"
  let out = ""
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === "*" && g[i + 1] === "*") {
      const slash = g[i + 2] === "/"
      out += slash ? "(?:.*/)?" : ".*"
      i += slash ? 2 : 1
    } else if (c === "*") out += "[^/]*"
    else if (c === "?") out += "[^/]"
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`^${out}$`)
}

// Is `path` in the lane: matched by a glob, and by no "!glob".
export function inLane(globs, path) {
  const g = list(globs)
  const p = cleanPath(path)
  return g.some((x) => !x.startsWith("!") && globRegex(x).test(p)) && !g.some((x) => x.startsWith("!") && globRegex(x).test(p))
}

// Does the lane glob `outer` cover every path `inner` matches (inner ⊆ outer)? 2026-10-17: agent.spawn narrows a
// helper's writes:/reads: to globs its caller's lane covers. Segment-wise on "/" (a trailing / is /**): outer ** as the
// LAST segment covers any rest of at least one segment — never the folder itself (2026-10-17 critic: globRegex and the
// sandbox read "projects/**" as ^projects/.*$, so a helper granted "projects" could chmod or replace the folder its
// caller cannot touch); a ** between segments covers any run of them; outer * covers one inner segment without **; an
// outer segment with * or ? inside covers an equal one or one it matches as a glob (an inner * is never taken for a ?);
// a literal covers only an equal segment; an inner ** only an outer **. Conservative: when unsure, false. A "!glob" or
// an empty one is not a lane: false.
export function globCovers(outer, inner) {
  const split = (glob) => {
    let g = String(glob ?? "").trim()
    if (!g || g.startsWith("!")) return null
    g = g.replace(/^\.?\/+/, "")
    if (g.endsWith("/")) g += "**"
    return g.split("/").filter(Boolean)
  }
  const o = split(outer)
  const i = split(inner)
  if (!o?.length || !i?.length) return false
  const segment = (os, is) => {
    if (os === is) return true
    if (is.includes("**")) return false
    if (os === "*") return true
    if (!/[*?]/.test(os)) return false
    if (os.includes("**") || (os.includes("?") && is.includes("*"))) return false
    return globRegex(os).test(is)
  }
  const cover = (a, b) => {
    if (a === o.length) return b === i.length
    if (o[a] === "**") {
      if (a === o.length - 1) return b < i.length // at least one more segment: "x/**" is not "x"
      for (let k = b; k <= i.length; k++) if (cover(a + 1, k)) return true
      return false
    }
    return b < i.length && segment(o[a], i[b]) && cover(a + 1, b + 1)
  }
  return cover(0, 0)
}

// Could a path below the folder `dir` be in the lane (so the folder is shown, listed, searched)?
export function mayContain(globs, dir) {
  const d = cleanPath(dir).split("/").filter(Boolean)
  return list(globs)
    .filter((x) => !x.startsWith("!"))
    .some((glob) => {
      let g = glob.replace(/^\.?\/+/, "")
      if (g.endsWith("/")) g += "**"
      const parts = g.split("/")
      for (let i = 0; i < d.length; i++) {
        if (i >= parts.length) return false
        if (parts[i].includes("**")) return true
        if (!globRegex(parts[i]).test(d[i])) return false
      }
      return parts.length > d.length
    })
}

// ---- the default adapter: the host -------------------------------------------------------------

const hostOf = (ctx) => {
  if (!ctx?.host?.get) throw new Error("no host here (ctx.host): the desk server reaches the workspace")
  return ctx.host
}

// A host error as one line: "HTTP 403: <the host's reason>".
export function hostError(e) {
  const m = String(e?.message ?? e)
  const hit = m.match(/^(?:GET|POST) \S+: HTTP (\d{3}) ?([\s\S]*)$/)
  if (!hit) return m
  let text = hit[2]
  try {
    text = JSON.parse(text).error ?? text
  } catch {
    text = text.replace(/^\{"error":"/, "").replace(/"?\}?$/, "")
  }
  return `HTTP ${hit[1]}: ${text}`
}

// fn() with its failure as "<label>: <hostError>".
export async function hostTry(label, fn) {
  try {
    return await fn()
  } catch (e) {
    throw new Error(`${label}: ${hostError(e)}`)
  }
}

export const hostFiles = {
  async list(path, ctx) {
    const r = await hostOf(ctx).get(`fs/list?path=${encodeURIComponent(path)}`, { signal: ctx?.signal })
    return r?.entries ?? []
  },
  // tail (2026-10-17): a file past the host's read cap read from its end ({…, tail, from, head}); see host fs/read.
  async read(path, ctx, { tail = false } = {}) {
    try {
      return await hostOf(ctx).get(`fs/read?path=${encodeURIComponent(path)}${tail ? "&tail=1" : ""}`, { signal: ctx?.signal })
    } catch (e) {
      if (e?.status === 404) return null
      throw e
    }
  },
  write(path, text, { revision } = {}, ctx) {
    return hostOf(ctx).post("fs/write", { path, text, ...(revision !== undefined ? { revision } : {}) }, { signal: ctx?.signal })
  },
}

// Each item through fn, at most `n` at once, in order.
async function mapLimit(items, n, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i], i)
      }
    }),
  )
  return out
}

const byName = (a, b) => (b.type === "dir") - (a.type === "dir") || String(a.name).localeCompare(String(b.name)) // folders first

// The tree under `root`, breadth first (the top stays whole when a deep folder is cut): [{path, size, mtime, dir}]
// at most `max`, `depth` levels; heavy folders (SKIP) listed, not walked. truncated: entries were left out.
export async function walkTree(adapter, root, ctx, { max = TREE_MAX, depth = TREE_DEPTH } = {}) {
  const tree = []
  const unreadable = [] // folders below the top that did not list (2026-10-23 audit: they looked empty)
  let truncated = false
  let level = [root]
  for (let d = 0; d < depth && level.length && !truncated; d++) {
    const next = []
    // A level's folders PARALLEL at a time, in order, until the tree is full (no folder listed for nothing).
    for (let i = 0; i < level.length && !truncated; i += PARALLEL) {
      const batch = level.slice(i, i + PARALLEL)
      const lists = await mapLimit(batch, PARALLEL, async (dir) => [dir, d === 0 ? await adapter.list(dir, ctx) : await adapter.list(dir, ctx).catch(() => (unreadable.push(dir), []))])
      for (const [dir, entries] of lists) {
        for (const e of [...(entries ?? [])].sort(byName)) {
          if (!e?.name) continue
          if (tree.length >= max) {
            truncated = true
            break
          }
          const path = join(dir, e.name)
          const isDir = e.type === "dir"
          tree.push({ path, size: Number(e.size) || 0, mtime: Math.round(Number(e.mtime) || 0), dir: isDir })
          if (isDir && !SKIP.has(e.name)) next.push(path)
        }
        if (truncated) break
      }
    }
    level = next
  }
  if (level.length && !truncated) truncated = true // folders deeper than `depth`
  return { tree, truncated, unreadable }
}

const GLOB_PART = /[*?]/
const GLOB_FILES = 2000 // entries a ** glob walks

// The files a glob matches: [{path, mtime}]. A ** glob walks the tree under its fixed head; any other is listed part by
// part (a folder that is missing matches nothing). The preview's bound scripts watch their inputs with it. (Moved here
// from the retired charts artifact, 2026-10-18.)
export async function expandGlob(adapter, pattern, ctx) {
  const parts = pattern.split("/")
  const first = parts.findIndex((p) => GLOB_PART.test(p))
  if (first < 0) return []
  const base = parts.slice(0, first).join("/")
  if (parts.slice(first).some((p) => p.includes("**"))) {
    let walked
    try {
      walked = await walkTree(adapter, base, ctx, { max: GLOB_FILES, depth: 12 })
    } catch (e) {
      if (e?.status === 404 || e?.status === 400) return []
      throw e
    }
    const re = globRegex(pattern)
    // folders that did not list ride on the result (`unreadable`), so a watch can say it went blind (2026-10-23 audit)
    return Object.assign(walked.tree.filter((e) => !e.dir && re.test(e.path)).map((e) => ({ path: e.path, mtime: e.mtime })), { unreadable: walked.unreadable ?? [] })
  }
  let level = [base]
  const found = []
  const unreadable = []
  for (let i = first; i < parts.length && level.length; i++) {
    const last = i === parts.length - 1
    if (!GLOB_PART.test(parts[i]) && !last) {
      level = level.map((d) => join(d, parts[i]))
      continue
    }
    const re = globRegex(parts[i])
    const lists = await mapLimit(level, PARALLEL, async (dir) => {
      try {
        return [dir, await adapter.list(dir, ctx)]
      } catch (e) {
        if (i === first && e?.status !== 404 && e?.status !== 400) throw e // the host itself failed
        if (e?.status !== 404 && e?.status !== 400) unreadable.push(dir) // there, but would not list
        return [dir, []]
      }
    })
    const next = []
    for (const [dir, entries] of lists)
      for (const e of entries ?? []) {
        if (!e?.name || !re.test(e.name)) continue
        if (last) e.type !== "dir" && found.push({ path: join(dir, e.name), mtime: Number(e.mtime) || 0 })
        else if (e.type === "dir") next.push(join(dir, e.name))
      }
    level = next
  }
  return Object.assign(found, { unreadable })
}

// ---- diffs ---------------------------------------------------------------------------------------

// A change as diff lines under one "@@ -a,b +c,d @@" head: "+" added, "-" removed, " " context (CONTEXT lines around
// the changed middle; common head and tail trimmed). A new file: all its lines added. At most `max` lines, the last
// one " … n more lines" when cut. → {diff, added, removed, lines}
export function lineDiff(before, after, max = DIFF_MAX) {
  const split = (t) => (t === "" ? [] : String(t).replace(/\n$/, "").split("\n"))
  const b = split(after ?? "")
  let body
  let head
  let added
  let removed
  if (before == null) {
    body = b.map((l) => `+${l}`)
    head = `@@ -0,0 +${b.length ? 1 : 0},${b.length} @@`
    added = b.length
    removed = 0
  } else {
    const a = split(before)
    let p = 0
    while (p < a.length && p < b.length && a[p] === b[p]) p++
    let s = 0
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
    const gone = a.slice(p, a.length - s)
    const come = b.slice(p, b.length - s)
    added = come.length
    removed = gone.length
    if (!gone.length && !come.length) return { diff: "", added: 0, removed: 0, lines: b.length }
    const pre = a.slice(Math.max(0, p - CONTEXT), p)
    const post = a.slice(a.length - s, a.length - s + CONTEXT)
    const from = p - pre.length + 1
    body = [...pre.map((l) => ` ${l}`), ...gone.map((l) => `-${l}`), ...come.map((l) => `+${l}`), ...post.map((l) => ` ${l}`)]
    head = `@@ -${from},${pre.length + gone.length + post.length} +${from},${pre.length + come.length + post.length} @@`
  }
  let out = [head, ...body]
  if (out.length > max) out = [...out.slice(0, max - 1), ` … ${out.length - max + 1} more lines`]
  return { diff: out.join("\n"), added, removed, lines: b.length }
}

// ---- the artifact --------------------------------------------------------------------------------

const size = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`)
// Tree order: a folder before what it holds; within a folder, folders first, then by name.
const compareEntries = (a, b) => {
  const x = a.path.split("/")
  const y = b.path.split("/")
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] === y[i]) continue
    const fx = i < x.length - 1 || a.dir
    const fy = i < y.length - 1 || b.dir
    return fx !== fy ? (fx ? -1 : 1) : x[i] < y[i] ? -1 : 1
  }
  return x.length - y.length
}
// A file's text from a call: a reply parser may hand a JSON block (or key: value lines) as data — written back as text.
const asText = (v, path) => {
  if (v == null) return ""
  if (typeof v !== "object") return String(v)
  if (String(path).endsWith(".json")) return `${JSON.stringify(v, null, 2)}\n`
  const pairs = (o) => Object.entries(o).map(([k, x]) => `${k}: ${x !== null && typeof x === "object" ? JSON.stringify(x) : x}`).join("\n")
  // 2026-10-17: a `text: [...]` list became a JSON array inside progress.md; a list is one line per item.
  if (Array.isArray(v)) return `${v.map((x) => (x !== null && typeof x === "object" && !Array.isArray(x) ? pairs(x) : typeof x === "string" ? x : JSON.stringify(x))).join("\n")}\n`
  return `${pairs(v)}\n`
}
const lineCount = (text) => (text == null ? null : text ? String(text).replace(/\n$/, "").split("\n").length : 0)
const withNewline = (t) => (t && !t.endsWith("\n") ? `${t}\n` : t) // a <<< >>> block loses its last newline

export class Files extends Artifact {
  static about = "the workspace's files: list, read, open, write and edit inside the holder's lanes, every change a diff"
  static commands = {
    list: { description: "list a folder: names, / for folders, sizes", input: { path: `a folder (default: the tree's root)` }, run(i, c) { return this.#list(i, c) } },
    open: { description: `keep files open: each one's current text stays in your prompt (read again every step and after each change) until you close it — at most ${OPEN_MAX}; close what you are done with to keep the prompt small`, input: { paths: "the files, comma-separated (or one path)" }, run(i, c) { return this.#open(i, c) } },
    close: { description: "close open files (their text leaves your prompt)", input: { paths: 'the files, comma-separated, or "all"' }, run(i, c) { return this.#close(i, c) } },
    read: { description: "read a file once with line numbers (a one-off look; open keeps it in your prompt); from/lines for a slice of a big one", input: { path: "the file", from: "first line (default 1)", lines: "how many (default all)" }, run(i, c) { return this.#read(i, c) } },
    write: { description: "write a whole file (folders are created); only inside your writes: lane", input: { path: "the file", content: "its full text", why: WHY }, run(i, c) { return this.#write(i, c) } },
    edit: { description: "replace one exact passage of a file (old must match once, whitespace included; all: true replaces each)", input: { path: "the file", old: "the exact text now", new: "its replacement", all: "true: every match (optional)", why: WHY }, run(i, c) { return this.#edit(i, c) } },
    append: { description: "add text at the end of a file (created if missing)", input: { path: "the file", text: "the lines to add", why: WHY }, run(i, c) { return this.#append(i, c) } },
    search: { description: "find the lines that hold a text (case-insensitive) in the files under a folder, or in one file", input: { text: "what to look for", path: "a folder, or one file (default: the tree's root)" }, run(i, c) { return this.#search(i, c) } },
    focus: { description: "show another folder as the tree's root (for every holder)", input: { path: "the folder (\"\" = the workspace)" }, run(i, c) { return this.#focus(i, c) } },
  }
  constructor({ id = "files", title, root = "", adapter = hostFiles, clock = () => new Date() } = {}) {
    super({ name: id, title: title ?? (id === "files" ? "files — the workspace" : `${id} — files`) })
    Object.assign(this, { kind: "files", view: "files", keep: "always" }) // open and modified tabs survive a restart; the tree is pulled again
    Object.assign(this, { adapter, clock })
    this.state = { root: cleanPath(root), tree: [], truncated: false, open: [], modified: [], focus: null, unreadable: [] }
    this.texts = new Map() // an open file's path → its text now (the prompt's copy; never in the twin)
    this.pulled = 0 // when the tree was last pulled (ms)
    this.pulling = null // the pull in flight, shared by every holder that refreshes meanwhile
    this.stale = true // a write or a focus since the last pull
  }

  // ---- state ----

  #set(patch) {
    const next = { ...this.state, ...patch }
    if (JSON.stringify(next) === JSON.stringify(this.state)) return false
    this.state = next
    this.changed()
    return true
  }

  restore(data) {
    if (!data || typeof data !== "object") return
    const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x.path === "string") : [])
    this.state = {
      root: typeof data.root === "string" ? data.root : this.state.root,
      tree: arr(data.tree).slice(0, TREE_MAX),
      truncated: !!data.truncated,
      open: arr(data.open),
      modified: arr(data.modified).slice(-MODIFIED_MAX),
      focus: data.focus && typeof data.focus.path === "string" ? data.focus : null,
      unreadable: Array.isArray(data.unreadable) ? data.unreadable.slice(0, 20) : [],
    }
    this.stale = true
  }

  async refresh(agent) {
    if (this.pulling) return this.pulling
    if (!this.stale && Date.now() - this.pulled < REFRESH_MS) return
    this.pulling = this.#pull({ ...(agent?.context ?? {}), agent }).finally(() => (this.pulling = null))
    return this.pulling
  }

  async #pull(ctx) {
    const root = this.state.root
    const got = await hostTry(`the tree of ${root || "the workspace"}/`, () => (this.adapter.tree ? this.adapter.tree(root, ctx) : walkTree(this.adapter, root, ctx)))
    this.pulled = Date.now()
    this.stale = false
    if (root !== this.state.root) return // focused elsewhere meanwhile: the next pull reads it
    this.#set({ tree: (got?.tree ?? []).slice(0, TREE_MAX), truncated: !!got?.truncated || (got?.tree?.length ?? 0) > TREE_MAX, unreadable: (got?.unreadable ?? []).slice(0, 20) })
    await this.#reread(ctx)
  }

  // Every open file as it is now (one gone: closed, with a line in its holder's next prompt).
  async #reread(ctx) {
    const paths = [...new Set(this.state.open.map((o) => o.path))]
    const files = await Promise.all(paths.map((p) => hostTry(p, () => this.adapter.read(p, ctx)).catch(() => null)))
    const gone = paths.filter((p, i) => !files[i])
    paths.forEach((p, i) => (files[i] ? this.texts.set(p, files[i].binary ? null : String(files[i].text ?? "")) : this.texts.delete(p)))
    if (gone.length) this.#set({ open: this.state.open.filter((o) => !gone.includes(o.path)) })
    this.#set({ open: this.state.open.map((o) => ({ ...o, lines: lineCount(this.texts.get(o.path)) })) })
  }

  #mine(name) {
    return this.state.open.filter((o) => o.by === name)
  }

  async #open({ paths, path } = {}, ctx = {}) {
    const by = ctx.agent?.name ?? null
    const wanted = list(paths ?? path).map((p) => this.#readable(ctx.agent, p))
    if (!wanted.length) throw new Error("paths: the files to open")
    const fresh = wanted.filter((p) => !this.#mine(by).some((o) => o.path === p))
    const room = OPEN_MAX - this.#mine(by).length
    if (fresh.length > room) throw new Error(`${this.#mine(by).length} of ${OPEN_MAX} files open: ${this.name}.close what you are done with first (${this.#mine(by).map((o) => o.path).join(", ")})`)
    const files = await Promise.all(wanted.map((p) => hostTry(p, () => this.adapter.read(p, ctx))))
    const missing = wanted.filter((p, i) => !files[i])
    if (missing.length) throw new Error(`no such file: ${missing.join(", ")}`)
    const at = this.clock().toISOString()
    wanted.forEach((p, i) => this.texts.set(p, files[i].binary ? null : String(files[i].text ?? "")))
    const others = this.state.open.filter((o) => !(o.by === by && wanted.includes(o.path)))
    this.#set({ open: [...others, ...wanted.map((p) => ({ path: p, by, at, lines: lineCount(this.texts.get(p)) }))] })
    return `open (${this.#mine(by).length} of ${OPEN_MAX}): ${wanted.map((p) => `${p} — ${lineCount(this.texts.get(p)) ?? "binary"} lines`).join(", ")}; their text is in your prompt under OPEN FILES from your next step`
  }

  #close({ paths, path } = {}, ctx = {}) {
    const by = ctx.agent?.name ?? null
    const raw = list(paths ?? path)
    if (!raw.length) throw new Error('paths: the files to close, or "all"')
    const all = raw.includes("all")
    const named = all ? [] : raw.map(cleanPath)
    const closing = this.#mine(by).filter((o) => all || named.includes(o.path))
    if (!closing.length) return `nothing to close — open: ${this.#mine(by).map((o) => o.path).join(", ") || "none"}`
    this.#set({ open: this.state.open.filter((o) => !closing.includes(o)) })
    for (const o of closing) if (!this.state.open.some((x) => x.path === o.path)) this.texts.delete(o.path)
    return `closed ${closing.map((o) => o.path).join(", ")} — ${this.#mine(by).length} of ${OPEN_MAX} open`
  }

  #changed(path, by, op, before, after, why = null) {
    const { diff, added, removed, lines } = lineDiff(before, after)
    const at = this.clock().toISOString()
    this.stale = true
    if (this.texts.has(path)) {
      this.texts.set(path, after ?? "")
      this.#set({ open: this.state.open.map((o) => (o.path === path ? { ...o, lines: lineCount(after) } : o)) })
    }
    const note = String(why ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || null
    const was = this.state.modified.find((m) => m.path === path)
    const notes = [...(was?.notes ?? []), ...(note ? [{ at, by, op, why: note }] : [])].slice(-NOTES_MAX)
    this.#set({ modified: [...this.state.modified.filter((m) => m.path !== path), { path, by, at, op, added, removed, diff, why: note, notes }].slice(-MODIFIED_MAX) })
    return { added, removed, lines }
  }

  // ---- lanes ----

  #writable(agent, path) {
    const p = cleanPath(path)
    if (!p) throw new Error("path: the file to write")
    if (secret(p)) throw new Error(`${p}: ASKK's configuration (.env*, .mcp.json) — agents never write it`)
    if (gitExec(p)) throw new Error(`${p}: git runs this as code (a .git config, hook or gitdir file) — agents never write it; commit with git in the terminal`)
    const writes = list(agent?.config?.writes)
    if (!writes.length) throw new Error(`${agent?.name ?? "this agent"} has no write lane: add writes: [globs] to its agent.md (e.g. writes: ["projects/**"]) — nothing is written without one`)
    if (!inLane(writes, p)) throw new Error(`${agent.name} writes only ${writes.join(", ")} (its writes:) — ${p} is outside its lane`)
    return p
  }

  // A file this holder may read (reads: set → in it), or a folder it may look into (one that may hold such a file).
  #readable(agent, path, folder = false) {
    const p = cleanPath(path)
    if (!folder && secret(p)) throw new Error(`${p}: ASKK's configuration (.env*, .mcp.json) — agents never read it`)
    if (!this.#sees(agent, p, folder)) throw new Error(`${agent.name} reads only ${list(agent.config.reads).join(", ")} (its reads:) — ${p || "the workspace"}${folder ? "/" : ""} is outside its lane`)
    return p
  }

  // What this holder sees of a path: everything, or (reads: set) the files in its lane and the folders that may hold them.
  #sees(agent, path, dir) {
    const reads = agent?.config?.reads
    if (reads == null) return true
    return dir ? mayContain(reads, path) || inLane(reads, path) : inLane(reads, path)
  }

  // ---- commands ----

  async #list({ path } = {}, ctx = {}) {
    const p = this.#readable(ctx.agent, path ?? this.state.root, true)
    const entries = await hostTry(`${p || "."}/`, () => this.adapter.list(p, ctx))
    const shown = [...entries].filter((e) => e?.name && this.#sees(ctx.agent, join(p, e.name), e.type === "dir")).sort(byName)
    const lines = shown.slice(0, LIST_MAX).map((e) => (e.type === "dir" ? `${e.name}/${SKIP.has(e.name) ? " …" : ""}` : `${e.name}  ${size(Number(e.size) || 0)}`))
    const more = shown.length > LIST_MAX ? `\n… ${shown.length - LIST_MAX} more` : ""
    return `${p || "."}/ — ${shown.length} entr${shown.length === 1 ? "y" : "ies"}\n${lines.join("\n") || "(empty)"}${more}`
  }

  async #read({ path, from, lines } = {}, ctx = {}) {
    if (!String(path ?? "").trim()) throw new Error("path: the file to read")
    const p = this.#readable(ctx.agent, path)
    const file = await hostTry(p, () => this.adapter.read(p, ctx))
    if (!file) throw new Error(`${p}: no such file`)
    if (file.binary) return `${p}: a binary file (${size(Number(file.size) || 0)}) — not shown`
    const all = String(file.text ?? "").replace(/\n$/, "").split("\n")
    const start = Math.max(1, Math.floor(Number(from)) || 1)
    const count = Number(lines) > 0 ? Math.floor(Number(lines)) : all.length
    const slice = all.slice(start - 1, start - 1 + count)
    let text = slice.map((l, i) => `${start + i}\t${l}`).join("\n")
    let cut = ""
    if (text.length > READ_CHARS) {
      text = text.slice(0, READ_CHARS)
      const last = start + text.split("\n").length - 1
      cut = `\n… cut at ${READ_CHARS} chars: read on with from: ${last}`
    }
    const head = `${p} — ${all.length} lines${file.truncated ? " (only its first part: the file is larger than the host reads)" : ""}${start > 1 || slice.length < all.length ? `, lines ${start}–${start + slice.length - 1}` : ""}`
    return `${head}\n${text || "(empty file)"}${cut}`
  }

  // The file now (null: none yet) — for a change's diff and its revision check.
  #before(p, ctx) {
    return hostTry(p, () => this.adapter.read(p, ctx))
  }

  async #store(p, text, before, ctx) {
    try {
      return await this.adapter.write(p, text, { revision: before ? (before.revision ?? undefined) : null }, ctx)
    } catch (e) {
      if (e?.status === 409) throw new Error(`${p} changed while you wrote it (another agent or the owner): read it again, then write`)
      throw new Error(`${p}: ${hostError(e)}`)
    }
  }

  async #write(input = {}, ctx = {}) {
    const p = this.#writable(ctx.agent, input.path)
    const text = withNewline(asText(input.content ?? input.text, p))
    const before = await this.#before(p, ctx)
    if (before?.truncated) throw new Error(`${p} is larger than the host reads: it is not rewritten through files (use the terminal)`)
    await this.#store(p, text, before, ctx)
    const op = before ? "write" : "create"
    const d = this.#changed(p, ctx.agent?.name ?? null, op, before && !before.binary ? before.text : null, text, input.why)
    return `${op === "create" ? "created" : "wrote"} ${p} (${d.lines} lines, +${d.added} -${d.removed})`
  }

  async #edit(input = {}, ctx = {}) {
    const p = this.#writable(ctx.agent, input.path)
    const plain = (v) => (v !== null && typeof v === "object" ? asText(v, "").replace(/\n$/, "") : v)
    const old = input.old == null ? "" : String(plain(input.old))
    const now = String(plain(input.new) ?? "")
    if (!old) throw new Error("old: the exact passage to replace (files.read it, copy it)")
    const before = await this.#before(p, ctx)
    if (!before) throw new Error(`${p}: no such file (files.write creates one)`)
    if (before.binary || before.truncated) throw new Error(`${p}: ${before.binary ? "a binary file" : "larger than the host reads"} — not edited through files`)
    const text = String(before.text ?? "")
    const n = text.split(old).length - 1
    const all = input.all === true || input.all === "true"
    if (!n) throw new Error(`${p}: old matches nothing — it must match exactly, whitespace included (files.read the passage, copy it)`)
    if (n > 1 && !all) throw new Error(`${p}: old matches ${n} times — make it unique (more lines around it) or pass all: true`)
    const after = all ? text.split(old).join(now) : text.replace(old, () => now)
    await this.#store(p, after, before, ctx)
    const d = this.#changed(p, ctx.agent?.name ?? null, "edit", text, after, input.why)
    return `edited ${p}: ${n} replacement${n === 1 ? "" : "s"} (+${d.added} -${d.removed})`
  }

  async #append(input = {}, ctx = {}) {
    const p = this.#writable(ctx.agent, input.path)
    const add = withNewline(asText(input.text ?? input.content, p))
    if (!add) throw new Error("text: what to add at the end")
    const before = await this.#before(p, ctx)
    if (before?.binary || before?.truncated) throw new Error(`${p}: ${before.binary ? "a binary file" : "larger than the host reads"} — not appended through files`)
    const was = before ? String(before.text ?? "") : ""
    const after = `${was}${was && !was.endsWith("\n") ? "\n" : ""}${add}`
    await this.#store(p, after, before, ctx)
    const d = this.#changed(p, ctx.agent?.name ?? null, "append", before ? was : null, after, input.why)
    return `appended to ${p} (+${d.added} lines, ${d.lines} now)`
  }

  async #search({ text, path } = {}, ctx = {}) {
    const q = String(text ?? "").trim()
    if (!q) throw new Error("text: what to look for")
    const base = this.#readable(ctx.agent, path ?? this.state.root, true)
    let found
    try {
      found = await walkTree(this.adapter, base, ctx, { max: SEARCH_FILES * 4 })
    } catch (e) {
      // 2026-10-17: the coder searched train.py itself and got "Not a folder" three times — a file is searched alone.
      if (e?.status !== 400 || !base) throw new Error(`${base || "."}/: ${hostError(e)}`)
      this.#readable(ctx.agent, base)
      found = { tree: [{ path: base, size: 0, dir: false }], truncated: false, file: true }
    }
    const files = found.tree.filter((e) => !e.dir && e.size <= SEARCH_BYTES && !secret(e.path) && this.#sees(ctx.agent, e.path, false)).slice(0, SEARCH_FILES)
    const needle = q.toLowerCase()
    let unread = 0 // files that would not read: counted in the answer, never a silent "no hit"
    const read = await mapLimit(files, PARALLEL, (f) => this.adapter.read(f.path, ctx).catch(() => (unread++, null)))
    const hits = []
    for (const [i, file] of read.entries()) {
      if (!file || file.binary || hits.length >= SEARCH_HITS) continue
      String(file.text ?? "")
        .split("\n")
        .forEach((line, n) => {
          if (hits.length < SEARCH_HITS && line.toLowerCase().includes(needle)) hits.push(`${files[i].path}:${n + 1}: ${line.trim().slice(0, LINE_CHARS)}`)
        })
    }
    const scope = found.file ? base : `${files.length} file${files.length === 1 ? "" : "s"} under ${base || "."}/${found.truncated ? " (the folder is larger: narrow path)" : ""}`
    const missed = unread ? ` — ${unread} file${unread === 1 ? "" : "s"} could not be read` : ""
    return hits.length ? `${hits.length}${hits.length >= SEARCH_HITS ? "+" : ""} lines hold "${q}" (${scope}${missed})\n${hits.join("\n")}` : `no line holds "${q}" (${scope}${missed})`
  }

  async #focus({ path } = {}, ctx = {}) {
    const p = this.#readable(ctx.agent, path ?? "", true)
    await hostTry(`${p || "."}/`, () => this.adapter.list(p, ctx)) // a folder that exists
    this.stale = true
    this.#set({ root: p, focus: { path: p, by: ctx.agent?.name ?? null, at: this.clock().toISOString() } })
    await this.#pull(ctx)
    const files = this.state.tree.filter((e) => !e.dir).length
    return `the tree shows ${p || "the workspace"}/ now: ${files} file${files === 1 ? "" : "s"}${this.state.truncated ? " (more not listed)" : ""}`
  }

  // ---- views ----

  brief() {
    const s = this.state
    const files = s.tree.filter((e) => !e.dir).length
    return `${s.root || "workspace"}/ · ${files}${s.truncated ? "+" : ""} files · ${s.open.length} open · ${s.modified.length} modified`
  }

  // The holder's view: what it can do (its own commands, its lanes), the tree under the root (what it may read),
  // the files open and the last ones modified.
  render(agent) {
    const s = this.state
    const can = this.can(agent)
    const writes = list(agent?.config?.writes)
    const reads = agent?.config?.reads
    const writing = can.some((c) => /\.(write|edit|append)$/.test(c))
    const head = [
      `the desk's files (workspace paths, shared by the agents that hold them)${can.length ? `: ${can.join(", ")}` : ""}`,
      writing ? (writes.length ? `you write only: ${writes.join(", ")}` : "you write nothing: no writes: lane in your agent.md") : null,
      reads != null ? `you read only: ${list(reads).join(", ") || "nothing"}` : null,
    ].filter(Boolean)
    const sees = (e) => this.#sees(agent, e.path, e.dir)
    const root = s.root
    const under = s.tree.filter((e) => (root ? e.path.startsWith(`${root}/`) : true) && sees(e))
    const rel = (p) => (root ? p.slice(root.length + 1) : p)
    const shown = under.filter((e) => rel(e.path).split("/").length <= PROMPT_DEPTH).sort(compareEntries)
    const lines = shown.slice(0, PROMPT_TREE).map((e) => {
      const parts = rel(e.path).split("/")
      return `${"  ".repeat(parts.length - 1)}${parts.at(-1)}${e.dir ? `/${SKIP.has(parts.at(-1)) ? " …" : ""}` : `  ${size(e.size)}`}`
    })
    const left = under.length - Math.min(shown.length, PROMPT_TREE)
    const files = under.filter((e) => !e.dir).length
    const out = [...head, `ROOT ${root || "."}/${s.focus ? ` (focused by ${s.focus.by ?? "the owner"})` : ""} — ${files}${s.truncated ? "+" : ""} files${s.tree.length ? "" : " (not read yet)"}`]
    out.push(...lines)
    if (left > 0 || s.truncated) out.push(`… ${left > 0 ? `${left} more` : "more"} below: ${this.name}.list a folder`)
    const others = s.open.filter((o) => o.by !== agent?.name && sees({ path: o.path, dir: false }))
    if (others.length) out.push(`OPEN BY OTHERS ${others.map((o) => `${o.path} (${o.by ?? "?"})`).join(", ")}`)
    const modified = s.modified.filter((m) => sees({ path: m.path, dir: false })).slice(-PROMPT_MODIFIED)
    if (modified.length) out.push("MODIFIED (newest last)", ...modified.map((m) => `  ${m.path} ${m.op} by ${m.by ?? "?"} +${m.added} -${m.removed}${m.why ? ` — ${m.why}` : ""}`))
    out.push(...this.#openLines(agent))
    return out.join("\n")
  }

  // The holder's open files, each as it is now with line numbers, within the prompt budget (past it: the name only).
  #openLines(agent) {
    const mine = this.#mine(agent?.name ?? null)
    if (!mine.length) return []
    const out = [`OPEN FILES (${mine.length} of ${OPEN_MAX}, as they are now — ${this.name}.close what you are done with)`]
    let budget = OPEN_CHARS
    for (const o of mine) {
      const text = this.texts.get(o.path)
      if (text === undefined) out.push(`── ${o.path} (reading…)`)
      else if (text === null) out.push(`── ${o.path} (binary: not shown)`)
      else if (budget <= 0) out.push(`── ${o.path} (${lineCount(text)} lines — not shown: the open files fill the prompt's share; close some)`)
      else {
        const numbered = text.replace(/\n$/, "").split("\n").map((l, i) => `${i + 1}\t${l}`).join("\n")
        const room = Math.min(OPEN_FILE_CHARS, budget)
        const shown = numbered.length > room ? `${numbered.slice(0, room)}\n… cut: ${this.name}.read {path, from} for the rest` : numbered
        budget -= shown.length
        out.push(`── ${o.path} (${lineCount(text)} lines)`, shown || "(empty file)")
      }
    }
    return out
  }
}
