import { Artifact } from "../artifact/artifact.js"
import { parseYamlish } from "../util/yamlish.js"
import { cleanPath, expandGlob, globCovers, globRegex, hostError, hostFiles, inLane } from "./files.js"
import { checkParams, checkVisual, folded, metaLine, VISUAL_ID, visualBrief, VISUAL_KINDS } from "./visual.js"
import { clipAfter as clip } from "../util/text.js"

// Preview: the one pane the owner and the agents both watch (2026-10-17 owner: "There will be need for only one
// preview pane because the goal is for the user and agent to communicate the idea more freely … the agent can draw
// charts or visualizations to show the flow. I can ask follow up questions and agent can update visuals and answer me
// as well"). It holds two kinds of item, and one of them is in the pane (`current`):
//   pages    the running app's pages — a live UI, a training dashboard, an internal build (the preview of what the
//            agents build: its screenshot attached, a curated browser tool set like chrome-devtools MCP). They live in
//            the host (browser/*: companion/capabilities/browser.js — headless, on this computer's apps only); every
//            action that changes a page leaves a screenshot the owner sees. Each action answers with the page's text
//            outline, and the prompt keeps the last one read; and (2026-10-18 owner: "the screenshot will be included
//            along with the next request and the agent can iterate over in order to complete a live artifact and I can
//            also observe it") the agent SEES it too: images(agent) hands the newest screenshot of the page that holder
//            last acted on to its next model call, once per shot (host GET browser/image: a JPEG ≤ 1280 px wide) — so
//            it writes a page, looks, fixes, looks again, while the owner watches the same page in the pane.
//   visuals  what the agent draws to explain (builtin/visual.js: flow, steps, matrix, line, bars, tokens, scatter,
//            compare — the UI animates them), a workspace JSON file holding one (read again as a script rewrites it, so
//            a visual follows a training run), or a terminal session's output. A training run's live dashboard is a
//            page (2026-10-18 owner: the charts artifact is gone — the preview is the one live view, and it enlarges to
//            the page itself in the UI).
// The owner asks about what is in the pane; the question goes to the keeper (the first holder of preview.answer), which
// redraws or draws the visual that answers and answers with preview.answer. 2026-10-17: the stage's visuals, file
// visuals and owner questions folded in here; the stage is gone. One instance per desk (id "preview", listing every page
// of the desk); {type: preview, id} makes another that lists only the pages it opened.
//
//   preview.open {url}   preview.goto {url}   preview.click {selector | x, y}   preview.type {text, selector?}
//   preview.press {key}   preview.scroll {dy}   → the page's line and its text outline (the first 40 lines)
//   preview.text   the whole text outline   preview.eval {expression}   its value   preview.console   console lines
//   preview.shot   a fresh screenshot (for the owner's eyes)   preview.close
//   (the page: the newest open one unless `id`; open also puts the new page in the pane — a #view in its URL: its view)
//   preview.show   {id, title, says?, visual, bind?}   draw or redraw (the same id) a visual and put it in the pane
//   preview.focus  {id, view?, params?}         put a page (view: its #hash) or a visual (params: merged into its own) in
//                                               the pane; the item there goes on the trail
//   preview.answer {ask, text, show?}           answer an owner question; show: the page or visual that answers (it goes
//                                               in the pane)
//   preview.drop   {id}                         drop a visual
//   preview.record {title, id?}                 record a page (2026-10-25 owner: "open the webpage, record, navigate and
//                                               perform actions"): from now each action on it is a frame — its screenshot
//                                               (the host keeps them while recording), the action, the URL — until
//   preview.cut    {note?}                      ends the holder's recording; the owner plays it back in the pane
//
// visual: a spec {kind, …} (checked by visual.js; a bad one is refused with that kind's shape), {file: "<workspace>.json"}
// (a spec in a file: read now, again at most every VISUAL_MS while it is held — coalesced; a file that is gone or wrong
// keeps its last visual with an error line; refused outside the holder's reads: lane, never .env* / .mcp.json),
// or {terminal: "<session id or name>"} ("main" / "long" / "<agent>:main" resolved to that session's id; the UI streams it).
//
// The owner (the UI: team/call {target: "artifact", method: "ask", args: [{id, text, on?, context?}]}): ownerCall("ask")
// records an open question (on: what was in the pane, {kind, id} — none given: the current item; context: what the
// owner pointed at) and returns {ask, deliver, keeper}: the host hands `deliver` to the keeper — guidance while it runs,
// else a new run. gate(agent): a holder of preview.answer answers only while no owner question is open.
//
// Commands are type dev (never answered from the run's data cache). refresh(agent) pulls browser/list (coalesced, at
// most every REFRESH_MS) and the file visuals (at most every VISUAL_MS); poll: the host refreshes it too while a tab
// watches, so a file visual moves while every holder waits. changed() only when the twin state differs; revision moves on
// every change — and on every open / show / focus / answer / drop, so a follower's pane moves even to the item it shows.
// keep "always": visuals (a file visual as its path), asks and current outlive runs and restarts; pages come back from
// the host (browser/list) — a current page the host no longer lists leaves the pane.
// Twin state: {pages: [{id, url, title, status: open | closed, by, at, shot: {n, at, width, height, url} | null,
//   console: [{level, text, at}] (last 20), errors}] ≤ 12 (the image itself is the host's: GET browser/shot?id&n),
//   visuals: [{id, title, says, visual, by, at, error?, read_at?}] ≤ 16 (a file visual: {file, …its spec} once read),
//   current: {kind: page | visual, id, view?} | null,
//   asks: [{id, text, on: {kind, id} | null, context, from, at, answer: {text, on, by, at} | null}] ≤ 40, revision}.
// Prompt (text only, ≤ PROMPT_LINES lines): each open page's url, title, console errors and its last text outline (the
// outlines fill what the rest leaves); the visuals one line each; what is in the pane; the open questions in full; the
// last 3 answered.
//
// 2026-10-17 (owner: "it can zoom into granular token level … the script attached with view elements such that on
// changing the architecture, the visuals can also be updated"): drill-down and bound scripts.
//   params   {file: "projects/x/out/viz/tok/{run}/{t}.json", params: {run: "r04", t: 0}}: a templated file visual — each
//            {name} filled from params (values letters, digits, . _ - ≤ 40: never a path, never a leading -), the resolved path checked as
//            any file visual's (clean, .json, never the configuration, in the drawer's reads: lane — kept on the entry
//            as `reads`, so the owner's opens stay in it). The entry keeps `template` and its current `params`.
//   links    a visual's elements carry `open` (visual.js): the owner's click → ownerCall("open", [{id, visual, params?}])
//            puts that visual in the pane with those params merged into its own (a templated file read now, its bound
//            script run when the file is missing); the item that was there goes on the `trail` (≤ TRAIL_MAX);
//            ownerCall("back", [{id}]) goes back one. preview.focus {id, params?} does the same for an agent. Neither
//            starts a run: the prompt's pane line says what the owner drilled to.
//   bind     preview.show {…, visual: {file, params?}, bind: {command, watch: [globs] ≤ 8, cwd?, lease?, timeout? ≤ 600}}:
//            the script that writes the visual's file (in the binder's writes:; each watch glob in its reads:, never the
//            file itself, nor another bound visual's file — two scripts never start each other; a glob covered by one of
//            the binder's reads: globs (files.js globCovers), starting at a folder, never at the top). With the file reads (every VISUAL_MS while a tab or a holder looks): when a watched file is
//            newer than the last run (or than the file, before any run), or the file is missing for params never run,
//            the command (its {name}s filled from the params) starts in a host terminal session — the binder's name and
//            writes, slot "viz", name viz:<id>, lease when given — one at a time; exit 0 → the file is read again; else
//            the last good visual stays with the error. ownerCall("rerun", [{id, visual}]) runs it now. A held lease or
//            a busy slot waits for the next read. A watched change starts the same bind at most every BIND_GAP_MS.
// Twin additions: an entry's template?, params?, reads?, bind? {command, watch, cwd, lease, timeout, by, writes, running,
//   session, ran_at, ran (the command last started), inputs_at (the watched files' newest mtime then), exit, ms, error,
//   waiting, reads (the binder's lane: what its watch may see)}; state current {kind, id, view?, params?}, trail [{kind, id, params?}] ≤ TRAIL_MAX.

const PAGES_MAX = 12
const CONSOLE = 20 // console lines per page in the twin
const TEXT_LINES = 40 // a text outline's lines in the prompt and in an action's answer
const PROMPT_ERRORS = 5
const PROMPT_LINES = 60 // the prompt block, whole
const PROMPT_SAYS = 220
const PROMPT_ANSWERED = 3
const LINE_CHARS = 300
const RESULT_CHARS = 12000
const REFRESH_MS = 1000
const VISUALS_MAX = 16
const ASKS_MAX = 40
const TITLE_MAX = 80
const SAYS_MAX = 900
const ASK_MAX = 1500
const ANSWER_MAX = 1500
const CONTEXT_MAX = 1000 // chars of JSON: what the owner pointed at
const INLINE_MAX = 24000 // chars of an inline visual's JSON (written in a tool call)
const FILE_MAX = 300000 // chars of a visual file
const FILES_MAX = 1200000 // chars of every visual file together (each change streams the preview to every tab)
const VISUAL_MS = 3000
const TRAIL_MAX = 8
const RECORDINGS_MAX = 8
const FRAMES_MAX = 200
const WATCH_MAX = 8
const BIND_TIMEOUT = 120 // s: a bound script's default
const BIND_TIMEOUT_MAX = 600
const BIND_GAP_MS = 10000 // a watched change starts the same bind at most this often (a loop's backstop)
const BIND_SLOT = "viz" // the binder's host terminal session for its bound scripts
const COMMAND_MAX = 600
const MTIME_SLACK = 1000 // ms: a watched file must be this much newer
const LEASE = /^[a-z][a-z0-9-]{0,19}$/ // terminal.js
const GLOB = /[*?]/
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]{0,23})\}/g
const VIEW = /^[^\s#]{1,120}$/ // a page's #hash
const TERMINAL_REF = /^[^\r\n\t]{1,120}$/
const SLOT_REF = /^(?:(.+):)?(main|long)$/ // terminal.js: "main", "long", "<agent>:main"

// Each kind's shape, for an error that says what to write (builtin/visual.js checks it). Every kind: title?, caption?.
const PAGE = "the page (default: the newest open one)"
const SHAPES = {
  flow: "{kind: flow, nodes: [{id, label?, group?, note?, value?}] ≤ 120, edges: [{from, to, label?, weight?}] ≤ 300, direction?: right | down, order?: [node ids]}",
  steps: "{kind: steps, steps: [{title, detail?, value?}] ≤ 40}",
  matrix: "{kind: matrix, values: [[n, …], …] ≤ 64 × 64 | frames: [{label?, values, cells?}], rows?: [labels], cols?: [labels], cells?: [[text ≤ 12]], range?: [lo, hi], diverging?, unit?, open_rows?: [link | null], open_cols?: [link | null]}",
  line: "{kind: line, series: [{name, points: [[x, y], …] ≤ 1000}] ≤ 12, x?: name, y?: name, marks?: [{x, label}]} — one x and one y (two quantities: a compare)",
  bars: "{kind: bars, bars: [{label, value, note?}] ≤ 60 | frames: [{label?, bars}], unit?}",
  tokens: "{kind: tokens, prompt?, tokens: [{text, id?, p?, surprisal? (bits), entropy?, target?, top?: [[text, p], …] ≤ 10, open?}] ≤ 300, color?: surprisal | p | entropy, range?: [lo, hi]}",
  scatter: "{kind: scatter, points: [{x, y, label?, group?}] ≤ 2000 | frames: [{label?, points}], x?, y?, trails?}",
  compare: "{kind: compare, sides: [{title, visual: a spec of another kind, note?}] (2 or 3), verdict?}",
}
const VISUAL_HELP = `a spec {kind: ${VISUAL_KINDS.join(" | ")}, title?, caption?, meta?, …}, {file: "<workspace>.json", params?} holding one or {terminal: "<session id or name>"}`

// One line: what an agent, a page or the owner wrote may hold line breaks; the prompt counts each entry as one line.
const flat = (s) => String(s ?? "").replace(/\s*[\r\n\u2028\u2029]+\s*/g, " ").trim()
const ctxOf = (agent) => ({ ...(agent?.context ?? {}), agent })
const hostOf = (ctx) => {
  if (!ctx?.host?.get) throw new Error("no host here (ctx.host): the desk server opens the pages")
  return ctx.host
}
const isError = (l) => l?.level === "error" || l?.level === "pageerror"
// ASKK's configuration, never read (files.js keeps the same rule); a glob's last part that can only mean it.
const secret = (path, glob = false) => {
  const name = String(path).split("/").at(-1) ?? ""
  return name === ".mcp.json" || ((glob ? name.startsWith(".env") : /^\.env(\..+)?$/.test(name)) && name !== ".env.example")
}
const inline = (o) =>
  o && Object.keys(o).length
    ? Object.entries(o)
        .map(([k, v]) => `${flat(k)} ${typeof v === "object" ? JSON.stringify(v) : flat(v)}`)
        .join(", ")
    : ""
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`
const list = (v) => (v == null || v === "" ? [] : Array.isArray(v) ? v : String(v).split(",")).map((x) => String(x).trim()).filter(Boolean)
// A required text: trimmed, or an Error saying what is missing.
const need = (value, message) => {
  const text = String(value ?? "").trim()
  if (!text) throw new Error(message)
  return text
}
const logOf = (ctx) => ctx?.agent?.context?.log ?? ctx?.log
// The {name}s a text holds.
const placeholders = (text) => [...String(text ?? "").matchAll(PLACEHOLDER)].map((m) => m[1])
// A text with each {name} filled from params (values checkParams let through: never a path); one with no value: an Error.
function fill(text, params, what) {
  const missing = [...new Set(placeholders(text).filter((k) => params?.[k] == null))]
  if (missing.length) throw new Error(`${what}: ${missing.map((k) => `{${k}}`).join(", ")} ${missing.length === 1 ? "has" : "have"} no value — params: {${missing.map((k) => `"${k}": …`).join(", ")}}`)
  return String(text).replace(PLACEHOLDER, (_, k) => params[k])
}
// A visual file (a template filled): clean, .json, never the configuration.
function visualFile(raw, params) {
  const file = cleanPath(fill(cleanPath(raw), params, "visual.file"))
  if (secret(file)) throw new Error(`visual.file: ${file} is ASKK's configuration — never read`)
  if (!/\.json$/i.test(file)) throw new Error(`visual.file: ${file || '""'} — a .json file in the workspace holding a visual spec, e.g. {"file": "projects/<slug>/out/visuals/loss.json"}`)
  return file
}
const paramsText = (params) =>
  params && Object.keys(params).length
    ? Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")
    : ""
const sameParams = (a, b) => paramsText(a) === paramsText(b)
const hhmm = (at) => (at ? String(at).slice(11, 16) : "")
// Every artifact of a kind the agent's desk holds (terminal): the desk's when it has one, else the agent's own.
const reach = (agent, kind) => {
  const all = agent?.home?.artifacts?.()
  return (all ? [...all.values()].map((x) => x.artifact) : [...(agent?.artifacts ?? [])]).filter((a) => a?.kind === kind)
}
// A page URL's #view, if it has one a pane can keep.
const viewOf = (url) => {
  try {
    const h = decodeURIComponent(new URL(url).hash.slice(1))
    return h && VIEW.test(h) ? h : null
  } catch {
    return null
  }
}

// A host page as the twin keeps it: the spec's fields.
const twinOf = (p) => ({
  id: p.id,
  url: p.url ?? "",
  title: p.title ?? "",
  status: p.status === "closed" ? "closed" : "open",
  by: p.by ?? null,
  at: p.at ?? null,
  shot: p.shot ? { n: p.shot.n, at: p.shot.at ?? null, width: p.shot.width ?? null, height: p.shot.height ?? null, url: p.shot.url ?? null } : null,
  console: (p.console ?? []).slice(-CONSOLE).map((l) => ({ level: l?.level ?? "log", text: String(l?.text ?? ""), at: l?.at ?? null })),
  errors: Number(p.errors) || 0,
})

const headOf = (p) => `${p.status === "closed" ? "■" : "▶"} ${p.id} ${flat(p.url)}${p.title ? ` — "${clip(flat(p.title), 120)}"` : ""}${p.by ? ` (opened by ${p.by})` : ""}${p.status === "closed" ? " closed" : ""}${p.shot ? ` · shot ${p.shot.n}` : ""}${p.errors ? ` · ${plural(p.errors, "console error")}` : ""}`
const outline = (text, n = TEXT_LINES) => {
  const lines = String(text ?? "").split("\n").filter((l) => l.trim())
  return { lines: lines.slice(0, n).map((l) => clip(l, LINE_CHARS)), more: Math.max(0, lines.length - n) }
}
const result = (text) => (text.length > RESULT_CHARS ? `${text.slice(0, RESULT_CHARS)}\n… cut at ${RESULT_CHARS} chars` : text)

// A visual entry in its twin's order: {id, title, says, visual, by, at, template?, params?, reads?, bind?, error?,
// read_at?}.
const entry = ({ id, title, says, visual, by = null, at = null, template = null, params = null, reads = null, bind = null, error = null, read_at = null }) => ({
  id,
  title,
  says,
  visual,
  by,
  at,
  ...(template ? { template } : {}),
  ...(params && Object.keys(params).length ? { params } : {}),
  ...(reads ? { reads } : {}),
  ...(bind ? { bind } : {}),
  ...(error ? { error } : {}),
  ...(read_at ? { read_at } : {}),
})

// A spec checked by visual.js; its error says what that kind's shape is (or what a visual can be).
function checkSpec(raw, maxChars) {
  try {
    return checkVisual(raw, { maxChars })
  } catch (e) {
    let kind = ""
    try {
      kind = String((typeof raw === "string" ? JSON.parse(raw) : raw)?.kind ?? "")
    } catch {}
    const what = /^visual\b/.test(e.message) ? e.message : `visual: ${e.message}`
    throw new Error(SHAPES[kind] ? `${what} — a ${kind} visual is ${SHAPES[kind]}` : `${what} — a visual is ${VISUAL_HELP}`)
  }
}

// A visual as preview.show asks for it → {spec} (checked now) | {file} | {terminal}; a bad one is an Error
// naming what to write.
// 2026-10-18: a spec written as indented "key: value" text is read with util/yamlish.js, and the reply format's list
// reading of one is folded back (visual.js `folded`).
function visualRequest(raw) {
  if (raw == null || raw === "") throw new Error(`visual: what to draw — ${VISUAL_HELP}`)
  let v = raw
  if (typeof raw === "string") {
    if (/^\s*\{/.test(raw)) {
      try {
        v = JSON.parse(raw)
      } catch {
        throw new Error(`visual: not JSON — ${VISUAL_HELP}`)
      }
    } else if (/\n/.test(raw.trim()) || /^\s*kind\s*:/.test(raw)) {
      v = parseYamlish(raw)
      if (!v) throw new Error(`visual: its text could not be read as a spec — write it as JSON on one line (visual: {"kind": "bars", "bars": [{"label": "a", "value": 1}]}) or as indented key: value lines; ${VISUAL_HELP}`)
    } else v = { file: raw }
  }
  if (Array.isArray(v)) v = folded(v)
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`visual: ${VISUAL_HELP}`)
  if (v.kind == null) {
    // 2026-10-18 owner: no charts artifact — a live dashboard is a page (preview.open), a curve a {kind: line} spec
    if (v.chart != null) throw new Error(`visual.chart: there are no charts — open the live dashboard as a page (preview.open {url}) or draw a {kind: line} spec (a {file} a script rewrites follows a run)`)
    const sources = ["file", "terminal"].filter((k) => v[k] != null && v[k] !== "")
    if (sources.length > 1) throw new Error(`visual: one source — ${sources.join(" or ")}, not ${sources.length === 2 ? "both" : "all"}`)
    if (sources[0] === "file") {
      const params = checkParams(v.params, "visual.params")
      const file = visualFile(v.file, params)
      const template = placeholders(v.file).length ? cleanPath(v.file) : null
      return { file, ...(template ? { template } : {}), ...(params ? { params } : {}) }
    }
    if (sources[0] === "terminal") {
      const terminal = String(v.terminal).trim()
      if (!TERMINAL_REF.test(terminal)) throw new Error(`visual.terminal: "${clip(terminal, 60)}" — a terminal session's id or name (terminal.list), "main" or "long", e.g. {"terminal": "long"}`)
      return { terminal }
    }
  }
  return { spec: checkSpec(v, INLINE_MAX) }
}

// A visual back from a save: a file's path (read again), a terminal reference, else the spec checked again (one that
// fails — an old {chart} — is dropped).
function restoredVisual(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  try {
    if (v.file != null) return { file: visualRequest({ file: v.file }).file }
    if (v.kind == null && v.chart != null) return null
    if (v.kind == null && v.terminal != null) return visualRequest({ terminal: v.terminal })
    return checkVisual(v, { maxChars: INLINE_MAX })
  } catch {
    return null
  }
}

// What a visual is, in a few words (the prompt, a command's answer).
function sourceLine(visual) {
  if (!visual) return "nothing"
  if (visual.terminal != null) return `terminal ${visual.terminal}`
  const meta = metaLine(visual.meta)
  return `${visual.kind ? visualBrief(visual) : "visual"}${visual.file ? ` from ${visual.file}` : ""}${meta ? ` (${clip(flat(meta), 120)})` : ""}`
}

// A bound script in one line: what runs, on what, how it last went.
function bindLine(b, now) {
  if (!b) return ""
  const state = b.running
    ? `running since ${hhmm(b.ran_at)}${b.ran_at && now ? ` (${Math.max(0, Math.round((now - Date.parse(b.ran_at)) / 1000))} s)` : ""}`
    : b.waiting
      ? `waiting: ${clip(flat(b.waiting), 120)}`
      : b.ran_at
        ? `ran ${hhmm(b.ran_at)}${b.exit != null ? ` exit ${b.exit}` : ""}${b.ms != null ? ` (${(b.ms / 1000).toFixed(1)} s)` : ""}`
        : "not run yet"
  return `bound: ${clip(flat(b.command), 120)} ← ${b.watch.join(", ")} · ${state}${b.error ? ` — ERROR ${clip(flat(b.error), 160)}` : ""}`
}

// What the owner's question carries from the pane (the element they pointed at): plain data, clipped.
function contextOf(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const text = JSON.stringify(raw)
  return text.length > CONTEXT_MAX ? { note: clip(text, CONTEXT_MAX) } : JSON.parse(text)
}

// Params as saved, or null when they no longer check.
const savedParams = (p) => {
  try {
    return checkParams(p)
  } catch {
    return null
  }
}
// An item reference as saved: {kind: page | visual, id, params?}, else null.
const itemRef = (x) => {
  if (!(x && typeof x === "object" && ["page", "visual"].includes(x.kind) && x.id != null && x.id !== "")) return null
  const params = x.kind === "visual" ? savedParams(x.params) : null
  return { kind: x.kind, id: String(x.id), ...(params ? { params } : {}) }
}

// A list cut to `keep` items, one "… n more: ids" line in place of the rest.
const cut = (items, ids, keep, what) => (keep >= items.length ? items : [...items.slice(0, keep), `  … ${items.length - keep} more ${what}: ${ids.slice(keep).join(", ")}`])

export class Preview extends Artifact {
  static about = "the one pane the owner and agents both watch: live pages and visuals, the owner's questions about what is shown"
  static commands = {
    open: { description: "open a page of an app running on this computer (http://localhost:<port>; the desk server's own only on a desk that lets its agents view this app — then an agent's view: you read, navigate, click and type, nothing you do there writes, no eval) and put it in the owner's pane: its text outline", input: { url: "e.g. http://localhost:8001 (a #view after it: the page's view)", width: "page width in px, e.g. 375 for a phone; default 1280", height: "page height in px, e.g. 812; default 800" } },
    goto: { description: "go to another URL on the page", input: { url: "the URL", id: PAGE } },
    click: { description: "click an element (a CSS selector) or a point", input: { selector: "e.g. button#save", x: "pixels from the left (instead of selector)", y: "pixels from the top", id: PAGE } },
    type: { description: "type text (into the selector's element, clicked first)", input: { text: "what to type", selector: "the input (optional)", id: PAGE } },
    press: { description: "press a key", input: { key: "Enter, Tab, Escape, ArrowDown … or one character", id: PAGE } },
    scroll: { description: "scroll the page", input: { dy: "pixels down (negative: up)", id: PAGE } },
    text: { description: "the page's whole text outline: headings, text, links, buttons, inputs", input: { id: PAGE } },
    eval: { description: "evaluate a JavaScript expression in the page: its value", input: { expression: "e.g. document.querySelectorAll('tr').length", id: PAGE } },
    console: { description: "the page's console lines and errors", input: { id: PAGE } },
    shot: { description: "take a screenshot for the owner (you read the page with text)", input: { id: PAGE } },
    close: { description: "close the page", input: { id: PAGE } },
    record: { description: "start recording the page: every action on it from now (open-goto-click-type-press-scroll-shot) is a frame the owner plays back — its screenshot, the action, the URL; end with cut", input: { title: "what the recording shows, e.g. 'the goal card after a change'", id: PAGE } },
    cut: { description: "end your recording (the owner plays it back in the pane)", input: { note: "what it showed (optional)" } },
    show: {
      description: "draw a visual in the owner's pane (the same id redraws it): a spec you build — a flow, steps, a matrix, a line, bars, tokens, a scatter or a compare, animated for the owner — a workspace JSON file holding one (read again as it changes), or a terminal session's live output",
      input: {
        id: "short id (pipeline, loss, attention, …)",
        title: "the visual's title",
        says: "optional: what the owner should see in it, with the numbers",
        visual: `${VISUAL_HELP} (skill preview); a templated file: {file: "…/tok/{run}/{t}.json", params: {run: "r04", t: 0}}`,
        bind: "optional, with a {file} visual: {command, watch: [globs], cwd?, lease?, timeout?} — the script that writes the file ({name}s from params), run again when a watched file changes (the owner sees it redraw)",
      },
    },
    focus: { description: "put a page or a visual in the owner's pane (the item there goes on the trail the owner goes back along)", input: { id: "a page id or a visual id", view: "optional: a page's view (its #hash)", params: 'optional, a visual: params merged into its own, e.g. {"t": 7} (a templated file is read for them, its bound script run when missing)' } },
    answer: { description: "answer a question the owner asked in the preview; show: the page or visual that shows the answer (it goes in the pane)", input: { ask: "question id (q1 …)", text: "the answer, with numbers", show: "optional: the visual or page id to show" } },
    drop: { description: "drop a visual from the preview", input: { id: "visual id" } },
  }
  static owner = { ask: "ownerAsk", open: "ownerOpen", back: "ownerBack", rerun: "ownerRerun" }

  // separate: another instance of the desk's preview — it lists only the pages it opened. adapter: the workspace, for
  // visual files (default the host: fs/read).
  constructor({ id = "preview", title, separate = false, adapter = hostFiles, clock = () => new Date() } = {}) {
    super({ name: id, title: title ?? (id === "preview" ? "preview — the pane the owner watches" : `${id} — preview`) })
    this.kind = "preview"
    this.view = "preview"
    this.keep = "always" // visuals, asks and current; the pages come back from the host
    this.poll = VISUAL_MS // the host refreshes it while a tab watches (kernel-team.js)
    this.clock = clock
    this.adapter = adapter
    this.state = { pages: [], visuals: [], current: null, trail: [], asks: [], recordings: [], revision: 0 }
    this.texts = new Map() // page id -> the last text outline read: {at, url, title, lines, more}
    this.fileTexts = new Map() // visual file -> the text last read (a change is a new visual)
    this.mine = separate ? new Set() : null
    this.holders = [] // agent names in the order they were attached (keeper: the first that can answer)
    this.answers = new Set() // holders that hold <id>.answer
    this.pulled = 0
    this.pulling = null
    this.filesPulled = 0
    this.reading = null
    this.agents = new Map() // holder name -> agent (the owner's calls read files through a holder's host)
    this.forced = new Set() // visual ids whose bound script the owner asked to run now
    this.acted = new Map() // holder name -> the page id it last acted on (its next step sees that page's newest shot)
    this.seen = new Map() // holder name -> Map(page id -> the shot n already in one of its model calls)
  }

  // The newest screenshot of the page this holder last acted on, when its model has not seen it yet: one image for its
  // next model call ({media_type, data, caption, ref}); none when it acted on no page, the page has no new shot, or the
  // host cannot give it (never fatal: the step goes on with the text outline).
  async images(agent) {
    const id = this.acted.get(agent?.name)
    const page = id && this.state.pages.find((p) => p.id === id)
    const n = page?.shot?.n
    if (!n) return []
    const seen = this.seen.get(agent.name) ?? new Map()
    if ((seen.get(id) ?? 0) >= n) return []
    const host = agent.context?.host
    if (!host?.get) return []
    let img
    try {
      img = await host.get(`browser/image?id=${encodeURIComponent(id)}&n=${n}`)
    } catch (error) {
      // thrown on: the agent says the step went without its screenshot (a refresh row — 2026-10-23 audit)
      throw new Error(`screenshot ${n} of ${id} did not load: ${hostError(error)}`)
    }
    if (!img?.data) return []
    seen.set(id, n)
    this.seen.set(agent.name, seen)
    const caption = `screenshot ${n} of preview page ${id} — ${clip(flat(page.url), 200)}${page.title ? ` "${clip(flat(page.title), 80)}"` : ""}, ${img.width}×${img.height}, after your last action on it (the owner sees this page in the pane)`
    return [{ media_type: img.media_type ?? "image/jpeg", data: img.data, caption, ref: { source: this.name, page: id, n, width: img.width ?? null, height: img.height ?? null, url: page.shot.url ?? null } }]
  }

  attach(agent, { commands = null } = {}) {
    if (!this.holders.includes(agent.name)) this.holders.push(agent.name)
    this.agents.set(agent.name, agent)
    if (!commands || commands.includes("answer")) this.answers.add(agent.name)
  }

  detach(agent) {
    this.holders = this.holders.filter((n) => n !== agent.name)
    this.agents.delete(agent.name)
    this.answers.delete(agent.name)
  }

  // The agent the owner's questions go to: the first holder that can answer them.
  keeper() {
    return this.holders.find((n) => this.answers.has(n)) ?? null
  }

  openAsks() {
    return this.state.asks.filter((a) => !a.answer)
  }

  // ---- state ----

  // A change: the patch replaces those fields; changed() and a new revision only when one differs (force: an agent's
  // act — show, focus, answer, drop, open — always moves the revision, so a follower's pane moves).
  #commit(patch, force = false) {
    if (!force && Object.keys(patch).every((k) => JSON.stringify(patch[k]) === JSON.stringify(this.state[k]))) return false
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 }
    this.changed()
    return true
  }

  // The pages as the host lists them; a current page no longer listed leaves the pane.
  #setPages(pages, { current = this.state.current, force = false } = {}) {
    const list = pages.slice(0, PAGES_MAX)
    const next = current?.kind === "page" && !list.some((p) => p.id === current.id) ? null : current
    const moved = current !== this.state.current // a page opened into the pane: a new place, the trail starts again
    return this.#commit({ pages: list, current: next, ...(moved ? { trail: [] } : {}) }, force)
  }

  #take(pages) {
    const shown = (pages ?? []).filter((p) => p?.id && (!this.mine || this.mine.has(p.id)))
    for (const id of this.texts.keys()) if (!shown.some((p) => p.id === id)) this.texts.delete(id)
    this.#setPages(shown.map(twinOf))
  }

  #merge(p, options) {
    if (!p?.id || (this.mine && !this.mine.has(p.id))) return
    const at = (x) => Date.parse(x.at ?? "") || 0
    this.#setPages([twinOf(p), ...this.state.pages.filter((x) => x.id !== p.id)].sort((a, b) => at(b) - at(a)), options)
  }

  // The item an id names: {kind: visual | page, id} (a visual first), else null.
  #item(id) {
    const key = String(id ?? "").trim()
    if (!key) return null
    if (this.state.visuals.some((v) => v.id === key)) return { kind: "visual", id: key }
    if (this.state.pages.some((p) => p.id === key)) return { kind: "page", id: key }
    return null
  }

  // What the owner's ask says was in the pane: {kind, id} or an id, when the preview has it.
  #itemOf(raw) {
    if (raw == null || raw === "") return null
    const ref = typeof raw === "object" ? raw : { id: raw }
    const item = this.#item(ref.id)
    return item && (ref.kind == null || ref.kind === item.kind) ? item : ref.kind === "page" && this.state.pages.some((p) => p.id === String(ref.id)) ? { kind: "page", id: String(ref.id) } : null
  }

  #unknown(id) {
    const pages = this.state.pages.map((p) => `${p.id} (${p.url}${p.status === "closed" ? ", closed" : ""})`)
    const visuals = this.state.visuals.map((v) => v.id)
    if (!pages.length && !visuals.length) return `nothing in the preview yet: ${this.name}.open {url} opens a page, ${this.name}.show {id, title, says, visual} draws a visual`
    return `no page or visual ${id ? `"${clip(id, 60)}"` : '""'} in the preview — pages: ${pages.join(", ") || "none"}; visuals: ${visuals.join(", ") || "none"}`
  }

  // An item in words: a command's answer, the pane's line; says: with what its visual says (the deliver text).
  #describe(item, { says = false } = {}) {
    if (!item) return null
    if (item.kind === "visual") {
      const v = this.state.visuals.find((x) => x.id === item.id)
      const params = paramsText(item.params ?? v?.params)
      return v ? `the visual ${v.id}${params ? ` (${params})` : ""} "${flat(v.title)}" [${sourceLine(v.visual)}]${says && v.says ? ` — it says: "${clip(flat(v.says), 200)}"` : ""}` : `the visual ${item.id}`
    }
    const p = this.state.pages.find((x) => x.id === item.id)
    const view = this.state.current?.kind === "page" && this.state.current.id === item.id ? this.state.current.view : null
    return p ? `the page ${p.id} ${flat(p.url)}${view ? ` #${view}` : ""}${p.title ? ` "${clip(flat(p.title), 120)}"` : ""}` : `the page ${item.id}`
  }

  // What goes in the pane when the visual in it is dropped: the newest visual left, else the newest open page.
  #fallback(visuals) {
    const last = visuals.at(-1)
    if (last) return { kind: "visual", id: last.id }
    const page = this.state.pages.find((p) => p.status === "open")
    return page ? { kind: "page", id: page.id } : null
  }

  // ---- refresh: the pages (browser/list) and the visual files ----

  async refresh(agent) {
    const ctx = ctxOf(agent)
    const [pages] = await Promise.allSettled([this.#pullPages(ctx), this.#pullFiles(ctx)])
    if (pages.status === "rejected") throw pages.reason
  }

  #pullPages(ctx) {
    if (this.pulling) return this.pulling
    if (Date.now() - this.pulled < REFRESH_MS) return
    this.pulling = this.#pull(ctx).finally(() => (this.pulling = null))
    return this.pulling
  }

  async #pull(ctx) {
    const r = await this.#call("browser/list", null, ctx)
    this.pulled = Date.now()
    this.#take(r?.pages)
  }

  // Every file visual read again (at most every VISUAL_MS, coalesced across holders and the host's poll).
  #pullFiles(ctx) {
    if (!this.state.visuals.some((v) => v.visual?.file)) return
    if (this.reading) return this.reading
    if (Date.now() - this.filesPulled < VISUAL_MS) return
    this.reading = this.#readFiles(ctx).finally(() => (this.reading = null))
    return this.reading
  }

  async #readFiles(ctx) {
    // The bound scripts first: one that just ended well is read below, in this same pass.
    const binds = await this.#pullBinds(ctx).catch((e) => (logOf(ctx)?.(`preview: bound scripts not checked: ${e.message}`), new Map()))
    const files = [...new Set(this.state.visuals.filter((v) => v.visual?.file).map((v) => v.visual.file))]
    for (const f of [...this.fileTexts.keys()]) if (!files.includes(f)) this.fileTexts.delete(f)
    const read = new Map()
    for (const f of files) read.set(f, await this.#fileVisual(f, ctx).catch((e) => ({ error: e.message })))
    this.filesPulled = Date.now()
    // A failed read keeps the last visual with its error; a good one clears the error. A bind's news applies only to
    // the bind it was about (an agent may have redrawn the visual meanwhile).
    const visuals = this.state.visuals.map((v) => {
      const b = binds.get(v.id)
      const bind = b && v.bind && b.command === v.bind.command && b.watch.join("\n") === v.bind.watch.join("\n") ? b : v.bind
      const r = v.visual?.file ? read.get(v.visual.file) : null
      if (!r) return bind === v.bind ? v : entry({ ...v, bind })
      const error = r.error && bind && /: not found$/.test(r.error) ? `${v.visual.file}: not made yet — its bound script makes it` : r.error
      return r.error ? entry({ ...v, bind, error }) : entry({ ...v, bind, visual: r.visual, read_at: r.read_at, error: null })
    })
    this.#commit({ visuals })
  }

  // A read pass now (an owner's open, a rerun): after the one in flight, if any.
  async #readNow(ctx) {
    if (this.reading) await this.reading.catch(() => {})
    this.filesPulled = 0
    await this.#pullFiles(ctx)
  }

  // ---- bound scripts ----

  // The newest mtime (ms) of the files a watch glob matches (filled from params) within the binder's reads: lane (its
  // "!" exclusions too), 0 when none.
  async #newest(glob, ctx, reads = null) {
    if (GLOB.test(glob)) {
      const files = await expandGlob(this.adapter, glob, ctx)
      // a watched folder that would not list: said once per glob, else the script just stops running (2026-10-23 audit)
      const blind = (files.unreadable ?? []).join(", ")
      if (blind && this.blindWatch?.get(glob) !== blind) logOf(ctx)?.(`preview: the watch ${glob} cannot see ${blind} — changes there do not re-run its script`)
      ;(this.blindWatch ??= new Map()).set(glob, blind)
      return files.filter((f) => !secret(f.path) && (reads == null || inLane(reads, f.path))).reduce((m, f) => Math.max(m, Number(f.mtime) || 0), 0)
    }
    if (reads != null && !inLane(reads, glob)) return 0
    return (await this.#mtime(glob, ctx)) ?? 0
  }

  // A file's mtime (ms), null when it is missing.
  async #mtime(path, ctx) {
    const parts = path.split("/")
    let entries
    try {
      entries = await this.adapter.list(parts.slice(0, -1).join("/"), ctx)
    } catch (e) {
      if (e?.status === 404 || e?.status === 400) return null
      throw e
    }
    const hit = (entries ?? []).find((e) => e?.name === parts.at(-1) && e.type !== "dir")
    return hit ? Number(hit.mtime) || 0 : null
  }

  // The watched files' newest mtime for a visual's bind (its params filled in).
  async #inputsAt(v, ctx) {
    let newest = 0
    for (const g of v.bind.watch) newest = Math.max(newest, await this.#newest(cleanPath(fill(g, v.params, "bind.watch")), ctx, v.bind.reads ?? null))
    return newest
  }

  // Why a bound script should run now ({command, inputs, why}), else null.
  async #due(v, ctx) {
    const b = v.bind
    const command = fill(b.command, v.params, "bind.command")
    const inputs = await this.#inputsAt(v, ctx)
    if (this.forced.has(v.id)) return { command, inputs, why: "the owner asked" }
    if (b.ran !== command) {
      // never run here (or for these params): when its file is missing, or older than what it reads
      const out = await this.#mtime(v.visual.file, ctx)
      if (out == null) return { command, inputs, why: `${v.visual.file} is missing` }
      if (b.ran != null && !v.template) return { command, inputs, why: "its params changed" }
      if (inputs > out + MTIME_SLACK && !(this.clock().getTime() - Date.parse(b.ran_at ?? "") < BIND_GAP_MS)) return { command, inputs, why: "a watched file is newer than it" }
      return null
    }
    if (!(inputs > (b.inputs_at ?? 0) + MTIME_SLACK)) return null
    // a backstop against scripts that keep starting each other: a watched change runs the same bind at most every gap
    const since = this.clock().getTime() - Date.parse(b.ran_at ?? "")
    return since < BIND_GAP_MS ? null : { command, inputs, why: "a watched file changed" }
  }

  // A session that ended: the bind's exit, time and error (the visual stays as it was when it failed).
  async #ended(v, s, ctx) {
    const exit = s?.exit ?? null
    const ms = s?.endedAt && s?.startedAt ? Math.max(0, Date.parse(s.endedAt) - Date.parse(s.startedAt)) : null
    const prog = String(v.bind.ran ?? v.bind.command).split(/\s+/).slice(0, 2).join(" ")
    const last = (s?.tail ?? []).map((l) => flat(l)).filter(Boolean).at(-1)
    const error = !s ? "its terminal session is gone" : exit === 0 ? null : `${prog} ${exit != null ? `exited ${exit}` : s.status}${last ? `: ${clip(last, 200)}` : ""}`
    // the inputs as they are now: what the run itself wrote under a watched glob never starts the next run
    const inputs = await this.#inputsAt(v, ctx).catch(() => v.bind.inputs_at)
    return { ...v.bind, running: false, exit, ms, error, inputs_at: Math.max(inputs ?? 0, v.bind.inputs_at ?? 0) }
  }

  // The binds' news: a running one's session read (ended, timed out), else one due started (one at a time).
  // → Map(visual id -> bind)
  async #pullBinds(ctx) {
    const out = new Map()
    const bound = this.state.visuals.filter((v) => v.bind)
    if (!bound.length) return out
    const host = hostOf(ctx)
    const running = bound.filter((v) => v.bind.running)
    if (running.length) {
      // 2026-10-23 audit 18: a status read that fails says so on each running bind (it stays running: unknown, not ended)
      let sessions
      try {
        sessions = (await host.get("term/list?tail=5", { signal: ctx.signal }))?.sessions ?? []
      } catch (e) {
        for (const v of running) out.set(v.id, { ...v.bind, error: `its session's status could not be read: ${e.message}` })
        return out
      }
      for (const v of running) {
        const s = sessions.find((x) => x.id === v.bind.session)
        if (s?.status === "running") {
          const age = this.clock().getTime() - Date.parse(v.bind.ran_at ?? "")
          if (!(age > v.bind.timeout * 1000)) continue
          // a stop that fails leaves it running with the reason (never "stopped" while it may still hold its lease)
          const failed = await host.post("term/stop", { id: s.id }, { signal: ctx.signal }).then(() => null, (e) => e.message)
          if (failed) out.set(v.id, { ...v.bind, error: `timed out after ${v.bind.timeout} s — the stop failed (${failed}); it may still run` })
          else out.set(v.id, { ...(await this.#ended(v, { ...s, status: "stopped" }, ctx)), error: `timed out after ${v.bind.timeout} s — stopped` })
          continue
        }
        out.set(v.id, await this.#ended(v, s, ctx))
      }
    }
    if (bound.some((v) => v.bind.running && !out.has(v.id))) return out // one at a time
    for (const was of bound) {
      const v = out.has(was.id) ? { ...was, bind: out.get(was.id) } : was // one that just ended: as it is now
      let due
      try {
        due = await this.#due(v, ctx)
      } catch (e) {
        out.set(v.id, { ...(out.get(v.id) ?? v.bind), error: e.message })
        continue
      }
      if (!due) continue
      const b = out.get(v.id) ?? v.bind
      const body = { command: due.command, ...(b.cwd ? { cwd: fill(b.cwd, v.params, "bind.cwd") } : {}), name: `viz:${v.id}`, ...(b.lease ? { lease: b.lease } : {}), agent: b.by, writes: b.writes, wait: 0, slot: BIND_SLOT }
      let r
      try {
        r = await host.post("term/start", body, { signal: ctx.signal })
      } catch (e) {
        // a held lease, or the binder's viz session busy: the next pass tries again
        if (e?.status === 409) out.set(v.id, { ...b, waiting: hostError(e) })
        else out.set(v.id, { ...b, ran: due.command, inputs_at: due.inputs, ran_at: this.clock().toISOString(), error: `term/start: ${hostError(e)}`, waiting: null })
        this.forced.delete(v.id)
        break
      }
      this.forced.delete(v.id)
      const started = { ...b, running: true, session: r?.session?.id ?? null, ran_at: this.clock().toISOString(), ran: due.command, inputs_at: due.inputs, exit: null, ms: null, error: null, waiting: null }
      out.set(v.id, r?.session && r.session.status !== "running" ? await this.#ended({ ...v, bind: started }, r.session, ctx) : started)
      break
    }
    return out
  }

  // A bind as preview.show asks for it → its twin fields, or an Error naming what to write. file: the visual's file
  // (resolved); params: the visual's; was: the bind the visual had (its history kept when nothing it runs changed).
  #bindOf(raw, { file, params }, agent, was = null, id = null) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error('bind: {command, watch: [globs], cwd?, lease?, timeout?} — the script that writes the visual\'s file, run again when a watched file changes')
    const name = agent?.name ?? "the binder"
    const command = need(raw.command, "bind.command: the script that writes the file, e.g. python -B 03_architecture/arch.py --out out/model/arch.json (one program, or several joined by &&; {name}s from the params)")
    if (command.length > COMMAND_MAX) throw new Error(`bind.command: ${command.length} chars — at most ${COMMAND_MAX}`)
    fill(command, params, "bind.command")
    const watch = list(raw.watch)
    if (!watch.length) throw new Error('bind.watch: the files whose change runs it again (globs), e.g. ["projects/x/llm/architecture/**", "projects/x/04_training/configs/*.json"]')
    if (watch.length > WATCH_MAX) throw new Error(`bind.watch: ${watch.length} globs — at most ${WATCH_MAX}`)
    const writes = list(agent?.config?.writes)
    if (!writes.length) throw new Error(`bind: ${name} has no writes: lane — its command could not write ${file}`)
    if (!inLane(writes, file)) throw new Error(`bind: ${file} is outside ${name}'s writes: lane (${writes.join(", ")}) — the command writes the visual's file`)
    const reads = agent?.config?.reads == null ? null : list(agent.config.reads)
    const globs = this.#watchCheck(watch, { id, file, params, reads, name })
    const cwd = raw.cwd == null || raw.cwd === "" ? null : cleanPath(raw.cwd) || null
    if (cwd) fill(cwd, params, "bind.cwd")
    const lease = raw.lease == null || raw.lease === "" ? null : String(raw.lease).trim()
    if (lease && !LEASE.test(lease)) throw new Error(`bind.lease: "${clip(lease, 30)}" — a short name such as gpu (a CPU script needs none)`)
    const timeout = raw.timeout == null || raw.timeout === "" ? BIND_TIMEOUT : Math.round(Number(raw.timeout))
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > BIND_TIMEOUT_MAX) throw new Error(`bind.timeout: seconds, 1 to ${BIND_TIMEOUT_MAX}`)
    const next = { command, watch: globs, cwd, lease, timeout, by: agent?.name ?? null, writes }
    // nothing it runs changed: its history stays
    const old = was && was.command === command && was.watch.join("\n") === globs.join("\n") && was.cwd === cwd ? was : {}
    return { ...next, running: old.running ?? false, session: old.session ?? null, ran_at: old.ran_at ?? null, ran: old.ran ?? null, inputs_at: old.inputs_at ?? null, exit: old.exit ?? null, ms: old.ms ?? null, error: old.error ?? null, waiting: null, reads }
  }

  // A bind's watch globs checked (at show, and again when params change them) → the globs as written, or an Error:
  // each filled from params; never the configuration; starting at a folder (a glob at the top would walk the whole
  // workspace every pass); covered by one of the binder's reads: globs (globCovers, conservative: when unsure,
  // refused) or, a plain path, in its lane; never the visual's own file, nor another bound visual's file — and no other
  // bind's watch holds this one's file (two scripts would start each other forever).
  #watchCheck(watch, { id, file, params, reads, name }) {
    const others = this.state.visuals.filter((v) => v.id !== id && v.bind && v.visual?.file)
    for (const o of others)
      for (const g of o.bind.watch) {
        let p
        try {
          p = cleanPath(fill(g, o.params, "bind.watch"))
        } catch {
          continue
        }
        if (globRegex(p).test(file)) throw new Error(`bind: ${o.id}'s bound script watches ${p}, which holds ${file} — each script would start the other`)
      }
    return watch.map((g, i) => {
      const t = cleanPath(g)
      if (!t) throw new Error(`bind.watch[${i}]: a workspace path or glob`)
      const p = cleanPath(fill(t, params, `bind.watch[${i}]`))
      if (secret(p, GLOB.test(p))) throw new Error(`bind.watch[${i}]: ${p} is ASKK's configuration — never read`)
      if (GLOB.test(p.split("/")[0])) throw new Error(`bind.watch[${i}]: ${p} — a watch starts at a folder (projects/<slug>/…), never a glob at the top`)
      if (reads != null && !(GLOB.test(p) ? reads.some((r) => globCovers(r, p)) : inLane(reads, p))) throw new Error(`bind.watch[${i}]: ${p} is outside ${name}'s reads: lane (${reads.join(", ")})`)
      if (globRegex(p).test(file)) throw new Error(`bind.watch[${i}]: ${t} holds the visual's own file — each run would start the next`)
      for (const o of others) if (globRegex(p).test(o.visual.file)) throw new Error(`bind.watch[${i}]: ${p} holds ${o.visual.file}, the file ${o.id}'s bound script writes — each script would start the other`)
      return t
    })
  }

  // A file visual read now: {visual: {file, …spec}, read_at}, or an Error saying what is wrong. The same text as last
  // time keeps the visual it made (no change to stream).
  async #fileVisual(file, ctx) {
    let r
    try {
      r = await this.adapter.read(file, ctx)
    } catch (e) {
      throw new Error(`${file}: ${hostError(e)}`)
    }
    if (!r) throw new Error(`${file}: not found`)
    if (r.binary) throw new Error(`${file}: not a text file`)
    const text = String(r.text ?? "")
    if (r.truncated || text.length > FILE_MAX) throw new Error(`${file}: over ${FILE_MAX} chars — fewer frames or a smaller slice`)
    const others = [...this.fileTexts].filter(([f]) => f !== file).reduce((n, [, t]) => n + t.length, 0)
    if (others + text.length > FILES_MAX) throw new Error(`${file}: the preview's visual files together pass ${FILES_MAX} chars — make it smaller`)
    const shown = this.state.visuals.find((v) => v.visual?.file === file && v.visual.kind)
    if (shown && this.fileTexts.get(file) === text) return { visual: shown.visual, read_at: shown.read_at ?? this.clock().toISOString() }
    let spec
    try {
      spec = checkSpec(text, FILE_MAX)
    } catch (e) {
      throw new Error(`${file}: ${e.message}`)
    }
    this.fileTexts.set(file, text)
    return { visual: { file, ...spec }, read_at: this.clock().toISOString() }
  }

  // ---- pages ----

  async #call(path, body, ctx) {
    try {
      return path === "browser/list" ? await hostOf(ctx).get(path, { signal: ctx.signal }) : await hostOf(ctx).post(path, body, { signal: ctx.signal })
    } catch (e) {
      throw new Error(`${path}: ${hostError(e)}`)
    }
  }

  // The page a command means: `id` (a page id), else the newest open one (read from the host when none is known).
  async #page(input, ctx) {
    const want = String(input?.id ?? "").trim()
    if (want) return want
    let open = this.state.pages.filter((p) => p.status === "open")
    if (!open.length) {
      this.#take((await this.#call("browser/list", null, ctx))?.pages)
      open = this.state.pages.filter((p) => p.status === "open")
    }
    if (!open.length) throw new Error(`no page open: ${this.name}.open {url} first (an app on this computer, e.g. http://localhost:8001)`)
    return open[0].id
  }

  // The page's text outline, kept for the prompt: {at, url, title, lines, more}.
  async #read(id, ctx) {
    const r = await this.#call("browser/text", { id }, ctx)
    const o = outline(r?.text)
    const text = { at: this.clock().toISOString(), url: r?.url ?? "", title: r?.title ?? "", ...o, whole: String(r?.text ?? "") }
    this.texts.set(id, text)
    return text
  }

  // An action that changes the page: the host acts (and shoots); the answer is the page's line and its outline. A page
  // it opens goes in the pane (view: the #view of its URL).
  async #act(path, body, input, ctx, { opens = false, view = null } = {}) {
    const id = opens ? null : await this.#page(input, ctx)
    const r = await this.#call(path, opens ? body : { id, ...body }, ctx)
    const page = r?.page
    if (page?.id && ctx.agent?.name) this.acted.set(ctx.agent.name, page.id)
    this.#frame(page, path, body)
    if (opens && page?.id) {
      this.mine?.add(page.id)
      this.#merge(page, { current: { kind: "page", id: page.id, ...(view ? { view } : {}) }, force: true })
    } else this.#merge(page)
    if (!page || page.status !== "open") return headOf(twinOf(page ?? { id, url: "", status: "closed" }))
    let text
    try {
      text = await this.#read(page.id, ctx)
    } catch (e) {
      return `${headOf(twinOf(page))}\n(its text could not be read: ${e.message})`
    }
    const errors = (page.console ?? []).filter(isError).slice(-3).map((l) => `  console ${l.level}: ${clip(l.text, LINE_CHARS)}`)
    return result([headOf(twinOf(page)), ...errors, ...text.lines.map((l) => `  ${l}`), ...(text.more ? [`  … ${text.more} more lines: ${this.name}.text`] : [])].join("\n"))
  }

  // ---- commands: pages ----

  open(input = {}, ctx = {}) {
    const url = need(input.url, "url: the app's page on this computer, e.g. http://localhost:8001 (a URL its terminal session printed)")
    const given = (v) => v != null && v !== ""
    const size = { ...(given(input.width) ? { width: Number(input.width) } : {}), ...(given(input.height) ? { height: Number(input.height) } : {}) }
    return this.#act("browser/open", { url, by: ctx.agent?.name ?? null, ...size }, input, ctx, { opens: true, view: viewOf(url) })
  }

  goto(input = {}, ctx = {}) {
    const url = need(input.url, "url: where to go")
    return this.#act("browser/navigate", { url }, input, ctx)
  }

  click(input = {}, ctx = {}) {
    const selector = String(input.selector ?? "").trim()
    const xy = input.x != null && input.y != null && input.x !== "" && input.y !== ""
    if (!selector && !xy) throw new Error("selector (a CSS selector, e.g. button#save) or x and y (pixels)")
    return this.#act("browser/click", selector ? { selector } : { x: Number(input.x), y: Number(input.y) }, input, ctx)
  }

  type(input = {}, ctx = {}) {
    if (input.text == null) throw new Error("text: what to type")
    return this.#act("browser/type", { text: String(input.text), ...(input.selector ? { selector: String(input.selector) } : {}) }, input, ctx)
  }

  press(input = {}, ctx = {}) {
    const key = need(input.key, "key: Enter, Tab, Escape, ArrowDown … or one character")
    return this.#act("browser/press", { key }, input, ctx)
  }

  scroll(input = {}, ctx = {}) {
    const dy = Number(input.dy)
    if (!Number.isFinite(dy)) throw new Error("dy: pixels to scroll down (negative: up)")
    return this.#act("browser/scroll", { dy }, input, ctx)
  }

  async text(input = {}, ctx = {}) {
    const id = await this.#page(input, ctx)
    const text = await this.#read(id, ctx)
    return result(`${text.title ? `"${text.title}" ` : ""}${text.url}\n${text.whole || "(no visible text)"}`)
  }

  // The page a command means and the host's answer to `path` for it.
  async #onPage(path, input, ctx, body = {}) {
    const id = await this.#page(input, ctx)
    return [id, await this.#call(path, { id, ...body }, ctx)]
  }

  async eval(input = {}, ctx = {}) {
    const expression = need(input.expression, "expression: JavaScript evaluated in the page, e.g. document.title")
    const [, r] = await this.#onPage("browser/eval", input, ctx, { expression })
    this.#merge(r?.page)
    const value = typeof r?.value === "string" ? r.value : JSON.stringify(r?.value ?? null)
    return result(`${value ?? "undefined"}${r?.truncated ? "\n… cut by the host" : ""}`)
  }

  async console(input = {}, ctx = {}) {
    const [, r] = await this.#onPage("browser/console", input, ctx)
    const lines = (r?.lines ?? []).slice(-50).map((l) => `[${l.level}] ${clip(l.text, LINE_CHARS)}`)
    return lines.length ? result(lines.join("\n")) : "no console lines"
  }

  async shot(input = {}, ctx = {}) {
    const [id, r] = await this.#onPage("browser/shot", input, ctx)
    if (ctx.agent?.name) this.acted.set(ctx.agent.name, id)
    this.#merge(r?.page)
    this.#frame(r?.page, "browser/shot", {})
    const s = r?.shot
    return s ? `shot ${s.n} of ${id}${s.width ? ` (${s.width}×${s.height})` : ""} — the owner sees it in the preview, and it is attached to your next step: look at it there` : `${id}: no screenshot`
  }

  // ---- commands: recordings ----

  // A page's recording running now (one at a time per page).
  #recording(pageId) {
    return (this.state.recordings ?? []).find((x) => x.status === "recording" && x.page === pageId) ?? null
  }

  // After an action: a frame on the page's running recording — the shot it left, what was done, where.
  #frame(page, path, body = {}) {
    const rec = page?.id ? this.#recording(page.id) : null
    if (!rec || !page.shot?.n || rec.frames.at(-1)?.n === page.shot.n) return
    const action = String(path).split("/").pop()
    const what = body.selector ?? (body.x != null ? `${body.x},${body.y}` : null) ?? body.url ?? body.key ?? (body.text != null ? `"${clip(flat(body.text), 60)}"` : null) ?? (body.dy != null ? `dy ${body.dy}` : null)
    const frames = [...rec.frames, { n: page.shot.n, at: this.clock().toISOString(), action, what: what == null ? null : clip(flat(String(what)), 120), url: page.url ?? null }].slice(-FRAMES_MAX)
    this.bump({ recordings: this.state.recordings.map((x) => (x.id === rec.id ? { ...x, frames } : x)) })
  }

  async record(input = {}, ctx = {}) {
    const title = clip(flat(need(input.title, "title: what the recording shows")), TITLE_MAX)
    const id = await this.#page(input, ctx)
    if (this.#recording(id)) throw new Error(`${id} is being recorded already (${this.#recording(id).id}): ${this.name}.cut ends it`)
    const by = ctx.agent?.name ?? null
    const mine = (this.state.recordings ?? []).find((x) => x.status === "recording" && x.by === by)
    if (mine) throw new Error(`you are recording ${mine.page} already (${mine.id}): ${this.name}.cut first`)
    await this.#call("browser/record", { id, on: true }, ctx)
    const n = (this.state.recordings ?? []).reduce((m, x) => Math.max(m, Number(String(x.id).slice(1)) || 0), 0) + 1
    const rec = { id: `r${n}`, title, page: id, by, at: this.clock().toISOString(), ended_at: null, status: "recording", note: null, frames: [] }
    const done = (this.state.recordings ?? []).filter((x) => x.status !== "recording")
    const keep = [...(this.state.recordings ?? []).filter((x) => x.status === "recording"), ...done.slice(-(RECORDINGS_MAX - 1))]
    this.bump({ recordings: [...keep, rec].sort((a, b) => String(a.at).localeCompare(String(b.at))) })
    const r = await this.#call("browser/shot", { id }, ctx)
    this.#merge(r?.page)
    this.#frame(r?.page, "browser/start", { url: r?.page?.url })
    return `recording ${rec.id} of ${id}: "${title}" — every action on the page is a frame now; ${this.name}.cut ends it`
  }

  async cut(input = {}, ctx = {}) {
    const by = ctx.agent?.name ?? null
    const rec = (this.state.recordings ?? []).find((x) => x.status === "recording" && x.by === by)
    if (!rec) throw new Error(`you are recording nothing: ${this.name}.record {title} starts one`)
    await this.#call("browser/record", { id: rec.page, on: false }, ctx).catch(() => null) // a closed page: its frames stay
    const note = clip(flat(String(input.note ?? "")), SAYS_MAX) || null
    this.bump({ recordings: this.state.recordings.map((x) => (x.id === rec.id ? { ...x, status: "done", ended_at: this.clock().toISOString(), note } : x)) })
    return `recording ${rec.id} ended: ${rec.frames.length} frames of ${rec.page} — the owner plays it back in the pane`
  }

  async close(input = {}, ctx = {}) {
    const [id, r] = await this.#onPage("browser/close", input, ctx)
    this.#merge(r?.page)
    this.texts.delete(id)
    return `closed ${id}`
  }

  // ---- commands: visuals and the pane ----

  async show(input = {}, ctx = {}) {
    const id = String(input.id ?? "").trim()
    if (!VISUAL_ID.test(id)) throw new Error(`id: "${clip(id, 40)}" — a short word for the visual (letters, digits, - or _), e.g. pipeline`)
    if (this.state.pages.some((p) => p.id === id)) throw new Error(`id: ${id} is a page's id — name the visual another way`)
    this.#room(id)
    const want = visualRequest(input.visual)
    let visual = want.spec ?? null
    let read_at = null
    let bind = null
    let error = null
    const reads = ctx.agent?.config?.reads
    if (input.bind != null && input.bind !== "" && !want.file) throw new Error("bind: only with a {file} visual — the script writes the file, the preview reads it")
    if (want.file) {
      if (reads != null && !inLane(reads, want.file)) throw new Error(`visual.file: ${want.file} is outside ${ctx.agent.name}'s reads: lane`)
      const was = this.state.visuals.find((v) => v.id === id)?.bind ?? null
      if (input.bind != null && input.bind !== "") bind = this.#bindOf(input.bind, want, ctx.agent, was, id)
      try {
        ;({ visual, read_at } = await this.#fileVisual(want.file, ctx)) // its errors go back to the agent now
      } catch (e) {
        if (!bind || !/: not found$/.test(e.message)) throw e
        visual = { file: want.file } // its bound script makes it
        error = `${want.file}: not made yet — its bound script makes it`
      }
    }
    if (want.terminal) visual = await this.#terminalRef(want.terminal, ctx.agent)
    const title = clip(flat(input.title) || id, TITLE_MAX) // one line: the prompt and the pane's strip show it so
    const next = entry({ id, title, says: clip(String(input.says ?? "").trim(), SAYS_MAX), visual, by: ctx.agent?.name ?? null, at: this.clock().toISOString(), template: want.template ?? null, params: want.params ?? null, reads: want.template && reads != null ? list(reads) : null, bind, error, read_at })
    // The list as it is now: another holder may have drawn or dropped one while the file was read.
    const again = this.#room(id)
    const visuals = again ? this.state.visuals.map((v) => (v.id === id ? next : v)) : [...this.state.visuals, next]
    // a redraw of the item in the pane keeps the drill trail; another visual is a new place: the trail starts again
    const keep = this.state.current?.kind === "visual" && this.state.current.id === id
    this.#commit({ visuals, current: { kind: "visual", id, ...(next.params ? { params: next.params } : {}) }, trail: keep ? this.state.trail : [] }, true)
    if (bind) await this.#readNow(ctx).catch(() => {}) // a missing or stale file: its script starts now
    const b = this.state.visuals.find((v) => v.id === id)?.bind
    return `visual ${id} ${again ? "redrawn" : `added (${visuals.length} of ${VISUALS_MAX})`} [${sourceLine(visual)}] — in the owner's pane${want.file ? `; ${want.file} is read again as it changes` : ""}${b ? `; ${bindLine(b, this.clock().getTime())}` : ""}`
  }

  // Whether visual `id` is already held; a new one with all the places taken is an Error.
  #room(id) {
    const held = this.state.visuals.some((v) => v.id === id)
    if (!held && this.state.visuals.length >= VISUALS_MAX) throw new Error(`the preview holds ${VISUALS_MAX} visuals: ${this.name}.drop one first (${this.state.visuals.map((v) => v.id).join(", ")})`)
    return held
  }

  // {terminal}: a session of the desk's terminal; "main" / "long" / "<agent>:main" become that session's id.
  async #terminalRef(ref, agent) {
    if (!agent) return { terminal: ref }
    const terminals = reach(agent, "terminal")
    if (!terminals.length) throw new Error("visual.terminal: this desk has no terminal artifact — {terminal} shows a session its terminal runs")
    const slot = SLOT_REF.exec(ref)
    const sessions = () => terminals.flatMap((t) => t.state?.sessions ?? [])
    const find = () => (slot ? sessions().find((s) => s.agent === (slot[1] ?? agent.name) && String(s.slot ?? "").split(".").at(-1) === slot[2])?.id : sessions().find((s) => s.id === ref || s.name === ref) ? ref : null)
    let found = find()
    if (!found) {
      await Promise.all(terminals.map((t) => Promise.resolve(t.refresh?.(agent)).catch(() => {})))
      found = find()
    }
    if (found) return { terminal: found }
    if (slot) throw new Error(`visual.terminal: ${slot[1] ? `${slot[1]} has` : "you have"} no ${slot[2]} session yet (terminal.run opens the main one, terminal.start the long one)`)
    const listed = sessions()
      .slice(0, 8)
      .map((s) => `${s.id}${s.name && s.name !== s.command ? ` "${s.name}"` : ""} (${s.agent ?? "owner"}, ${s.status})`)
    throw new Error(`visual.terminal: no session "${clip(ref, 60)}"${listed.length ? ` — sessions: ${listed.join(", ")}` : " — none yet: terminal.start {command} starts one"}`)
  }

  async focus(input = {}, ctx = {}) {
    const id = String(input.id ?? "").trim()
    const view = String(input.view ?? "").trim().replace(/^#/, "")
    let raw = input.params || null
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw)
      } catch {
        throw new Error('params: {name: value}, e.g. {"t": 7}')
      }
    }
    const params = checkParams(raw, "params")
    if (params && this.state.visuals.some((v) => v.id === id)) {
      if (view) throw new Error("view: a visual has no views — view is a page's #hash")
      await this.#navigate(id, params, ctx, { push: true, reads: ctx.agent?.config?.reads })
      const v = this.state.visuals.find((x) => x.id === id)
      return `the owner's pane shows ${this.#describe(this.state.current)}${v?.error ? ` — ${v.error}` : ""}${v?.bind ? `; ${bindLine(v.bind, this.clock().getTime())}` : ""}`
    }
    if (params) throw new Error(`params: only a visual takes params — ${this.#unknown(id)}`)
    let item = this.#item(id)
    if (!item && id) {
      await this.#pull(ctx).catch(() => {}) // a page another holder opened since the last refresh
      item = this.#item(id)
    }
    if (!item) throw new Error(this.#unknown(id))
    if (item.kind === "visual") {
      if (view) throw new Error("view: a visual has no views — view is a page's #hash")
      const v = this.state.visuals.find((x) => x.id === id)
      const ref = { ...item, ...(v?.params ? { params: v.params } : {}) }
      this.#commit({ current: ref, trail: [] }, true) // a new place, not a drill: the trail starts again
      return `the owner's pane shows ${this.#describe(ref)}`
    }
    if (view && !VIEW.test(view)) throw new Error(`view: "${clip(view, 60)}" — the page's #hash, no spaces, e.g. attention`)
    this.#commit({ current: { ...item, ...(view ? { view } : {}) }, trail: [] }, true)
    const p = this.state.pages.find((x) => x.id === id)
    return `the owner's pane shows ${this.#describe(item)}${p.status === "closed" ? " (closed: its last screenshot)" : ""}${p.errors ? ` — it has ${plural(p.errors, "console error")}: ${this.name}.console` : ""}`
  }

  async answer(input = {}, ctx = {}) {
    const key = String(input.ask ?? "").trim()
    const q = this.state.asks.find((a) => a.id === key)
    const open = () => this.openAsks().map((a) => a.id).join(", ") || "none"
    if (!q) throw new Error(this.state.asks.length ? `no question ${key || '""'} — open: ${open()}` : "the owner has asked nothing in the preview")
    if (q.answer) throw new Error(`${q.id} is answered already (${q.answer.by ?? "?"}: "${clip(flat(q.answer.text), 80)}") — open: ${open()}`)
    const text = need(input.text, "text: the answer, with the numbers that show it")
    const raw = input.show && typeof input.show === "object" ? input.show.id : input.show
    const want = raw == null || raw === "" ? null : String(raw).trim()
    let on = want ? this.#item(want) : null
    if (want && !on) {
      await this.#pull(ctx).catch(() => {})
      on = this.#item(want)
    }
    if (want && !on) throw new Error(`show: ${this.#unknown(want)}`)
    const answer = { text: clip(text, ANSWER_MAX), on, by: ctx.agent?.name ?? null, at: this.clock().toISOString() }
    const same = on && this.state.current?.kind === on.kind && this.state.current.id === on.id
    this.#commit({ asks: this.state.asks.map((a) => (a === q ? { ...a, answer } : a)), current: on && !same ? on : this.state.current, trail: on && !same ? [] : this.state.trail }, true)
    const left = this.openAsks().length
    return `${q.id} answered${on ? `; the owner's pane shows ${this.#describe(on)}` : ""}${left ? `; ${left} still open` : ""}`
  }

  drop(input = {}) {
    const id = String(input.id ?? "").trim()
    const v = this.state.visuals.find((x) => x.id === id)
    if (!v) {
      if (this.state.pages.some((p) => p.id === id)) throw new Error(`${id} is a page: ${this.name}.close {id: "${id}"} closes it`)
      throw new Error(this.state.visuals.length ? `no visual ${id || '""'} — visuals: ${this.state.visuals.map((x) => x.id).join(", ")}` : "no visuals to drop")
    }
    const visuals = this.state.visuals.filter((x) => x !== v)
    const was = this.state.current
    const current = was?.kind === "visual" && was.id === id ? this.#fallback(visuals) : was
    this.forced.delete(id)
    this.#commit({ visuals, current, trail: this.state.trail.filter((t) => !(t.kind === "visual" && t.id === id)) }, true)
    return `visual ${id} dropped; ${visuals.length} left${current !== was ? `; the owner's pane shows ${current ? this.#describe(current) : "nothing"}` : ""}`
  }

  // ---- drill-down: params, the trail ----

  // The trail with the item in the pane now pushed (when `to` is another item or other params), ≤ TRAIL_MAX.
  #pushed(to) {
    const c = itemRef(this.state.current)
    if (!c || (c.kind === to.kind && c.id === to.id && sameParams(c.params, to.params))) return this.state.trail
    return [...this.state.trail, c].slice(-TRAIL_MAX)
  }

  // Put a visual in the pane with params merged into its own: a templated file resolves to its file for them (in the
  // drawer's reads: lane and, bound, the binder's writes:), read now; push: the item that was there goes on the trail.
  // reads: the caller's own lane too (an agent's focus). trail: the trail to keep instead (back).
  async #navigate(id, params, ctx, { push = true, reads = null, trail = null } = {}) {
    const v = this.state.visuals.find((x) => x.id === id)
    if (!v) throw new Error(this.#unknown(id))
    const merged = checkParams({ ...(v.params ?? {}), ...(params ?? {}) }, "params")
    let next = merged === v.params || sameParams(merged, v.params) ? v : entry({ ...v, params: merged })
    if (v.template) {
      const file = visualFile(v.template, merged)
      for (const lane of [v.reads, reads]) if (lane != null && !inLane(lane, file)) throw new Error(`${file} is outside the reads: lane (${list(lane).join(", ")})`)
      if (v.bind && !inLane(v.bind.writes, file)) throw new Error(`${file} is outside ${v.bind.by}'s writes: lane — its bound script could not write it`)
      if (file !== v.visual?.file) next = entry({ ...next, visual: { file }, error: "not read yet", read_at: null })
    }
    if (v.bind) {
      // new params fill the command and the watch globs anew: checked as at show (lane, loops)
      fill(v.bind.command, merged, "bind.command")
      this.#watchCheck(v.bind.watch, { id, file: next.visual?.file ?? v.visual?.file, params: merged, reads: v.bind.reads ?? null, name: v.bind.by ?? "the binder" })
    }
    const ref = { kind: "visual", id, ...(next.params ? { params: next.params } : {}) }
    this.#commit({ visuals: this.state.visuals.map((x) => (x.id === id ? next : x)), current: ref, trail: trail ?? (push ? this.#pushed(ref) : this.state.trail) }, true)
    if (next !== v || next.bind) await this.#readNow(ctx).catch(() => {}) // its file for these params, its script when due
    return ref
  }

  // The context an owner's call reads files and runs scripts with: the drawer's, else the keeper's, else a holder's.
  #ownerCtx(by = null) {
    const agent = this.agents.get(by ?? "") ?? this.agents.get(this.keeper() ?? "") ?? [...this.agents.values()][0] ?? null
    return ctxOf(agent)
  }

  async ownerOpen({ visual, params = null } = {}) {
    const id = String(visual ?? "").trim()
    if (!VISUAL_ID.test(id)) throw new Error("visual: the id of the visual to open")
    const v = this.state.visuals.find((x) => x.id === id)
    if (!v) throw new Error(this.#unknown(id))
    const ref = await this.#navigate(id, checkParams(params, "params"), this.#ownerCtx(v.by))
    return { current: ref, trail: this.state.trail }
  }

  async ownerBack() {
    const trail = [...this.state.trail]
    const to = trail.pop()
    if (!to) throw new Error("nothing to go back to")
    const v = to.kind === "visual" && this.state.visuals.find((x) => x.id === to.id)
    if (v) await this.#navigate(to.id, to.params ?? null, this.#ownerCtx(v.by), { trail })
    else if (to.kind === "page" && this.state.pages.some((p) => p.id === to.id)) this.#commit({ current: { kind: "page", id: to.id }, trail }, true)
    else this.#commit({ trail }, true) // it is gone: one step back further next time
    return { current: this.state.current, trail: this.state.trail }
  }

  async ownerRerun({ visual } = {}) {
    const id = String(visual ?? "").trim()
    const v = this.state.visuals.find((x) => x.id === id)
    if (!v) throw new Error(this.#unknown(id))
    if (!v.bind) throw new Error(`${id} has no bound script (preview.show … bind) — nothing to run`)
    if (v.bind.running) return { visual: id, bind: v.bind }
    this.forced.add(id)
    await this.#readNow(this.#ownerCtx(v.bind.by ?? v.by))
    return { visual: id, bind: this.state.visuals.find((x) => x.id === id)?.bind ?? null }
  }

  // ---- the owner (the host's team/call target artifact) ----

  // ask (sync): a question for the keeper; open / back / rerun (async): the owner drills down, goes back, or runs a
  // visual's bound script now — neither delivers a run.
  ownerAsk({ text, on, context = null }, from) {
    const question = need(text, "text: the question")
    if (question.length > ASK_MAX) throw new Error(`text: ${question.length} chars — at most ${ASK_MAX}`)
    const item = on === undefined ? itemRef(this.state.current) : this.#itemOf(on)
    const n = this.state.asks.reduce((m, a) => Math.max(m, Number(String(a.id).slice(1)) || 0), 0) + 1
    const q = { id: `q${n}`, text: question, on: item, context: contextOf(context), from: String(from || "owner"), at: this.clock().toISOString(), answer: null }
    let asks = [...this.state.asks, q]
    // Past the cap, answered questions go first; an open one stays until it is answered.
    while (asks.length > ASKS_MAX) {
      const i = asks.findIndex((a) => a.answer)
      asks = i >= 0 ? asks.filter((_, k) => k !== i) : asks.slice(1)
    }
    this.#commit({ asks }, true)
    const where = [item ? `about ${this.#describe(item, { says: true })}` : "with nothing in the pane", q.context && `pointing at ${inline(q.context)}`].filter(Boolean).join(", ")
    const draw = item?.kind === "visual" ? `redraw ${item.id} (${this.name}.show {id: "${item.id}", …}) or draw the visual that answers` : item?.kind === "page" ? `read the page (${this.name}.text {id: "${item.id}"}) and draw the visual that answers (${this.name}.show)` : `draw the visual that answers (${this.name}.show)`
    const deliver = `In the preview the owner asks (${q.id}, ${where}): "${question}"\nAnswer it in the preview: read the numbers, ${draw}, then ${this.name}.answer {ask: "${q.id}", text, show: "<the visual or page id>"} — a visual says more than words.`
    return { ask: q, deliver, keeper: this.keeper() }
  }

  // ---- views ----

  gate(agent) {
    if (!agent || !this.answers.has(agent.name)) return null
    const open = this.openAsks()
    return open.length ? `the owner asked in the preview: ${open.map((a) => `${a.id} "${clip(flat(a.text), 80)}"`).join("; ")} — ${this.name}.answer {ask, text, show?} each first` : null
  }

  brief() {
    const s = this.state
    const open = s.pages.filter((p) => p.status === "open").length
    const asks = this.openAsks().length
    const rec = (s.recordings ?? []).filter((x) => x.status === "recording").length
    const parts = [open && `${plural(open, "page")} open`, s.visuals.length && plural(s.visuals.length, "visual"), s.current && `▶ ${s.current.id}`, rec && `● recording`, asks && `${plural(asks, "question")} open`].filter(Boolean)
    return parts.length ? parts.join(" · ") : "nothing in the pane yet"
  }

  // A visual's source in the prompt: a terminal session as the desk has it now.
  #source(visual, agent) {
    if (!agent || !visual || visual.terminal == null) return sourceLine(visual)
    const s = reach(agent, "terminal")
      .flatMap((t) => t.state?.sessions ?? [])
      .find((x) => x.id === visual.terminal || x.name === visual.terminal)
    return s ? `terminal ${s.id}${s.name && s.name !== s.command ? ` "${flat(s.name)}"` : ""} ${s.status}${s.exit != null ? ` exit ${s.exit}` : ""} · ${clip(flat(s.command), 80)}` : `terminal ${visual.terminal} — no such session now`
  }

  #paneLine() {
    const c = this.state.current
    if (!c) return `nothing — ${this.name}.open {url} puts a page there, ${this.name}.show {id, title, says, visual} a visual`
    const p = c.kind === "page" ? this.state.pages.find((x) => x.id === c.id) : null
    const step = (x) => `${x.id}${x.params ? ` (${paramsText(x.params)})` : ""}`
    const path = this.state.trail.length ? ` · drilled: ${[...this.state.trail, c].map(step).join(" › ")}` : ""
    return `${this.#describe(c)}${p?.status === "closed" ? " (closed: its last screenshot)" : ""}${path}`
  }

  // The block, ≤ PROMPT_LINES lines: the pages' heads, the visuals, the pane and the questions first; the pages' errors
  // and text outlines fill what is left (a list too long for the block is cut to "… n more: ids").
  render(agent) {
    const s = this.state
    const can = this.can(agent)
    const head = `the one pane the owner watches with you: the app's pages (apps on this computer — you read their text, and after you act on a page its new screenshot is attached to your next step; the owner watches the same page) and the visuals you draw; the owner asks about what is in it${can.length ? `: ${can.join(", ")}` : ""}`
    let open = s.pages.filter((p) => p.status === "open")
    const closed = s.pages.length - open.length
    let heads = open.length ? open.map(headOf) : [`(no page open${closed ? `; ${closed} closed` : ""})`]
    const tailClosed = open.length && closed ? [`(${closed} closed)`] : []
    const cur = s.current
    // Every entry below is one line (flat): a title, an error, a page's console text or the owner's context may hold breaks.
    const now = this.clock().getTime()
    const visualItems = s.visuals.map((v) => `${cur?.kind === "visual" && cur.id === v.id ? "▶" : " "} ${v.id}${v.params ? ` (${paramsText(v.params)})` : ""} "${flat(v.title)}" [${this.#source(v.visual, agent)}]${v.error ? ` — ERROR ${clip(flat(v.error), 160)}` : ""}${v.bind ? ` · ${bindLine(v.bind, now)}` : ""}${v.says ? ` — ${clip(flat(v.says), PROMPT_SAYS)}` : ""}`)
    let visuals = visualItems.length ? ["VISUALS (▶ = in the pane):", ...visualItems] : []
    const recs = (s.recordings ?? []).filter((x) => x.status === "recording" || x === s.recordings.at(-1))
    const pane = [`IN THE PANE: ${this.#paneLine()}`, ...recs.map((x) => `RECORDING ${x.id} "${flat(x.title)}" of ${x.page} by ${x.by ?? "?"}: ${x.frames.length} frames${x.status === "recording" ? ` — running (${this.name}.cut ends it)` : " — done"}`)]
    const asked = this.openAsks()
    const askItems = asked.map((a) => `  ${a.id}${a.on ? ` on ${a.on.kind} ${a.on.id}` : ""}${a.context ? ` {${inline(a.context)}}` : ""}: "${flat(a.text)}"`)
    let asks = askItems.length ? [`OWNER ASKED (open${can.includes(`${this.name}.answer`) ? ` — ${this.name}.answer each` : ""}):`, ...askItems] : []
    const answered = s.asks.filter((a) => a.answer).slice(-PROMPT_ANSWERED)
    let answers = answered.length ? ["ANSWERED (latest):", ...answered.map((a) => `  ${a.id} "${clip(flat(a.text), 120)}" → ${clip(flat(a.answer.text), 160)}${a.answer.on ? ` [${a.answer.on.kind} ${a.answer.on.id}]` : ""}`)] : []
    // Over the block: the answered go first, then the visuals, the open questions and the pages' heads are cut.
    const used = () => 1 + heads.length + tailClosed.length + visuals.length + pane.length + asks.length + answers.length
    const over = () => used() - PROMPT_LINES
    if (over() > 0) answers = []
    if (over() > 0 && visualItems.length) {
      // The newest visuals stay, and always the one in the pane; the others go to one line.
      const n = Math.max(0, visualItems.length - over() - 1)
      const inPane = s.visuals.findIndex((v) => cur?.kind === "visual" && v.id === cur.id)
      const kept = new Set(inPane >= 0 && n > 0 ? [inPane] : [])
      for (let i = visualItems.length - 1; i >= 0 && kept.size < n; i--) kept.add(i)
      const gone = s.visuals.filter((_, i) => !kept.has(i)).map((v) => v.id)
      visuals = [visuals[0], `  … ${gone.length} more visuals: ${gone.join(", ")}`, ...visualItems.filter((_, i) => kept.has(i))]
    }
    if (over() > 0 && askItems.length) asks = [asks[0], ...cut(askItems, asked.map((a) => a.id), Math.max(0, askItems.length - over() - 1), "open")]
    if (over() > 0 && open.length) {
      const keep = Math.max(0, open.length - over() - 1)
      heads = cut(heads, open.map((p) => p.id), keep, "pages")
      open = open.slice(0, keep)
    }
    // The pages' details in the lines left, the newest page first; one line is kept for each page after it.
    let room = PROMPT_LINES - used()
    const pages = []
    open.forEach((p, i) => {
      pages.push(heads[i])
      const start = pages.length
      let free = room - (open.length - 1 - i)
      const errors = p.console.filter(isError).slice(-PROMPT_ERRORS)
      if (errors.length && free >= 2) {
        const n = Math.min(errors.length, free - 1)
        pages.push(`  console errors (${p.errors}, the last ${n}):`, ...errors.slice(-n).map((l) => `    ${clip(flat(l.text), LINE_CHARS)}`))
        free -= 1 + n
      } else if (errors.length && free === 1) {
        pages.push(`  console error (the last of ${p.errors}): ${clip(flat(errors.at(-1).text), LINE_CHARS)}`)
        free -= 1
      }
      const text = this.texts.get(p.id)
      const total = text ? text.lines.length + text.more : 0
      let n = text ? Math.min(text.lines.length, free - 1) : 0
      if (n < total) n = Math.min(n, free - 2)
      if (n >= 1) {
        pages.push(`  text (read ${text.at.slice(11, 19)}${text.url && text.url !== p.url ? ` at ${flat(text.url)}` : ""}):`, ...text.lines.slice(0, n).map((l) => `    ${l}`))
        if (total > n) pages.push(`    … ${total - n} more lines: ${this.name}.text${open.length > 1 ? ` {id: "${p.id}"}` : ""}`)
      } else if (free >= 1) {
        pages.push(!text ? `  (its text not read yet: ${this.name}.text${open.length > 1 ? ` {id: "${p.id}"}` : ""})` : total ? `  (its text: ${this.name}.text {id: "${p.id}"})` : `  text (read ${text.at.slice(11, 19)}): no visible text`)
      }
      room -= pages.length - start
    })
    if (heads.length > open.length) pages.push(...heads.slice(open.length))
    return [head, ...pages, ...tailClosed, ...visuals, ...pane, ...asks, ...answers].join("\n")
  }

  // ---- save ----

  // Saved without the pages (the host's) and without a file visual's data: its path only, read again at start.
  snapshot() {
    const { visuals, current, trail, asks, recordings, revision } = structuredClone(this.state)
    const bound = (b) => b && { ...b, running: false, session: null, waiting: null }
    return { visuals: visuals.map((v) => (v.visual?.file ? entry({ ...v, visual: { file: v.visual.file }, bind: bound(v.bind), error: null, read_at: null }) : v)), current, trail, asks, recordings: recordings ?? [], revision }
  }

  // Back from a save (a snapshot, or the whole state the host wrote): visuals (a file one as its path, read again at the
  // next refresh; a spec that no longer checks is dropped), asks, current; the pages stay the host's.
  restore(data) {
    if (!data || typeof data !== "object" || Array.isArray(data) || (!Array.isArray(data.visuals) && !Array.isArray(data.asks))) return
    const seen = new Set()
    const dropped = []
    const visuals = (Array.isArray(data.visuals) ? data.visuals : [])
      .filter((v) => v && VISUAL_ID.test(String(v.id ?? "")) && !seen.has(v.id) && seen.add(v.id))
      .map((v) => {
        const visual = restoredVisual(v.visual)
        if (!visual) {
          dropped.push(String(v.id)) // a saved visual that no longer checks: named on the state (2026-10-23 audit)
          return null
        }
        const params = savedParams(v.params)
        let template = null
        try {
          template = visual.file && typeof v.template === "string" && placeholders(v.template).length && visualFile(v.template, params) ? cleanPath(v.template) : null
        } catch {
          dropped.push(`${v.id} (its template ${v.template})`) // the visual stays, its drill-down template does not: named
        }
        const reads = Array.isArray(v.reads) ? list(v.reads) : null
        const b = v.bind
        const bind = visual.file && b && typeof b.command === "string" && Array.isArray(b.watch) ? { command: b.command, watch: list(b.watch).slice(0, WATCH_MAX), cwd: b.cwd ?? null, lease: b.lease ?? null, timeout: Number(b.timeout) || BIND_TIMEOUT, by: b.by ?? null, writes: list(b.writes), running: false, session: null, ran_at: b.ran_at ?? null, ran: b.ran ?? null, inputs_at: Number(b.inputs_at) || null, exit: b.exit ?? null, ms: b.ms ?? null, error: b.error ?? null, waiting: null, reads: Array.isArray(b.reads) ? list(b.reads) : null } : null
        return entry({ id: String(v.id), title: clip(flat(v.title) || String(v.id), TITLE_MAX), says: clip(String(v.says ?? ""), SAYS_MAX), visual, by: v.by ?? null, at: v.at ?? null, template, params, reads: template ? reads : null, bind, error: visual.file ? "not read yet" : null })
      })
      .filter(Boolean)
      .slice(0, VISUALS_MAX)
    const asks = (Array.isArray(data.asks) ? data.asks : [])
      .filter((a) => a?.id && a.text)
      .slice(-ASKS_MAX)
      .map((a) => ({ id: String(a.id), text: String(a.text), on: itemRef(a.on), context: contextOf(a.context), from: a.from ?? "owner", at: a.at ?? null, answer: a.answer?.text ? { text: String(a.answer.text), on: itemRef(a.answer.on), by: a.answer.by ?? null, at: a.answer.at ?? null } : null }))
    const c = itemRef(data.current)
    const view = c?.kind === "page" && typeof data.current.view === "string" && VIEW.test(data.current.view) ? data.current.view : null
    const current = c && (c.kind === "page" || visuals.some((v) => v.id === c.id)) ? { ...c, ...(view ? { view } : {}) } : null
    const trail = (Array.isArray(data.trail) ? data.trail : [])
      .map(itemRef)
      .filter((t) => t && (t.kind === "page" || visuals.some((v) => v.id === t.id)))
      .slice(-TRAIL_MAX)
    this.fileTexts.clear()
    this.filesPulled = 0
    this.forced.clear()
    // a recording running when the desk stopped ends there (its page went with the host)
    const recordings = (Array.isArray(data.recordings) ? data.recordings : [])
      .filter((x) => x?.id && x.page && Array.isArray(x.frames))
      .slice(-RECORDINGS_MAX)
      .map((x) => ({ id: String(x.id), title: clip(flat(String(x.title ?? x.id)), TITLE_MAX), page: String(x.page), by: x.by ?? null, at: x.at ?? null, ended_at: x.ended_at ?? (x.status === "recording" ? x.at : null), status: "done", note: x.note ?? (x.status === "recording" ? "interrupted: the desk restarted" : null), frames: x.frames.filter((f) => Number.isInteger(f?.n)).slice(-FRAMES_MAX) }))
    this.state = { pages: this.state.pages, visuals, current, trail, asks, recordings, revision: Number.isFinite(data.revision) ? data.revision : 0, ...(dropped.length ? { dropped } : {}) }
  }
}
