// The Live page's workbench (components/live/workbench/): what its panes show, from the twins of the desk's inbuilt
// artifacts (backend/kernel/builtin: files, terminal, preview) — pure, tested (workbench.test.js). The panes only
// draw what these return.
//
//   twins (kernel-team.js `{id, view, state, holders, …}`):
//     files     {root, tree: [{path, size, mtime, dir}], truncated, open: [{path, by, at}], modified: [{path, by, at,
//                op, added, removed, diff}], focus: {path, by, at} | null}
//     terminal  {sessions: [{id, name, command, cwd, agent, slot, lease, runs, status, exit, startedAt, endedAt, urls,
//                tail}]}
//     preview   {pages: [{id, url, title, status, by, at, shot: {n, at, width, height, url} | null, console, errors}]}
//
//   hasWorkbench(artifacts), pickWorkbench(artifacts) → {files, terminal, preview, others}
//   workbenchTabs({files, preview, pinned, dismissed, max}) → tabs, preview pages first, then files newest first
//   mergeSessions(twin, polled) → the terminal's sessions, the twin's with what term/list polls know sooner
//   sessionTabs(sessions) → the Terminal pane's tabs: at most two per agent (its main and long sessions), stable order
//   sessionLabel(session) → a tab's name: "coder · main", else the session's name
//   followTab(tabs), noteOutput(seen, sessions, now), followSession(sessions, seen, {tieMs}), followShot(pages)
//   choose({following, chosen, followed, shown, ids}) → the id a pane shows
//   paneIds({following, chosen, frozen, followed, lists}) → {tab, file, page, session}: what every pane shows
//   fullPath(root, path), twinTree(files), flattenTree(base, entries), fileMarks(files), treeRows(entries, …)
//   fileLines(text, max), diffRows(diff), changedLines(text, diff, {added}) → Set of 1-based lines the diff added
//   (past the twin's 80-line cut too), diffCut(diff, {added, removed}) → what that cut left out, or null
//   shotSrc(shot), consoleErrors(page), canFrame(url, self)

import { withBase } from "@/backend/live/base-path"
import { LIMITS } from "@/lib/config"

export const WORKBENCH_VIEWS = ["files", "terminal", "preview"]

// ISO text or ms → ms (0 when unknown), so twins from either clock sort together.
export const toMs = (at) => (typeof at === "number" ? at : Date.parse(at ?? "") || 0)
const baseName = (path) => String(path).split("/").filter(Boolean).at(-1) ?? String(path)

export const hasWorkbench = (artifacts) => Object.values(artifacts ?? {}).some((a) => WORKBENCH_VIEWS.includes(a?.view))

// The one artifact per pane: the desk's shared one (id = its view), else the first by id. Every other artifact
// (plan, boards, a second files artifact …) is drawn as a card in the side slot's Artifacts tab.
export function pickWorkbench(artifacts) {
  const all = Object.values(artifacts ?? {}).filter((a) => a?.id)
  const one = (view) => all.find((a) => a.view === view && a.id === view) ?? all.filter((a) => a.view === view).sort((a, b) => a.id.localeCompare(b.id))[0] ?? null
  const panes = { files: one("files"), terminal: one("terminal"), preview: one("preview") }
  const shown = new Set(Object.values(panes).filter(Boolean).map((a) => a.id))
  return { ...panes, others: Object.fromEntries(all.filter((a) => !shown.has(a.id)).map((a) => [a.id, a])) }
}

// The tab strip: one tab per preview page, then every open or modified file (and the ones the owner opened from the
// tree: `pinned` [{path, at}]), one tab per path, newest first. `dismissed` (Map path → ms): a tab the owner closed
// stays closed until its file is opened or modified again.
//   file tab    {id: "file:<path>", kind: "file", path, name, at, open, modified, pinned}
//   preview tab {id: "preview:<page id>", kind: "preview", page, name, at, closed}
export function workbenchTabs({ files, preview, pinned = [], dismissed = new Map(), max = LIMITS.ui.workbench.maxTabs } = {}) {
  const state = files?.state ?? {}
  const byPath = new Map()
  const add = (path, at, patch = {}) => {
    if (!path) return
    const ms = toMs(at)
    const prev = byPath.get(path) ?? { id: `file:${path}`, kind: "file", path, name: baseName(path), at: 0, open: null, modified: null, pinned: false }
    const next = { ...prev, at: Math.max(prev.at, ms) }
    // the newest entry of each kind wins (a file modified twice shows its last change)
    for (const [k, v] of Object.entries(patch)) if (k === "pinned" ? v : !prev[k] || toMs(v?.at) >= toMs(prev[k]?.at)) next[k] = v
    byPath.set(path, next)
  }
  for (const o of state.open ?? []) add(o?.path, o?.at, { open: o })
  for (const m of state.modified ?? []) add(m?.path, m?.at, { modified: m })
  for (const p of pinned) add(p?.path, p?.at, { pinned: true })
  const fileTabs = [...byPath.values()]
    .filter((t) => !(dismissed.get(t.path) >= t.at))
    .sort((a, b) => b.at - a.at || a.path.localeCompare(b.path))
    .slice(0, max)
  const pageTabs = (preview?.state?.pages ?? [])
    .filter((p) => p?.id != null)
    .map((page) => ({ id: `preview:${page.id}`, kind: "preview", page, name: page.title || hostOf(page.url) || `page ${page.id}`, at: Math.max(toMs(page.shot?.at), toMs(page.at)), closed: page.status === "closed" }))
    .sort((a, b) => b.at - a.at)
  return [...pageTabs, ...fileTabs]
}

const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch {
    return ""
  }
}

// Following, the editor shows the newest activity: the file last opened or modified, or the page last shot.
export function followTab(tabs) {
  let best = null
  for (const t of tabs ?? []) if (!best || t.at > best.at) best = t
  return best?.id ?? null
}

// The Terminal pane's sessions, newest first: the twin's, with what term/list polls (TermActivity) know sooner — a
// session's end, a slot session's next command (`runs` higher), and sessions the twin has not listed yet (it changes
// only when an agent refreshes it; 2026-10-17: a 19-second eval the coder ran reached the twin half a minute after it
// ended). A polled session older than the twin's oldest stays out (the twin lists the newest only).
export function mergeSessions(twin = [], polled = null) {
  if (!polled?.length) return twin
  const byId = new Map(polled.filter((p) => p?.id != null).map((p) => [p.id, p]))
  const listed = new Set(twin.map((s) => s?.id))
  const oldest = twin.length ? Math.min(...twin.map((s) => toMs(s?.startedAt))) : 0
  const merged = twin.map((s) => {
    const p = byId.get(s?.id)
    if (!p) return s
    if ((p.runs ?? 1) > (s.runs ?? 1)) return { ...s, ...p } // its next command: every field the poll's
    return s.status === "running" && p.status && p.status !== "running" && (p.runs ?? 1) === (s.runs ?? 1) ? { ...s, status: p.status, exit: p.exit ?? null, endedAt: p.endedAt ?? s.endedAt } : s
  })
  const fresh = [...byId.values()].filter((p) => !listed.has(p.id) && toMs(p.startedAt) >= oldest)
  return [...fresh, ...merged].sort((a, b) => toMs(b.startedAt) - toMs(a.startedAt))
}

// The Terminal pane's tabs (2026-10-17 owner: a tab per command buried the work): at most two per agent — its main
// session (the commands it runs) and its long one (the run it keeps going) — in a stable order: by agent (the owner's
// last), main before long, so a tab never jumps when the other one runs. A session without a slot (the owner's, an
// earlier server's) counts as its agent's long one while it runs, else its main one; of each agent's main and long the
// newest is shown (`sessions` newest first, as mergeSessions returns them).
const SLOT_ORDER = { main: 0, long: 1 }
const slotKind = (s) => String(s.slot ?? (s.status === "running" ? "long" : "main")).split(".").at(-1)
export function sessionTabs(sessions = []) {
  const seen = new Set()
  const tabs = []
  for (const s of sessions) {
    if (s?.id == null) continue
    const key = `${s.agent ?? ""}\u0000${slotKind(s)}`
    if (seen.has(key)) continue
    seen.add(key)
    tabs.push(s)
  }
  const agentKey = (s) => (s.agent == null ? "\uffff" : String(s.agent))
  return tabs.sort((a, b) => agentKey(a).localeCompare(agentKey(b)) || (SLOT_ORDER[slotKind(a)] ?? 2) - (SLOT_ORDER[slotKind(b)] ?? 2))
}

export const sessionLabel = (s) => (s?.slot ? `${s.agent ?? "owner"} · ${s.slot}` : s?.name || s?.command || s?.id || "")

// When each session's output last changed, as this tab saw it (the host lists tails, not times): Map id → {sig, at}.
// `sessions` come from term/list polls (TermActivity, term-stream.js) or, without them, the terminal twin — which
// changes only when an agent refreshes it, so a running session's tail sits still while its agent waits. A running
// session counts from now when first seen or changed; an ended one never later than its end (2026-10-17: the twin
// brought r06's exit after r07 had started, and the exit outranked the run that was printing).
const outputSig = (s) => `${s.status}|${s.exit ?? ""}|${(s.tail ?? []).slice(-2).join("\n")}`
const endedAt = (s) => (s.status === "running" ? 0 : toMs(s.endedAt))
export function noteOutput(seen = new Map(), sessions = [], now = Date.now()) {
  const next = new Map()
  for (const s of sessions) {
    if (s?.id == null) continue
    const sig = outputSig(s)
    const prev = seen.get(s.id)
    if (prev?.sig === sig) {
      next.set(s.id, prev)
      continue
    }
    const end = endedAt(s)
    next.set(s.id, { sig, at: s.status === "running" ? now : end ? Math.min(now, end) : prev ? now : toMs(s.startedAt) })
  }
  return next
}

// Following, the terminal shows the session with the newest output. Output within `tieMs` of the newest counts as
// just as new (a poll or a twin sees it seconds late); among those, the session started last, then a running one —
// so the run an agent just started wins over the commit beside it, and a quiet server never hides a fresh command.
export function followSession(sessions = [], seen = new Map(), { tieMs = LIMITS.ui.workbench.followTieMs } = {}) {
  const rows = []
  for (const s of sessions) {
    if (s?.id == null) continue
    const at = seen.get(s.id)?.at ?? (endedAt(s) || toMs(s.startedAt))
    rows.push({ id: s.id, at, started: toMs(s.startedAt), running: s.status === "running" ? 1 : 0 })
  }
  if (!rows.length) return null
  const newest = Math.max(...rows.map((r) => r.at))
  let best = null
  for (const r of rows) {
    if (r.at < newest - tieMs) continue
    if (!best || r.started > best.started || (r.started === best.started && (r.running > best.running || (r.running === best.running && r.at > best.at)))) best = r
  }
  return best.id
}

// Following, the preview shows the page shot last.
export function followShot(pages = []) {
  let best = null
  for (const p of pages) {
    if (p?.id == null) continue
    const at = Math.max(toMs(p.shot?.at), toMs(p.at))
    if (!best || at > best.at) best = { id: p.id, at }
  }
  return best?.id ?? null
}

// The id a pane shows: while follow is paused, the owner's pick in that pane, else what it showed when follow paused
// (`shown`) — any click of the owner's freezes every pane (2026-10-17: a click on an editor tab left the terminal
// following) — while it still exists; else the followed one.
export function choose({ following, chosen, followed, shown = null, ids = [] }) {
  const has = (id) => id != null && ids.includes(id)
  if (!following && has(chosen)) return chosen
  if (!following && has(shown)) return shown
  if (has(followed)) return followed
  return has(chosen) ? chosen : (ids[0] ?? null)
}

// What every pane shows, {tab, file, page, session}: `followed` and `lists` (each pane's ids) by pane; `chosen` the
// owner's picks; `frozen` what the panes showed when follow paused — freeze it with paneIds({following: true, …}).
export const PANES = ["tab", "file", "page", "session"]
export function paneIds({ following, chosen = {}, frozen = null, followed = {}, lists = {} }) {
  return Object.fromEntries(PANES.map((k) => [k, choose({ following, chosen: chosen?.[k], followed: followed[k], shown: frozen?.[k], ids: lists[k] ?? [] })]))
}

// A path from the files twin as a workspace path (what fs/read takes): its tree may list paths under `root`
// relative to it; open/modified paths are workspace paths already.
export function fullPath(root, path) {
  const r = String(root ?? "").replace(/^\/+|\/+$/g, "")
  const p = String(path ?? "").replace(/^\/+/, "")
  if (!r || p === r || p.startsWith(`${r}/`)) return p
  return `${r}/${p}`
}

export const twinTree = (files) => (files?.state?.tree ?? []).filter((e) => e?.path).map((e) => ({ ...e, path: fullPath(files.state.root, e.path) }))

// fs/tree's nested entries ({name, type, children?, skipped?}) as the twin's flat list ({path, dir}).
export function flattenTree(base, entries = []) {
  const out = []
  const walk = (dir, list) => {
    for (const e of list ?? []) {
      if (!e?.name || e.type === "omitted") continue
      const path = dir ? `${dir}/${e.name}` : e.name
      out.push({ path, dir: e.type === "dir", ...(e.skipped ? { skipped: true } : {}) })
      if (e.children) walk(path, e.children)
    }
  }
  walk(String(base ?? "").replace(/^\/+|\/+$/g, ""), entries)
  return out
}

// path → "modified" | "open" | "focus" (modified wins: it is what the owner most wants to see).
export function fileMarks(files) {
  const s = files?.state ?? {}
  const marks = new Map()
  if (s.focus?.path) marks.set(s.focus.path, "focus")
  for (const o of s.open ?? []) if (o?.path) marks.set(o.path, "open")
  for (const m of s.modified ?? []) if (m?.path) marks.set(m.path, "modified")
  return marks
}

// The visible rows of the Files tree: folders first, then files, by name; a folder is open when the owner opened it
// (`toggled` Map path → bool), else when it holds a marked file or is the root's child — not a dot-folder or one the
// host does not expand (.git, .venv, caches: 2026-10-17, they buried the project's own files). Paths under `root` only.
//   row {path, name, depth, dir, expanded?, mark: modified | open | focus | null, inside: a marked file below}
export function treeRows(entries = [], { root = "", marks = new Map(), toggled = new Map() } = {}) {
  const base = String(root ?? "").replace(/^\/+|\/+$/g, "")
  const under = (p) => !base || p.startsWith(`${base}/`)
  const rel = (p) => (base ? p.slice(base.length + 1) : p)
  const nodes = new Map() // rel path → {path, name, dir, kids}
  const top = { kids: new Map() }
  const node = (relPath, dir, abs, skipped = false) => {
    if (nodes.has(relPath)) {
      if (dir) nodes.get(relPath).dir = true
      if (skipped) nodes.get(relPath).skipped = true
      return nodes.get(relPath)
    }
    const parts = relPath.split("/")
    const parent = parts.length > 1 ? node(parts.slice(0, -1).join("/"), true, abs.split("/").slice(0, -1).join("/")) : top
    const n = { path: abs, name: parts.at(-1), dir, skipped, kids: new Map() }
    nodes.set(relPath, n)
    parent.kids.set(n.name, n)
    return n
  }
  for (const e of entries) if (e?.path && under(e.path) && rel(e.path)) node(rel(e.path), !!e.dir, e.path, !!e.skipped)
  const inside = new Set()
  for (const path of marks.keys()) {
    if (!under(path)) continue
    const parts = rel(path).split("/")
    for (let i = 1; i < parts.length; i++) inside.add(base ? `${base}/${parts.slice(0, i).join("/")}` : parts.slice(0, i).join("/"))
  }
  const rows = []
  const walk = (n, depth) => {
    const kids = [...n.kids.values()].sort((a, b) => (b.dir ? 1 : 0) - (a.dir ? 1 : 0) || a.name.localeCompare(b.name))
    for (const k of kids) {
      const quiet = k.name.startsWith(".") || k.skipped
      const expanded = k.dir ? (toggled.has(k.path) ? toggled.get(k.path) : inside.has(k.path) || (depth === 0 && !quiet)) : undefined
      rows.push({ path: k.path, name: k.name, depth, dir: k.dir, ...(k.dir ? { expanded } : {}), mark: marks.get(k.path) ?? null, inside: inside.has(k.path) })
      if (expanded) walk(k, depth + 1)
    }
  }
  walk(top, 0)
  return rows
}

// A file's text as the editor's lines, at most `max`: {lines, cut} (cut: lines left out).
export function fileLines(text, max = LIMITS.ui.workbench.fileLines) {
  if (text == null) return { lines: [], cut: 0 }
  const all = String(text).split("\n")
  return { lines: all.length > max ? all.slice(0, max) : all, cut: Math.max(0, all.length - max) }
}

// The files twin's diff ("+" added, "-" removed, " " context; "@@ -a,b +c,d @@" hunk heads when there are any; a "…"
// line where it was cut) as rows {op: + | - | " " | @ | …, text}.
export function diffRows(diff) {
  const lines = String(diff ?? "").split("\n")
  if (lines.at(-1) === "") lines.pop()
  return lines.map((l) => {
    if (l.startsWith("@@")) return { op: "@", text: l }
    if (/^\s?(…|\.\.\.|⋯)/.test(l)) return { op: "…", text: l.trim() }
    if (l[0] === "+" || l[0] === "-") return { op: l[0], text: l.slice(1) }
    return { op: " ", text: l[0] === " " ? l.slice(1) : l }
  })
}

// A diff with hunk heads, walked: `seen` the new-side numbers of its "+" rows; `cut` the added lines a cut inside a
// hunk left out ({from, to}, 1-based, inclusive; null when none). The files twin caps a diff at 80 lines and writes
// one hunk as context, removed, added, context — so a whole-file rewrite loses its added side first. They follow
// the rows shown and end with the hunk's new side, less its trailing context when `added` (the change's count) is
// known and the diff is one hunk.
function walkHunks(rows, added) {
  const heads = rows.filter((r) => r.op === "@").length
  const seen = []
  let cut = null
  let n = 0
  let start = 0
  let size = 0
  let lead = 0
  let leading = true
  for (const r of rows) {
    if (r.op === "@") {
      const m = /\+(\d+)(?:,(\d+))?/.exec(r.text)
      start = n = Number(m?.[1] ?? 1)
      size = m?.[2] == null ? 1 : Number(m[2])
      lead = 0
      leading = true
    } else if (r.op === "+") {
      seen.push(n++)
      leading = false
    } else if (r.op === "-") leading = false
    else if (r.op === " ") {
      n++
      if (leading) lead++
    } else if (r.op === "…" && !cut && start + size > 0) {
      const to = heads === 1 && Number.isFinite(added) ? start + lead + added - 1 : start + size - 1
      if (to >= n) cut = { from: n, to }
    }
  }
  return { seen, cut }
}

// The lines of `text` (1-based) the diff added, so the editor highlights them in the whole file. With hunk heads, by
// their numbers — a hunk the cap cut counts its added lines past the cut too (`added`: the change's count, see
// walkHunks); without, each run of context + added lines is found in the text (in order); when a run is not there
// (the file changed since), added lines are matched by their text.
export function changedLines(text, diff, { added } = {}) {
  const lines = String(text ?? "").split("\n")
  const rows = diffRows(diff)
  const out = new Set()
  if (rows.some((r) => r.op === "@")) {
    const { seen, cut } = walkHunks(rows, added)
    seen.forEach((i) => out.add(i))
    if (cut) for (let i = cut.from; i <= Math.min(cut.to, lines.length); i++) out.add(i)
    return new Set([...out].filter((i) => i >= 1 && i <= lines.length))
  }
  // runs of the new text: context and added lines, split where the diff was cut
  const runs = [[]]
  for (const r of rows) {
    if (r.op === "…") runs.push([])
    else if (r.op !== "-") runs.at(-1).push(r)
  }
  let from = 0
  const loose = []
  for (const run of runs) {
    if (!run.some((r) => r.op === "+")) continue
    let best = { at: -1, len: 0 }
    for (let i = from; i < lines.length; i++) {
      let k = 0
      while (k < run.length && i + k < lines.length && lines[i + k] === run[k].text) k++
      if (k > best.len) best = { at: i, len: k }
      if (k === run.length) break
    }
    if (coversAdded(run, best.len)) {
      run.slice(0, best.len).forEach((r, k) => r.op === "+" && out.add(best.at + k + 1))
      loose.push(...run.slice(best.len).filter((r) => r.op === "+"))
      from = best.at + best.len
    } else loose.push(...run.filter((r) => r.op === "+"))
  }
  const wanted = new Set(loose.map((r) => r.text).filter((t) => t.trim().length >= 2))
  lines.forEach((l, i) => wanted.has(l) && out.add(i + 1))
  return out
}

// A match (whole or a prefix of the run) counts when it covers at least one added line.
const coversAdded = (run, len) => run.slice(0, len).some((r) => r.op === "+")

// What the files twin's cap left out of a diff, for the diff view to say: null when it was not cut, else {more (rows
// cut), added: {shown, total}, removed: {shown, total} (total null when the change's count is not known), range: the
// added lines past the cut ({from, to} in the new text, or null)}.
export function diffCut(diff, { added, removed } = {}) {
  const rows = diffRows(diff)
  const tail = rows.findLast((r) => r.op === "…")
  if (!tail) return null
  const count = (op) => rows.filter((r) => r.op === op).length
  const side = (shown, total) => ({ shown, total: Number.isFinite(total) ? Math.max(total, shown) : null })
  return {
    more: Number(/\d+/.exec(tail.text)?.[0] ?? 0),
    added: side(count("+"), added),
    removed: side(count("-"), removed),
    range: rows.some((r) => r.op === "@") ? walkHunks(rows, added).cut : null,
  }
}

// The page's latest screenshot as an <img> src: the host serves each shot under its own n, so a new shot is a new URL.
export function shotSrc(shot) {
  if (!shot?.url) return null
  if (/^(data|blob):/i.test(shot.url)) return shot.url // an inline image (a test, another host): as it is
  const url = /[?&]n=/.test(shot.url) ? shot.url : `${shot.url}${shot.url.includes("?") ? "&" : "?"}n=${shot.n ?? 0}`
  return withBase(url)
}

// The page's console errors (console lines at level error, and page errors when the host lists them).
export function consoleErrors(page) {
  const lines = (page?.console ?? []).filter((l) => l && (l.level === "error" || l.level === "pageerror"))
  const extra = Array.isArray(page?.errors) ? page.errors.map((e) => (typeof e === "string" ? { level: "error", text: e } : e)) : []
  const count = typeof page?.errors === "number" ? Math.max(page.errors, lines.length) : lines.length + extra.length
  return { lines: [...lines, ...extra], count }
}

// The page a "live" preview may frame: the app on this machine (loopback http), never this UI itself.
export function canFrame(url, self = null) {
  try {
    const u = new URL(url)
    if (!/^https?:$/.test(u.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return false
    return !self || u.origin !== new URL(self).origin
  } catch {
    return false
  }
}
