// Preview pages (capability `browser`), served by the host API (companion/server/host-api.js): headless pages
// (Bun.WebView: WKWebView on macOS, Chrome elsewhere) on apps running on this computer, for a desk's agents (the inbuilt
// `preview` artifact) and the Live workbench. 2026-10-17: replaces the dev desk's chrome-devtools MCP browser — the
// page lives in the desk's host API (it survives agent steps and runs), every action that changes it leaves a
// screenshot the UI shows, and agents read its text outline instead of pixels.
//
//   POST browser/open { url, width?, height?, by? }   { page }
//   POST browser/navigate { id, url }                 { page }
//   POST browser/click { id, selector | x, y }        { page }
//   POST browser/type { id, text, selector? }         { page }   selector: clicked first (focus)
//   POST browser/press { id, key }                    { page }   Enter, Tab, Escape, ArrowDown, … or one character
//   POST browser/scroll { id, dy, dx? }               { page }
//   POST browser/eval { id, expression }              { value, truncated?, page }   the result as JSON, capped
//   POST browser/text { id }                          { url, title, text }   the visible text outline: headings, text,
//                                                     links, buttons, inputs (capped) — what an agent reads
//   POST browser/shot { id }                          { shot, page }   a fresh screenshot
//   POST browser/console { id }                       { lines: [{ level, text, at }] }   console calls and page errors
//   POST browser/close { id }                         { page }
//   GET  browser/list                                 { pages } newest first (closed ones too, a few)
//   GET  browser/shot?id=&n=                          the PNG (image/png; n given: cached for good; none: the latest)
//   page: { id, url, title, status: open|closed, reason?, by, at, width, height,
//           shot: { n, at, width, height, url: "/__askk/browser/shot?id=<id>&n=<n>" } | null,
//           console: [the last 20 lines], errors: count of error lines }
//
// Only pages on this computer: http(s)://localhost|127.0.0.1|[::1]:<port>, never one of the desk server's own ports
// (its port, DESKS_PORT, a hosted desk's port: a page same-origin with the host API could POST to it). Checked before
// every navigation and after every one (a redirect, a link, the page's own script): a page that leaves is closed.
// Screenshots go to <desk state>/browser/<id>/<n>.png (the last keepShots per page, the newest keepPages pages), served
// by id and number only. At most perDesk open pages per desk and perProcess in this process; close() closes the desk's.
//
//   const browser = createBrowser({ state, blockedPorts, log })   blockedPorts() → the desk server's ports

import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { API_PREFIX, HOST_LIMITS } from "../shared/config.js"
import { httpError } from "../shared/http.js"

const B = HOST_LIMITS.browser
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"])
const PAGE_ID = /^page-[a-z0-9]+-\d+$/
const everyPage = new Set() // every open page in this process, of every desk (perProcess)

// A URL a preview page may show: { ok, url } or { ok: false, reason }.
export function allowedUrl(raw, blockedPorts = []) {
  let u
  try {
    u = new URL(String(raw ?? "").trim())
  } catch {
    return { ok: false, reason: "not a URL" }
  }
  if (u.hostname === "0.0.0.0") u.hostname = "127.0.0.1" // what dev servers print for "every address"
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "only http(s) pages" }
  if (!LOOPBACK.has(u.hostname)) return { ok: false, reason: "only pages on this computer (localhost, 127.0.0.1, [::1])" }
  if (u.username || u.password) return { ok: false, reason: "no credentials in the URL" }
  const port = Number(u.port || (u.protocol === "https:" ? 443 : 80))
  if (blockedPorts.map(Number).includes(port)) return { ok: false, reason: `port ${port} is the desk server's own` }
  return { ok: true, url: u.href }
}

// Page errors (uncaught, unhandled rejections) reach the console capture through console.error; returns the title.
// Installed after every navigation (a new document has none).
const SHIM = `(() => {
  if (!window.__askkShim) {
    window.__askkShim = true
    addEventListener("error", (e) => console.error("[page error] " + (e.message || "error") + (e.filename ? " (" + e.filename + ":" + e.lineno + ")" : "")))
    addEventListener("unhandledrejection", (e) => { const r = e.reason; console.error("[unhandled rejection] " + ((r && (r.stack || r.message)) || String(r))) })
  }
  return document.title
})()`

// The visible page as text, in document order: headings (#), text blocks, [link] text → href, [button], [input …],
// [select], [img] alt, [canvas], [svg]. Runs in the page (evaluate), so it uses page globals only.
function outline(limit) {
  const out = []
  let size = 0
  const push = (raw) => {
    const line = String(raw ?? "").replace(/\s+/g, " ").trim()
    if (!line || out[out.length - 1] === line || size > limit) return
    out.push(line)
    size += line.length + 1
  }
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "IFRAME"])
  const BLOCKS = "h1,h2,h3,h4,h5,h6,a[href],button,[role=button],input,textarea,select,img[alt],canvas,svg,p,li,div,section,article,header,footer,nav,main,aside,table,tr,ul,ol,pre,form,label,dl,dt,dd,figure,blockquote"
  const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ")
  const label = (el) => el.getAttribute("aria-label") || el.title || ""
  const walk = (el) => {
    for (const child of el.children) {
      if (size > limit) return
      const tag = child.tagName.toUpperCase()
      if (SKIP.has(tag)) continue
      const style = getComputedStyle(child)
      if (style.display === "contents") {
        walk(child)
        continue
      }
      if (style.display === "none" || style.visibility === "hidden") continue
      const box = child.getBoundingClientRect()
      if (!box.width && !box.height && child.tagName !== "TR") continue
      const text = () => child.innerText ?? child.textContent ?? ""
      if (tag === "SVG") push(`[svg${child.querySelector("title")?.textContent ? ` ${child.querySelector("title").textContent}` : label(child) ? ` ${label(child)}` : ""}]`)
      else if (/^H[1-6]$/.test(tag)) push(`${"#".repeat(Number(tag[1]))} ${text()}`)
      else if (tag === "A" && child.getAttribute("href")) push(`[link] ${text() || label(child)} → ${child.getAttribute("href")}`)
      else if (tag === "BUTTON" || child.getAttribute("role") === "button") push(`[button] ${text() || label(child)}`)
      else if (tag === "INPUT") {
        const type = (child.type || "text").toLowerCase()
        if (type === "hidden") continue
        const name = child.name || child.id
        const said = child.labels?.[0]?.innerText || child.placeholder || label(child)
        const value = type === "checkbox" || type === "radio" ? (child.checked ? "checked" : "unchecked") : child.value
        push(`[input ${type}${name ? ` ${name}` : ""}]${said ? ` ${said}` : ""}${value ? ` = ${value}` : ""}`)
      } else if (tag === "TEXTAREA") push(`[textarea${child.name ? ` ${child.name}` : ""}] ${child.value}`)
      else if (tag === "SELECT") push(`[select${child.name ? ` ${child.name}` : ""}] ${child.selectedOptions?.[0]?.text ?? ""}`)
      else if (tag === "IMG") {
        if (child.alt) push(`[img] ${child.alt}`)
      } else if (tag === "CANVAS") push(`[canvas ${child.width}x${child.height}]`)
      else if (child.querySelector(BLOCKS)) {
        push(own(child))
        walk(child)
      } else push(text())
    }
  }
  walk(document.body || document.documentElement)
  let text = out.join("\n")
  if (text.length > limit) text = `${text.slice(0, limit)}\n… (cut at ${limit} characters)`
  return { url: location.href, title: document.title, text }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// A WebView operation with a deadline (504 past it; the operation itself may still finish).
function timed(promise, ms, message) {
  let timer
  return Promise.race([promise, new Promise((_, reject) => (timer = setTimeout(() => reject(httpError(504, message)), ms)))]).finally(() => clearTimeout(timer))
}
const sizeOf = (v, fallback) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n > 0 ? Math.min(B.maxSize, Math.max(B.minSize, n)) : fallback
}
const textOf = (v) => {
  if (typeof v === "string") return v
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

// state: the desk's state folder (screenshots); blockedPorts() → the ports no page may show (the desk server's).
export function createBrowser({ state, blockedPorts = () => [], log = () => {} }) {
  const shotsDir = join(state, "browser")
  const pages = new Map() // id -> page
  let count = 0
  let closed = false
  const blocked = () => (typeof blockedPorts === "function" ? blockedPorts() : blockedPorts) ?? []
  const check = (url) => {
    const ok = allowedUrl(url, blocked())
    if (!ok.ok) throw httpError(403, `${url}: ${ok.reason}. A preview shows apps on this computer: http://localhost:<port>/ (not the desk server's port).`)
    return ok.url
  }
  const openPages = () => [...pages.values()].filter((p) => p.status === "open")
  const page = (id) => {
    const p = pages.get(String(id ?? ""))
    if (!p) throw httpError(404, `No preview page "${id}" (browser/list lists them).`)
    return p
  }
  const live = (p) => {
    if (p.status !== "open") throw httpError(p.refused ? 403 : 410, `Page ${p.id} is closed (${p.reason}).`)
  }

  const summary = (p) => ({
    id: p.id,
    url: p.url,
    title: p.title,
    status: p.status,
    ...(p.reason && p.status === "closed" ? { reason: p.reason } : {}),
    by: p.by,
    at: p.at,
    width: p.width,
    height: p.height,
    shot: p.shot ? { ...p.shot, url: `${API_PREFIX}browser/shot?id=${p.id}&n=${p.shot.n}` } : null,
    console: p.console.slice(-B.consoleShown),
    errors: p.errors,
  })

  function note(p, level, text) {
    p.console.push({ level, text: String(text).slice(0, B.consoleLineChars), at: new Date().toISOString() })
    if (p.console.length > B.consoleKeep) p.console.splice(0, p.console.length - B.consoleKeep)
    if (level === "error") p.errors++
  }

  function shut(p, reason) {
    if (p.status !== "open") return
    p.status = "closed"
    p.reason = reason
    everyPage.delete(p)
    try {
      p.view.close()
    } catch {}
    const done = [...pages.values()].filter((x) => x.status !== "open")
    for (const old of done.slice(0, Math.max(0, done.length - B.keepClosed))) pages.delete(old.id)
  }

  // After every navigation (ours, a link, a redirect, the page's own script): a page that left this computer's apps
  // closes; one that stays gets the shim again and a fresh screenshot (when no action of ours is taking one).
  function navigated(p, url) {
    if (p.status !== "open") return
    const ok = allowedUrl(url, blocked())
    if (!ok.ok) {
      p.refused = true
      shut(p, `left the allowed pages: ${url} (${ok.reason})`)
      log(`browser: ${p.id} closed: it went to ${url}`)
      return
    }
    p.url = url
    if (!p.busy) act(p, async () => {}).catch(() => {})
  }

  async function settle(p) {
    await sleep(B.settleMs)
    const until = Date.now() + B.navTimeoutMs
    while (Date.now() < until && p.status === "open" && p.view.loading) await sleep(50)
    const url = p.status === "open" ? p.view.url : ""
    if (url && url !== p.url) navigated(p, url)
  }

  async function shim(p) {
    try {
      p.title = String((await timed(p.view.evaluate(SHIM), B.actionTimeoutMs, "the page did not answer")) ?? "")
    } catch {} // navigating again: the next navigation installs it
  }

  async function capture(p) {
    const blob = await timed(p.view.screenshot(), B.actionTimeoutMs, "the screenshot timed out")
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const png = bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50
    const dims = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const n = ++p.n
    mkdirSync(p.dir, { recursive: true })
    await Bun.write(join(p.dir, `${n}.png`), bytes)
    if (n > B.keepShots) rmSync(join(p.dir, `${n - B.keepShots}.png`), { force: true })
    p.shot = { n, at: new Date().toISOString(), width: png ? dims.getUint32(16) : null, height: png ? dims.getUint32(20) : null }
  }

  // One action at a time per page (a WebView takes one operation of a kind at once); every one that may change the
  // page waits for it to settle, then re-installs the shim and takes a screenshot.
  function act(p, task, { shot = true } = {}) {
    const run = p.queue
      .catch(() => {})
      .then(async () => {
        live(p)
        p.busy = true
        try {
          let value
          try {
            value = await task()
          } catch (error) {
            if (p.status !== "open") live(p)
            // The browser process went (a crash, Bun.WebView.closeAll): the page is gone, not just this action.
            if (/WebView closed|host process died|killed by signal|closed the pipe/i.test(error.message)) shut(p, `the browser went: ${error.message}`)
            throw error.status ? error : httpError(400, `${p.id}: ${error.message}`)
          }
          try {
            await settle(p)
            live(p)
            await shim(p)
            if (shot) await capture(p)
          } catch (error) {
            live(p) // closed meanwhile (it left the allowed pages): that is the answer
            throw error.status ? error : httpError(502, `${p.id}: ${error.message}`)
          }
          return value
        } finally {
          p.busy = false
        }
      })
    p.queue = run
    return run
  }

  // The newest keepPages page folders stay on disk (an open page's always).
  function pruneShots() {
    try {
      const open = new Set(openPages().map((p) => p.id))
      const dirs = readdirSync(shotsDir)
        .filter((d) => PAGE_ID.test(d) && !open.has(d))
        .map((d) => ({ d, at: statSync(join(shotsDir, d)).mtimeMs }))
        .sort((a, b) => b.at - a.at)
      for (const { d } of dirs.slice(Math.max(0, B.keepPages - open.size))) rmSync(join(shotsDir, d), { recursive: true, force: true })
    } catch {}
  }

  async function open({ url, width, height, by } = {}) {
    if (closed) throw httpError(410, "The browser is closed (its desk stopped).")
    const target = check(url)
    if (openPages().length >= B.perDesk) throw httpError(429, `${B.perDesk} preview pages are open on this desk; close one first (browser/close).`)
    if (everyPage.size >= B.perProcess) throw httpError(429, `${B.perProcess} preview pages are open on this server; close one first (browser/close).`)
    const id = `page-${Date.now().toString(36)}-${++count}`
    const p = {
      id,
      url: target,
      title: "",
      status: "open",
      reason: null,
      refused: false,
      by: by ? String(by).slice(0, 60) : null,
      at: new Date().toISOString(),
      width: sizeOf(width, B.width),
      height: sizeOf(height, B.height),
      shot: null,
      n: 0,
      console: [],
      errors: 0,
      queue: Promise.resolve(),
      busy: false,
      dir: join(shotsDir, id),
      view: null,
    }
    try {
      p.view = new Bun.WebView({ width: p.width, height: p.height, console: (type, ...args) => note(p, type === "error" || type === "assert" ? "error" : type, args.map(textOf).join(" ")) })
    } catch (error) {
      throw httpError(501, `No headless browser here: ${error.message}`)
    }
    p.view.onNavigated = (u) => navigated(p, u)
    p.view.onNavigationFailed = (error) => note(p, "error", `navigation failed: ${error.message}`)
    pages.set(id, p)
    everyPage.add(p)
    mkdirSync(p.dir, { recursive: true })
    pruneShots()
    try {
      await act(p, () => timed(p.view.navigate(target), B.navTimeoutMs, `${target} did not load in ${B.navTimeoutMs / 1000} s`))
    } catch (error) {
      shut(p, `did not open: ${error.message}`)
      throw httpError(error.status === 403 ? 403 : 502, `${target}: ${error.message}`)
    }
    log(`browser: ${id} opened ${target}${p.by ? ` for ${p.by}` : ""}`)
    return { page: summary(p) }
  }

  const done = (p) => (value) => ({ ...(value ?? {}), page: summary(p) })

  async function navigate({ id, url } = {}) {
    const p = page(id)
    const target = check(url)
    return act(p, () => timed(p.view.navigate(target), B.navTimeoutMs, `${target} did not load in ${B.navTimeoutMs / 1000} s`)).then(done(p))
  }
  async function click({ id, selector, x, y } = {}) {
    const p = page(id)
    if (typeof selector === "string" && selector.trim()) return act(p, () => p.view.click(selector, { timeout: B.actionTimeoutMs })).then(done(p))
    if (Number.isFinite(Number(x)) && Number.isFinite(Number(y)) && x !== null && y !== null) return act(p, () => p.view.click(Number(x), Number(y))).then(done(p))
    throw httpError(400, 'Expected {"id", "selector"} or {"id", "x", "y"}.')
  }
  async function type({ id, text, selector } = {}) {
    const p = page(id)
    if (typeof text !== "string" || text.length > B.inputChars) throw httpError(400, `text: at most ${B.inputChars} characters.`)
    return act(p, async () => {
      if (typeof selector === "string" && selector.trim()) await p.view.click(selector, { timeout: B.actionTimeoutMs })
      await p.view.type(text)
    }).then(done(p))
  }
  async function press({ id, key } = {}) {
    const p = page(id)
    if (typeof key !== "string" || !key || key.length > 20) throw httpError(400, 'Expected {"id", "key": "Enter"}.')
    return act(p, () => p.view.press(key)).then(done(p))
  }
  async function scroll({ id, dy = 0, dx = 0 } = {}) {
    const p = page(id)
    const [x, y] = [Number(dx) || 0, Number(dy) || 0]
    return act(p, () => p.view.scroll(x, y)).then(done(p))
  }
  async function evaluate({ id, expression } = {}) {
    const p = page(id)
    if (typeof expression !== "string" || !expression.trim() || expression.length > B.inputChars) throw httpError(400, `expression: a JavaScript expression of at most ${B.inputChars} characters.`)
    return act(p, async () => {
      const value = await timed(p.view.evaluate(expression), B.actionTimeoutMs, "the expression did not finish")
      const text = textOf(value)
      return text !== undefined && text.length > B.evalChars ? { value: `${text.slice(0, B.evalChars)}…`, truncated: true } : { value }
    }).then(done(p))
  }
  async function text({ id } = {}) {
    const p = page(id)
    return act(p, () => timed(p.view.evaluate(`(${outline.toString()})(${B.textChars})`), B.actionTimeoutMs, "the page did not answer"), { shot: false })
  }
  async function shot({ id } = {}) {
    const p = page(id)
    return act(p, async () => {}).then(() => ({ shot: summary(p).shot, page: summary(p) }))
  }
  function consoleLines({ id } = {}) {
    return { lines: page(id).console }
  }
  function close({ id } = {}) {
    const p = page(id)
    shut(p, "closed")
    return { page: summary(p) }
  }
  const list = () => ({ pages: [...pages.values()].reverse().map(summary) })

  // GET browser/shot: a page's screenshot by id and number only (the file name is never taken from the request).
  async function image(id, n) {
    if (!PAGE_ID.test(String(id ?? ""))) throw httpError(400, "id: a preview page id (browser/list).")
    const latest = n === null || n === undefined || n === ""
    const num = latest ? pages.get(id)?.shot?.n : Number(n)
    if (!Number.isInteger(num) || num < 1) throw httpError(404, `No screenshot ${latest ? "" : `${n} `}of ${id}.`)
    const file = Bun.file(join(shotsDir, id, `${num}.png`))
    if (!(await file.exists())) throw httpError(404, `No screenshot ${num} of ${id} (only the last ${B.keepShots} are kept).`)
    return new Response(file, { headers: { "content-type": "image/png", "cache-control": latest ? "no-store" : "public, max-age=31536000, immutable" } })
  }

  // The desk stops: its pages close (later opens are refused).
  function closeAll() {
    closed = true
    for (const p of openPages()) shut(p, "the desk stopped")
  }

  return { open, navigate, click, type, press, scroll, evaluate, text, shot, console: consoleLines, close, list, image, closeAll }
}

export const browserRoutes = (browser) => ({
  GET: {
    "browser/list": () => browser.list(),
    "browser/shot": (params) => browser.image(params.get("id"), params.get("n")),
  },
  POST: {
    "browser/open": (body) => browser.open(body),
    "browser/navigate": (body) => browser.navigate(body),
    "browser/click": (body) => browser.click(body),
    "browser/type": (body) => browser.type(body),
    "browser/press": (body) => browser.press(body),
    "browser/scroll": (body) => browser.scroll(body),
    "browser/eval": (body) => browser.evaluate(body),
    "browser/text": (body) => browser.text(body),
    "browser/shot": (body) => browser.shot(body),
    "browser/console": (body) => browser.console(body),
    "browser/close": (body) => browser.close(body),
  },
})
