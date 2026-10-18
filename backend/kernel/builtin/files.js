import { Artifact } from "../artifact/artifact.js"
import { Tool } from "../tool/tool.js"

// Files: the desk's workspace as an artifact (2026-10-17 owner: a developer view — the live file tree, the files the
// agents open and change as tabs; any agent attaches it by name: artifacts: [files]). One instance per desk (id
// "files", backend/kernel/builtin/index.js), shared by its holders; {type: files, id} makes another.
//
//   files.list   {path}                     a folder's entries (names, / for folders, sizes)
//   files.read   {path, from?, lines?}      a file with line numbers (marks it open)
//   files.write  {path, content}            a whole file (creates folders)          ┐ only inside the holder's
//   files.edit   {path, old, new, all?}     one exact passage replaced (all: each)  │ `writes:` lane (globs);
//   files.append {path, text}              text added at the end                   ┘ none → refused
//   files.search {text, path?}              lines that hold the text (case-insensitive), under path (or in that file)
//   files.focus  {path}                     the folder the tree shows (its root)
//
// Lanes: a write needs the holder's agent.config.writes globs (agent.md `writes:`; none = refused, the error says to
// add `writes:`); when agent.config.reads is set (agent.md `reads:` — the critic's "outputs only" lane) every read,
// list, search and focus must fall in it, and the holder's prompt shows only what it may read. Globs are the
// terminal sandbox's (companion/capabilities/sandbox.js laneRegex): * within a folder, ** across, a trailing / = all
// below it, "!glob" excludes. .env* (but .env.example) and .mcp.json are never read or written.
//
// The machine only through an adapter: the default is the host (ctx.host: GET fs/list, fs/read, POST fs/write — the
// tree is built from fs/list, which carries sizes and times); a desk may pass its own (BUILTIN.artifacts.files({adapter})):
//   {list(path, ctx) → [{name, type: dir|file|link|other, size, mtime}], read(path, ctx) → {text, binary, truncated,
//    size, revision} | null, write(path, text, {revision}, ctx) → {revision, created}, tree?(root, ctx) → {tree, truncated}}
//
// refresh(agent) (before each step, coalesced across holders, at most every REFRESH_MS unless a write made it stale)
// pulls the tree under the root; changed() only when the twin state differs.
// Twin state: {root, tree: [{path, size, mtime, dir}] ≤ 800, truncated, open: [{path, by, at}] ≤ 12,
//   modified: [{path, by, at, op: create | write | edit | append, added, removed, diff ≤ 80 lines}] ≤ 30 (one per path,
//   its latest change; newest last), focus: {path, by, at} | null} — workspace paths throughout.

const TREE_MAX = 800 // entries in the twin's tree
const TREE_DEPTH = 8 // folder levels the tree walks below its root
const OPEN_MAX = 12
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
// LAST segment covers any rest, none too (the folder itself); a ** between segments covers any run of them; outer *
// covers one inner segment without **; an outer segment with * or ? inside covers an equal one or one it matches as a
// glob (an inner * is never taken for a ?); a literal covers only an equal segment; an inner ** only an outer **.
// Conservative: when unsure, false. A "!glob" or an empty one is not a lane: false.
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
      if (a === o.length - 1) return true
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

export const hostFiles = {
  async list(path, ctx) {
    const r = await hostOf(ctx).get(`fs/list?path=${encodeURIComponent(path)}`, { signal: ctx?.signal })
    return r?.entries ?? []
  },
  async read(path, ctx) {
    try {
      return await hostOf(ctx).get(`fs/read?path=${encodeURIComponent(path)}`, { signal: ctx?.signal })
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
  let truncated = false
  let level = [root]
  for (let d = 0; d < depth && level.length && !truncated; d++) {
    const next = []
    // A level's folders PARALLEL at a time, in order, until the tree is full (no folder listed for nothing).
    for (let i = 0; i < level.length && !truncated; i += PARALLEL) {
      const batch = level.slice(i, i + PARALLEL)
      const lists = await mapLimit(batch, PARALLEL, async (dir) => [dir, d === 0 ? await adapter.list(dir, ctx) : await adapter.list(dir, ctx).catch(() => [])])
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
  return { tree, truncated }
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

const ctxOf = (agent) => ({ ...(agent?.context ?? {}), agent })
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
const withNewline = (t) => (t && !t.endsWith("\n") ? `${t}\n` : t) // a <<< >>> block loses its last newline

export class Files extends Artifact {
  constructor({ id = "files", title, root = "", adapter = hostFiles, clock = () => new Date() } = {}) {
    super({ name: id, title: title ?? (id === "files" ? "files — the workspace" : `${id} — files`) })
    this.kind = "files"
    this.view = "files"
    this.keep = "always" // open and modified tabs survive a restart; the tree is pulled again
    this.adapter = adapter
    this.clock = clock
    this.state = { root: cleanPath(root), tree: [], truncated: false, open: [], modified: [], focus: null }
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
      open: arr(data.open).slice(-OPEN_MAX),
      modified: arr(data.modified).slice(-MODIFIED_MAX),
      focus: data.focus && typeof data.focus.path === "string" ? data.focus : null,
    }
    this.stale = true
  }

  async refresh(agent) {
    if (this.pulling) return this.pulling
    if (!this.stale && Date.now() - this.pulled < REFRESH_MS) return
    this.pulling = this.#pull(ctxOf(agent)).finally(() => (this.pulling = null))
    return this.pulling
  }

  async #pull(ctx) {
    const root = this.state.root
    let got
    try {
      got = this.adapter.tree ? await this.adapter.tree(root, ctx) : await walkTree(this.adapter, root, ctx)
    } catch (e) {
      throw new Error(`the tree of ${root || "the workspace"}/: ${hostError(e)}`)
    }
    this.pulled = Date.now()
    this.stale = false
    if (root !== this.state.root) return // focused elsewhere meanwhile: the next pull reads it
    this.#set({ tree: (got?.tree ?? []).slice(0, TREE_MAX), truncated: !!got?.truncated || (got?.tree?.length ?? 0) > TREE_MAX })
  }

  #opened(path, by) {
    const at = this.clock().toISOString()
    this.#set({ open: [...this.state.open.filter((o) => o.path !== path), { path, by, at }].slice(-OPEN_MAX) })
  }

  #changed(path, by, op, before, after) {
    const { diff, added, removed, lines } = lineDiff(before, after)
    const at = this.clock().toISOString()
    this.stale = true
    this.#set({ modified: [...this.state.modified.filter((m) => m.path !== path), { path, by, at, op, added, removed, diff }].slice(-MODIFIED_MAX) })
    return { added, removed, lines }
  }

  // ---- lanes ----

  #writable(agent, path) {
    const p = cleanPath(path)
    if (!p) throw new Error("path: the file to write")
    if (secret(p)) throw new Error(`${p}: ASKK's configuration (.env*, .mcp.json) — agents never write it`)
    const writes = list(agent?.config?.writes)
    if (!writes.length) throw new Error(`${agent?.name ?? "this agent"} has no write lane: add writes: [globs] to its agent.md (e.g. writes: ["projects/**"]) — nothing is written without one`)
    if (!inLane(writes, p)) throw new Error(`${agent.name} writes only ${writes.join(", ")} (its writes:) — ${p} is outside its lane`)
    return p
  }

  // A file this holder may read (reads: set → in it), or a folder it may look into (one that may hold such a file).
  #readable(agent, path, folder = false) {
    const p = cleanPath(path)
    if (!folder && secret(p)) throw new Error(`${p}: ASKK's configuration (.env*, .mcp.json) — agents never read it`)
    const reads = agent?.config?.reads
    if (reads == null) return p
    if (folder ? !mayContain(reads, p) && !inLane(reads, p) : !inLane(reads, p)) throw new Error(`${agent.name} reads only ${list(reads).join(", ")} (its reads:) — ${p || "the workspace"}${folder ? "/" : ""} is outside its lane`)
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
    let entries
    try {
      entries = await this.adapter.list(p, ctx)
    } catch (e) {
      throw new Error(`${p || "."}/: ${hostError(e)}`)
    }
    const shown = [...entries].filter((e) => e?.name && this.#sees(ctx.agent, join(p, e.name), e.type === "dir")).sort(byName)
    const lines = shown.slice(0, LIST_MAX).map((e) => (e.type === "dir" ? `${e.name}/${SKIP.has(e.name) ? " …" : ""}` : `${e.name}  ${size(Number(e.size) || 0)}`))
    const more = shown.length > LIST_MAX ? `\n… ${shown.length - LIST_MAX} more` : ""
    return `${p || "."}/ — ${shown.length} entr${shown.length === 1 ? "y" : "ies"}\n${lines.join("\n") || "(empty)"}${more}`
  }

  async #read({ path, from, lines } = {}, ctx = {}) {
    if (!String(path ?? "").trim()) throw new Error("path: the file to read")
    const p = this.#readable(ctx.agent, path)
    let file
    try {
      file = await this.adapter.read(p, ctx)
    } catch (e) {
      throw new Error(`${p}: ${hostError(e)}`)
    }
    if (!file) throw new Error(`${p}: no such file`)
    this.#opened(p, ctx.agent?.name ?? null)
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
  async #before(p, ctx) {
    try {
      return await this.adapter.read(p, ctx)
    } catch (e) {
      throw new Error(`${p}: ${hostError(e)}`)
    }
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
    const d = this.#changed(p, ctx.agent?.name ?? null, op, before && !before.binary ? before.text : null, text)
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
    const d = this.#changed(p, ctx.agent?.name ?? null, "edit", text, after)
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
    const d = this.#changed(p, ctx.agent?.name ?? null, "append", before ? was : null, after)
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
    const read = await mapLimit(files, PARALLEL, (f) => this.adapter.read(f.path, ctx).catch(() => null))
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
    return hits.length ? `${hits.length}${hits.length >= SEARCH_HITS ? "+" : ""} lines hold "${q}" (${scope})\n${hits.join("\n")}` : `no line holds "${q}" (${scope})`
  }

  async #focus({ path } = {}, ctx = {}) {
    const p = this.#readable(ctx.agent, path ?? "", true)
    try {
      await this.adapter.list(p, ctx) // a folder that exists
    } catch (e) {
      throw new Error(`${p || "."}/: ${hostError(e)}`)
    }
    this.stale = true
    this.#set({ root: p, focus: { path: p, by: ctx.agent?.name ?? null, at: this.clock().toISOString() } })
    await this.#pull(ctx)
    const files = this.state.tree.filter((e) => !e.dir).length
    return `the tree shows ${p || "the workspace"}/ now: ${files} file${files === 1 ? "" : "s"}${this.state.truncated ? " (more not listed)" : ""}`
  }

  commands() {
    const tool = (name, description, input, run) => new Tool({ name: `${this.name}.${name}`, type: "dev", view: "files", description, input, run })
    return [
      tool("list", "list a folder: names, / for folders, sizes", { path: `a folder (default: the tree's root)` }, (i, c) => this.#list(i, c)),
      tool("read", "read a file with line numbers (it shows as open); from/lines for a slice of a big one", { path: "the file", from: "first line (default 1)", lines: "how many (default all)" }, (i, c) => this.#read(i, c)),
      tool("write", "write a whole file (folders are created); only inside your writes: lane", { path: "the file", content: "its full text" }, (i, c) => this.#write(i, c)),
      tool("edit", "replace one exact passage of a file (old must match once, whitespace included; all: true replaces each)", { path: "the file", old: "the exact text now", new: "its replacement", all: "true: every match (optional)" }, (i, c) => this.#edit(i, c)),
      tool("append", "add text at the end of a file (created if missing)", { path: "the file", text: "the lines to add" }, (i, c) => this.#append(i, c)),
      tool("search", "find the lines that hold a text (case-insensitive) in the files under a folder, or in one file", { text: "what to look for", path: "a folder, or one file (default: the tree's root)" }, (i, c) => this.#search(i, c)),
      tool("focus", "show another folder as the tree's root (for every holder)", { path: "the folder (\"\" = the workspace)" }, (i, c) => this.#focus(i, c)),
    ]
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
    const own = (c) => !agent || agent.tools?.has(`${this.name}.${c}`)
    const can = ["list", "read", "write", "edit", "append", "search", "focus"].filter(own).map((c) => `${this.name}.${c}`)
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
    const open = s.open.filter((o) => sees({ path: o.path, dir: false }))
    if (open.length) out.push(`OPEN ${open.map((o) => `${o.path}${o.by ? ` (${o.by})` : ""}`).join(", ")}`)
    const modified = s.modified.filter((m) => sees({ path: m.path, dir: false })).slice(-PROMPT_MODIFIED)
    if (modified.length) out.push("MODIFIED (newest last)", ...modified.map((m) => `  ${m.path} ${m.op} by ${m.by ?? "?"} +${m.added} -${m.removed}`))
    return out.join("\n")
  }
}
