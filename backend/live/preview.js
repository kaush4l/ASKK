// The preview's twin on the UI (kernel builtin/preview.js; 2026-10-17 owner: "it is not supposed to be stage. It is
// also supposed to be a live artifact … The preview is exactly what I mean … There will be need for only one preview
// pane"): what the one pane shows — the pages the desk opened (its live UI, a training dashboard, a build's page) and
// the visuals the agents draw to explain (a spec, a file read live, a terminal session's stream) — the item in the pane
// now (`current`), and the owner's questions on it with the answers. 2026-10-18 owner ("preview can enlarge to a web
// page"; the charts artifact is gone — a training run's live dashboard is a page here): a page enlarges to the whole
// viewport, live (enlargeOf), and the pane shows a page live by default where it can be framed (pageMode). It talks two ways:
// with a page in the owner's frame (postMessage) and with the desk (team/call target artifact). Pure, so tested
// without a tab (preview.test.js); components/live/workbench/preview-pane.jsx draws what these return.
//
//   twin state {pages: [{id, url, title, status, by, at, shot, console, errors}], visuals: [{id, title, says, visual,
//     by, at, error?, read_at?}], current: {kind: page | visual, id, view?} | null, asks: [{id, text, on: {kind, id} |
//     null, context, from, at, answer: {text, on, by, at} | null}], revision}
//   An old twin (before the restart: pages only, no visuals / current / asks) still reads: its newest shot page is the
//   current one, and it takes no questions (askable false).
//   2026-10-17 (drill-down, bound scripts): an entry's template?, params?, bind? {command, watch, running, ran_at, exit,
//   ms, error, waiting, …}; current.params; trail [{kind, id, params?}] ≤ 8. A visual's elements carry `open` links
//   ({id, params} — "{x}" filled from the clicked point: linkFor); openPreview / backPreview / rerunPreview are the
//   owner's calls (team/call target artifact, like askPreview); trailOf is the breadcrumb, bindLine the bound script's
//   line.
//
// The page contract (the desk's skill `preview` tells the agents the same; the wire word stays "scene", which pages
// built before 2026-10-17 speak):
//   UI → page    {askk: "scene", scene: {id, view, title, params}}   show that view; the frame's #<view> moves too
//   page → UI    {askk: "at", view, views?}                          the page shows `view` now (its views listed)
//                {askk: "ask", context, text?}                       the owner pointed at something to ask about
// Only messages from the frame's own window and origin count, and an "ask" only fills the ask box: the owner sends it.

import { teamCall } from "@/backend/live/stream"

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"])
const WORD = /^[a-z0-9][a-z0-9_-]{0,31}$/i
const CONTEXT_MAX = 1000 // chars of JSON, as the kernel keeps
const TEXT_MAX = 500

const toMs = (at) => (typeof at === "number" ? at : Date.parse(at ?? "") || 0)

// The desk's preview artifact (view preview); `id` picks one when a desk keeps several, else the shared one ("preview").
export function previewOf(artifacts, id = null) {
  const all = Object.values(artifacts ?? {}).filter((a) => a?.view === "preview")
  return (id ? all.find((a) => a.id === id) : null) ?? all.find((a) => a.id === "preview") ?? all[0] ?? null
}

// An item's key in the pane ("page:p1", "visual:loss"); null for nothing.
export const itemKey = (ref) => (ref?.kind && ref?.id != null ? `${ref.kind}:${ref.id}` : null)

// What a visual entry draws: a checked spec (`kind`; a file visual the kernel read carries `file` too), a file not
// read yet, a terminal session's live output — else nothing (an old {chart} twin, from before 2026-10-18, too).
//   → {type: spec | file | terminal | none, ref}
export function visualSource(visual) {
  if (!visual || typeof visual !== "object") return { type: "none", ref: null }
  if (visual.terminal != null) return { type: "terminal", ref: String(visual.terminal) }
  if (visual.kind) return { type: "spec", ref: visual.file ?? null }
  if (visual.file) return { type: "file", ref: String(visual.file) }
  return { type: "none", ref: null }
}

// The pane's items in the strip: the pages (as the host lists them), then the visuals (as the agents drew them).
//   → [{key, kind: page | visual, id, title, at, page | entry, source}]
export function previewItems(state) {
  const pages = (state?.pages ?? [])
    .filter((p) => p?.id != null)
    .map((page) => ({ key: itemKey({ kind: "page", id: page.id }), kind: "page", id: String(page.id), title: page.title || hostOf(page.url) || `page ${page.id}`, at: Math.max(toMs(page.shot?.at), toMs(page.at)), page, source: "page" }))
  const visuals = (state?.visuals ?? [])
    .filter((v) => v?.id != null)
    .map((entry) => ({ key: itemKey({ kind: "visual", id: entry.id }), kind: "visual", id: String(entry.id), title: entry.title || entry.visual?.title || entry.id, at: Math.max(toMs(entry.at), toMs(entry.read_at)), entry, source: visualSource(entry.visual).type }))
  return [...pages, ...visuals]
}

const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch {
    return ""
  }
}

// The item the agents put in the pane (preview.show / focus / answer / open): the twin's `current`; without one (an
// old twin, or nothing put there yet) the newest shot page. → {kind, id, view} | null
export function currentRef(state) {
  const c = state?.current
  if (c && typeof c === "object" && c.kind && c.id != null) return { kind: c.kind, id: String(c.id), view: c.view ?? null, ...(c.params && typeof c.params === "object" && Object.keys(c.params).length ? { params: c.params } : {}) }
  let best = null
  for (const p of state?.pages ?? []) {
    if (p?.id == null) continue
    const at = Math.max(toMs(p.shot?.at), toMs(p.at))
    if (!best || at > best.at) best = { id: String(p.id), at }
  }
  return best ? { kind: "page", id: best.id, view: null } : null
}

// What the pane shows: following, the agents' current item (each revision may move it); paused, the owner's pick
// while it exists — else the current one, else the first.
export function shownItem(state, { following = true, picked = null } = {}) {
  const items = previewItems(state)
  const current = itemKey(currentRef(state))
  const find = (key) => (key ? (items.find((i) => i.key === key) ?? null) : null)
  return (following ? find(current) : (find(picked) ?? find(current))) ?? find(picked) ?? items[0] ?? null
}

// The #view a shown page should be at: the one preview.focus named, while that page is the current item.
export function pageView(state, pageId) {
  const c = currentRef(state)
  return c?.kind === "page" && String(c.id) === String(pageId) && c.view && WORD.test(c.view) ? c.view : null
}

// The session a {terminal: ref} visual streams: by id, else by name, else by its tab label ("coder · main" or
// "coder.main"), from the terminal twins' sessions. → session | null
export function sessionOf(artifacts, ref) {
  if (ref == null) return null
  const key = String(ref)
  const sessions = Object.values(artifacts ?? {})
    .filter((a) => a?.view === "terminal")
    .flatMap((a) => a.state?.sessions ?? [])
    .filter((s) => s?.id != null)
  const label = (s) => (s.slot ? `${s.agent ?? "owner"} · ${s.slot}` : null)
  return (
    sessions.find((s) => String(s.id) === key) ??
    sessions.find((s) => s.name === key) ??
    sessions.find((s) => label(s) === key || (s.slot && `${s.agent}.${s.slot}` === key)) ??
    null
  )
}

// The owner's questions, oldest first, each with its answer or open.
export function askThread(state) {
  return (state?.asks ?? []).filter((a) => a?.id != null).map((a) => ({ ...a, open: !a.answer }))
}

export const openAsks = (state) => askThread(state).filter((a) => a.open).length

// Does this twin take the owner's questions? An old one (before the restart) has no asks.
export const askable = (state) => Array.isArray(state?.asks)

// An answer's `on` (or a question's) as the key of the item it points to: {kind, id}, or a bare id (a visual's first,
// then a page's) — null when nothing in the pane has it.
export function onKey(state, on) {
  if (on == null) return null
  const items = previewItems(state)
  if (typeof on === "object") {
    const key = itemKey(on)
    return items.some((i) => i.key === key) ? key : null
  }
  const id = String(on)
  return (items.find((i) => i.kind === "visual" && i.id === id) ?? items.find((i) => i.id === id))?.key ?? null
}

// "visual loss" / "page p1" for a question's or answer's `on`.
export const onLine = (on) => (on == null ? "" : typeof on === "object" ? `${on.kind ?? ""} ${on.id ?? ""}`.trim() : String(on))

// The newest moment anything in the preview changed (a page shot, a visual drawn or read, a question, an answer), so
// the workbench's follow can weigh it against the files and terminal (ms; 0 when nothing).
export function previewActivity(state) {
  let at = 0
  for (const i of previewItems(state)) at = Math.max(at, i.at)
  for (const a of state?.asks ?? []) at = Math.max(at, toMs(a?.at), toMs(a?.answer?.at))
  return at
}

// The owner's question to the desk about what is in the pane: the kernel records it on the preview and hands it to its
// keeper (team/call target artifact → kernel-team: guidance while the keeper runs, else a run).
//   on: the shown item {kind, id}; context: what the owner pointed at (a visual's element, a framed page's "ask").
//   → {ask, keeper, delivered: "guided" | "run"}
export const askPreview = (id, { text, on = null, context = null }) => teamCall("artifact", "ask", [{ id, text, on, context }])

// Can this tab frame the page? A page on the desk's computer (loopback, a port), never this tab's own origin (the
// desk server: a framed page there would share its rights). Another device's tab cannot reach the desk's localhost.
export function frameCheck(url, here = null) {
  let u
  try {
    u = new URL(url)
  } catch {
    return { ok: false, reason: "the page's address is not a URL" }
  }
  if (!["http:", "https:"].includes(u.protocol) || !LOOPBACK.has(u.hostname) || !u.port) return { ok: false, reason: "only a page on the desk's computer can be framed" }
  if (!here) return { ok: true }
  const h = new URL(here)
  if (h.origin === u.origin || (LOOPBACK.has(h.hostname) && h.port === u.port)) return { ok: false, reason: "the page is on the desk server's own port" }
  if (!LOOPBACK.has(h.hostname)) return { ok: false, remote: true, reason: `the page runs on the desk's computer (${u.host}); this tab is on ${h.host}` }
  return { ok: true }
}

// The frame's address for a view: the page with #<view> (a page that ignores postMessage still moves).
export function frameSrc(url, view = null) {
  if (!url) return null
  const base = String(url).split("#")[0]
  return view ? `${base}#${encodeURIComponent(view)}` : base
}

// How the pane shows a page: the owner's pick (mode "live" | "shot"), else live wherever it can be framed (2026-10-18
// owner: the preview IS the live page — a training run's dashboard — not only its screenshot). A page that cannot be
// framed (closed, another device's tab, not on the desk's computer) shows its shot whatever was picked.
//   → "live" | "shot"
export function pageMode({ mode = null, frameable = false } = {}) {
  return (mode ?? (frameable ? "live" : "shot")) === "live" && frameable ? "live" : "shot"
}

// A page enlarged to the whole viewport (2026-10-18 owner: "preview can enlarge to a web page"): the live page framed
// where it can be (here: this tab's address), else its last screenshot with the reason; always the page's address for
// "open in a new tab". view: the #view the agents put it at. → {title, href, live, src, reason} | null (no page URL)
export function enlargeOf(page, { here = null, view = null } = {}) {
  if (!page?.url) return null
  const href = frameSrc(page.url, view)
  const check = here ? frameCheck(page.url, here) : { ok: false, reason: null }
  const closed = page.status === "closed"
  const live = !!check.ok && !closed
  const reason = live ? null : closed ? "the page is closed: its last screenshot" : check.reason ? `not framed: ${check.reason} — its last screenshot` : null
  return { title: page.title || hostOf(page.url) || href, href, live, src: live ? href : null, reason }
}

// What a page in the frame hears when its view changes (the wire word "scene": pages built before 2026-10-17 speak it).
export const viewMessage = ({ id = null, view, title = "", params = null }) => ({ askk: "scene", scene: { id: id ?? view, view, title, params } })

// How a view reaches the framed page (2026-10-17, learned framing the desk's first story page): only when its key
// changes — never on every stream update — and by message once the page has spoken the bridge; before that by the
// frame's #view (a hash and a message together race: a late hashchange would drop the params). → "post" | "src" | null
export function frameStep({ key, last = null, heard = false }) {
  if (!key || key === last) return null
  return heard ? "post" : "src"
}

// Plain data the page sent, clipped the way the kernel keeps it; null when it is not an object.
function plain(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  let text
  try {
    text = JSON.stringify(raw)
  } catch {
    return null
  }
  if (text.length > CONTEXT_MAX) return null
  return JSON.parse(text)
}

// A message from the page in the frame → {type: "at", view, views} | {type: "ask", context, text} | null. Only from the
// frame's window and the page's origin; anything else (another frame, an extension, a malformed message) is null.
export function bridgeMessage(event, { frame, origin }) {
  if (!event || !frame || event.source !== frame || !origin || event.origin !== origin) return null
  const d = event.data
  if (!d || typeof d !== "object") return null
  if (d.askk === "at") {
    const view = String(d.view ?? "")
    if (!WORD.test(view)) return null
    const views = Array.isArray(d.views) ? d.views.map(String).filter((v) => WORD.test(v)).slice(0, 32) : null
    return { type: "at", view, views }
  }
  if (d.askk === "ask") {
    const context = plain(d.context)
    const text = typeof d.text === "string" ? d.text.trim().slice(0, TEXT_MAX) : ""
    if (!context && !text) return null
    return { type: "ask", context, text }
  }
  return null
}

// "layer 2 · head 1 · step 800": what the owner pointed at, as a chip.
export function contextLine(context) {
  if (!context) return ""
  return Object.entries(context)
    .map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" · ")
}

// ---- drill-down and bound scripts (2026-10-17) ----

const PARAM = /^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,39}$/ // the kernel's PARAM_VALUE: no "/", no leading "-"

// "run=r04 · t=7" (empty for none).
export const paramsText = (params, sep = " · ") =>
  params && typeof params === "object"
    ? Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join(sep)
    : ""

// A visual's `meta` in one line: "config r04-base · n_layer 6".
export const metaText = (meta) =>
  meta && typeof meta === "object" && !Array.isArray(meta)
    ? Object.entries(meta)
        .map(([k, v]) => `${k} ${v}`)
        .join(" · ")
    : ""

// A number as a param value: an integer as is, else at most 6 significant digits ("1700", "0.25").
const paramOf = (v) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)))) : String(v ?? ""))

// The link an element's click opens, with "{x}" filled from the clicked point (a line or scatter point's x):
// {id, params?} | null (no link, or a "{x}" with no point to fill it, or a value that is not a short word).
export function linkFor(open, point = null) {
  if (!open || typeof open !== "object" || !open.id) return null
  const params = {}
  for (const [k, raw] of Object.entries(open.params ?? {})) {
    const v = raw === "{x}" ? (point?.x == null ? null : paramOf(point.x)) : String(raw)
    if (v == null || !PARAM.test(v)) return null
    params[k] = v
  }
  return Object.keys(params).length ? { id: String(open.id), params } : { id: String(open.id) }
}

// The breadcrumb: the trail, then the item in the pane — each {key, kind, id, params, label, title, current}.
export function trailOf(state) {
  const items = previewItems(state)
  const titleOf = (t) => items.find((i) => i.kind === t.kind && i.id === String(t.id))?.title ?? String(t.id)
  const crumb = (t, current) => {
    const params = t.params && Object.keys(t.params).length ? t.params : null
    const p = paramsText(params, ", ")
    return { key: `${t.kind}:${t.id}${p ? `?${p}` : ""}`, kind: t.kind, id: String(t.id), params, title: titleOf(t), label: `${titleOf(t)}${p ? ` (${p})` : ""}`, current }
  }
  const trail = (Array.isArray(state?.trail) ? state.trail : []).filter((t) => t?.kind && t.id != null)
  const c = currentRef(state)
  return trail.length ? [...trail.map((t) => crumb(t, false)), ...(c ? [crumb(c, true)] : [])] : []
}

// A bound script's state as one line and a tone: running | waiting | failed | ok | idle.
//   → {tone, text, command, watch} | null (no bind)
export function bindLine(bind, now = Date.now()) {
  if (!bind || typeof bind !== "object" || !bind.command) return null
  const at = (iso) => {
    const t = Date.parse(iso ?? "")
    return Number.isFinite(t) ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""
  }
  const secs = (ms) => (ms == null ? "" : ` (${(ms / 1000).toFixed(1)} s)`)
  const watch = Array.isArray(bind.watch) ? bind.watch : []
  let tone = "idle"
  let text = "not run yet"
  if (bind.running) {
    tone = "running"
    const since = Date.parse(bind.ran_at ?? "")
    text = `re-running…${Number.isFinite(since) ? ` ${Math.max(0, Math.round((now - since) / 1000))} s` : ""}`
  } else if (bind.waiting) {
    tone = "waiting"
    text = `waiting: ${bind.waiting}`
  } else if (bind.ran_at) {
    tone = bind.error ? "failed" : "ok"
    text = `ran ${at(bind.ran_at)}${bind.exit != null ? ` exit ${bind.exit}` : ""}${secs(bind.ms)}`
  }
  return { tone, text, error: bind.error ?? null, command: String(bind.ran ?? bind.command), watch }
}

// The owner's calls on the preview (team/call target artifact; kernel builtin/preview.js ownerCall):
//   open {visual, params?} — that visual in the pane with those params (the item there goes on the trail)
//   back — the trail's last item in the pane again
//   rerun {visual} — its bound script now
export const openPreview = (id, link) => teamCall("artifact", "open", [{ id, visual: link?.id, ...(link?.params ? { params: link.params } : {}) }])
export const backPreview = (id) => teamCall("artifact", "back", [{ id }])
export const rerunPreview = (id, visual) => teamCall("artifact", "rerun", [{ id, visual }])

