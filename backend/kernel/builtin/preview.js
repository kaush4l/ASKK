import { Artifact } from "../artifact/artifact.js"
import { Tool } from "../tool/tool.js"
import { hostError } from "./files.js"

// Preview: the running app's pages as an artifact (2026-10-17 owner: the preview of what the agents build, its
// screenshot attached to the artifact, a curated browser tool set like chrome-devtools MCP). The pages live in the
// host (browser/*: companion/capabilities/browser.js — headless, on this computer's apps only); every action that
// changes a page leaves a screenshot the Live preview shows. The agent reads text, never pixels: each action answers
// with the page's text outline, and the prompt keeps the last one read. One instance per desk (id "preview"), listing
// every page of the desk; {type: preview, id} makes another that lists only the pages it opened.
//
//   preview.open {url}   preview.goto {url}   preview.click {selector | x, y}   preview.type {text, selector?}
//   preview.press {key}   preview.scroll {dy}   → the page's line and its text outline (the first 40 lines)
//   preview.text   the whole text outline   preview.eval {expression}   its value   preview.console   console lines
//   preview.shot   a fresh screenshot (for the owner's eyes)   preview.close
// (the page: the newest open one unless `id`)
//
// Commands are type dev (never answered from the run's data cache). refresh(agent) pulls browser/list (coalesced, at
// most every REFRESH_MS); changed() only when the twin state differs.
// Twin state: {pages: [{id, url, title, status: open | closed, by, at, shot: {n, at, width, height, url} | null,
//   console: [{level, text, at}] (last 20), errors}]} — the image itself is the host's (GET browser/shot?id&n).
// Prompt (text only): each open page's url, title, console errors and its last text outline (≤ 40 lines).

const PAGES_MAX = 12
const CONSOLE = 20 // console lines per page in the twin
const TEXT_LINES = 40 // a text outline's lines in the prompt and in an action's answer
const PROMPT_ERRORS = 5
const LINE_CHARS = 300
const RESULT_CHARS = 12000
const REFRESH_MS = 1000

const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s))
const ctxOf = (agent) => ({ ...(agent?.context ?? {}), agent })
const hostOf = (ctx) => {
  if (!ctx?.host?.get) throw new Error("no host here (ctx.host): the desk server opens the pages")
  return ctx.host
}
const isError = (l) => l?.level === "error" || l?.level === "pageerror"

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

const headOf = (p) => `${p.status === "closed" ? "■" : "▶"} ${p.id} ${p.url}${p.title ? ` — "${clip(p.title, 120)}"` : ""}${p.by ? ` (opened by ${p.by})` : ""}${p.status === "closed" ? " closed" : ""}${p.shot ? ` · shot ${p.shot.n}` : ""}${p.errors ? ` · ${p.errors} console error${p.errors === 1 ? "" : "s"}` : ""}`
const outline = (text, n = TEXT_LINES) => {
  const lines = String(text ?? "").split("\n").filter((l) => l.trim())
  return { lines: lines.slice(0, n).map((l) => clip(l, LINE_CHARS)), more: Math.max(0, lines.length - n) }
}
const result = (text) => (text.length > RESULT_CHARS ? `${text.slice(0, RESULT_CHARS)}\n… cut at ${RESULT_CHARS} chars` : text)

export class Preview extends Artifact {
  // separate: another instance of the desk's preview — it lists only the pages it opened.
  constructor({ id = "preview", title, separate = false, clock = () => new Date() } = {}) {
    super({ name: id, title: title ?? (id === "preview" ? "preview — the app's pages" : `${id} — preview`) })
    this.kind = "preview"
    this.view = "preview"
    this.keep = "file" // pages close with the server: never restored
    this.clock = clock
    this.state = { pages: [] }
    this.texts = new Map() // page id -> the last text outline read: {at, url, title, lines, more}
    this.mine = separate ? new Set() : null
    this.pulled = 0
    this.pulling = null
  }

  // ---- state ----

  #set(pages) {
    const next = { pages: pages.slice(0, PAGES_MAX) }
    if (JSON.stringify(next) === JSON.stringify(this.state)) return false
    this.state = next
    this.changed()
    return true
  }

  #take(pages) {
    const shown = (pages ?? []).filter((p) => p?.id && (!this.mine || this.mine.has(p.id)))
    for (const id of this.texts.keys()) if (!shown.some((p) => p.id === id)) this.texts.delete(id)
    this.#set(shown.map(twinOf))
  }

  #merge(p) {
    if (!p?.id || (this.mine && !this.mine.has(p.id))) return
    const at = (x) => Date.parse(x.at ?? "") || 0
    this.#set([twinOf(p), ...this.state.pages.filter((x) => x.id !== p.id)].sort((a, b) => at(b) - at(a)))
  }

  async refresh(agent) {
    if (this.pulling) return this.pulling
    if (Date.now() - this.pulled < REFRESH_MS) return
    this.pulling = this.#pull(ctxOf(agent)).finally(() => (this.pulling = null))
    return this.pulling
  }

  async #pull(ctx) {
    let r
    try {
      r = await hostOf(ctx).get("browser/list", { signal: ctx.signal })
    } catch (e) {
      throw new Error(`browser/list: ${hostError(e)}`)
    }
    this.pulled = Date.now()
    this.#take(r?.pages)
  }

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

  // An action that changes the page: the host acts (and shoots); the answer is the page's line and its outline.
  async #act(path, body, input, ctx, { opens = false } = {}) {
    const id = opens ? null : await this.#page(input, ctx)
    const r = await this.#call(path, opens ? body : { id, ...body }, ctx)
    const page = r?.page
    if (opens && page?.id) this.mine?.add(page.id)
    this.#merge(page)
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

  // ---- commands ----

  #open(input = {}, ctx = {}) {
    const url = String(input.url ?? "").trim()
    if (!url) throw new Error("url: the app's page on this computer, e.g. http://localhost:8001 (a URL its terminal session printed)")
    return this.#act("browser/open", { url, by: ctx.agent?.name ?? null }, input, ctx, { opens: true })
  }

  #goto(input = {}, ctx = {}) {
    const url = String(input.url ?? "").trim()
    if (!url) throw new Error("url: where to go")
    return this.#act("browser/navigate", { url }, input, ctx)
  }

  #click(input = {}, ctx = {}) {
    const selector = String(input.selector ?? "").trim()
    const xy = input.x != null && input.y != null && input.x !== "" && input.y !== ""
    if (!selector && !xy) throw new Error("selector (a CSS selector, e.g. button#save) or x and y (pixels)")
    return this.#act("browser/click", selector ? { selector } : { x: Number(input.x), y: Number(input.y) }, input, ctx)
  }

  #type(input = {}, ctx = {}) {
    if (input.text == null) throw new Error("text: what to type")
    return this.#act("browser/type", { text: String(input.text), ...(input.selector ? { selector: String(input.selector) } : {}) }, input, ctx)
  }

  #press(input = {}, ctx = {}) {
    const key = String(input.key ?? "").trim()
    if (!key) throw new Error("key: Enter, Tab, Escape, ArrowDown … or one character")
    return this.#act("browser/press", { key }, input, ctx)
  }

  #scroll(input = {}, ctx = {}) {
    const dy = Number(input.dy)
    if (!Number.isFinite(dy)) throw new Error("dy: pixels to scroll down (negative: up)")
    return this.#act("browser/scroll", { dy }, input, ctx)
  }

  async #text(input = {}, ctx = {}) {
    const id = await this.#page(input, ctx)
    const text = await this.#read(id, ctx)
    return result(`${text.title ? `"${text.title}" ` : ""}${text.url}\n${text.whole || "(no visible text)"}`)
  }

  async #eval(input = {}, ctx = {}) {
    const expression = String(input.expression ?? "").trim()
    if (!expression) throw new Error("expression: JavaScript evaluated in the page, e.g. document.title")
    const id = await this.#page(input, ctx)
    const r = await this.#call("browser/eval", { id, expression }, ctx)
    this.#merge(r?.page)
    const value = typeof r?.value === "string" ? r.value : JSON.stringify(r?.value ?? null)
    return result(`${value ?? "undefined"}${r?.truncated ? "\n… cut by the host" : ""}`)
  }

  async #console(input = {}, ctx = {}) {
    const id = await this.#page(input, ctx)
    const r = await this.#call("browser/console", { id }, ctx)
    const lines = (r?.lines ?? []).slice(-50).map((l) => `[${l.level}] ${clip(l.text, LINE_CHARS)}`)
    return lines.length ? result(lines.join("\n")) : "no console lines"
  }

  async #shot(input = {}, ctx = {}) {
    const id = await this.#page(input, ctx)
    const r = await this.#call("browser/shot", { id }, ctx)
    this.#merge(r?.page)
    const s = r?.shot
    return s ? `shot ${s.n} of ${id}${s.width ? ` (${s.width}×${s.height})` : ""} — the owner sees it on the Live preview; you read the page with ${this.name}.text` : `${id}: no screenshot`
  }

  async #close(input = {}, ctx = {}) {
    const id = await this.#page(input, ctx)
    const r = await this.#call("browser/close", { id }, ctx)
    this.#merge(r?.page)
    this.texts.delete(id)
    return `closed ${id}`
  }

  commands() {
    const tool = (name, description, input, run) => new Tool({ name: `${this.name}.${name}`, type: "dev", view: "preview", description, input, run })
    const id = "the page (default: the newest open one)"
    return [
      tool("open", "open a page of an app running on this computer (http://localhost:<port>, never the desk server's): its text outline", { url: "e.g. http://localhost:8001" }, (i, c) => this.#open(i, c)),
      tool("goto", "go to another URL on the page", { url: "the URL", id }, (i, c) => this.#goto(i, c)),
      tool("click", "click an element (a CSS selector) or a point", { selector: "e.g. button#save", x: "pixels from the left (instead of selector)", y: "pixels from the top", id }, (i, c) => this.#click(i, c)),
      tool("type", "type text (into the selector's element, clicked first)", { text: "what to type", selector: "the input (optional)", id }, (i, c) => this.#type(i, c)),
      tool("press", "press a key", { key: "Enter, Tab, Escape, ArrowDown … or one character", id }, (i, c) => this.#press(i, c)),
      tool("scroll", "scroll the page", { dy: "pixels down (negative: up)", id }, (i, c) => this.#scroll(i, c)),
      tool("text", "the page's whole text outline: headings, text, links, buttons, inputs", { id }, (i, c) => this.#text(i, c)),
      tool("eval", "evaluate a JavaScript expression in the page: its value", { expression: "e.g. document.querySelectorAll('tr').length", id }, (i, c) => this.#eval(i, c)),
      tool("console", "the page's console lines and errors", { id }, (i, c) => this.#console(i, c)),
      tool("shot", "take a screenshot for the owner (you read the page with text)", { id }, (i, c) => this.#shot(i, c)),
      tool("close", "close the page", { id }, (i, c) => this.#close(i, c)),
    ]
  }

  // ---- views ----

  brief() {
    const open = this.state.pages.filter((p) => p.status === "open")
    return open.length ? `${open.length} open · ${open[0].url}` : "no page open"
  }

  render(agent) {
    const own = (c) => !agent || agent.tools?.has(`${this.name}.${c}`)
    const can = ["open", "goto", "click", "type", "press", "scroll", "text", "eval", "console", "shot", "close"].filter(own).map((c) => `${this.name}.${c}`)
    const head = `the app's pages (apps on this computer; you see their text, the owner their screenshots)${can.length ? `: ${can.join(", ")}` : ""}`
    const pages = this.state.pages
    const open = pages.filter((p) => p.status === "open")
    if (!open.length) return [head, `(no page open${pages.length ? `; ${pages.length} closed` : ""})`].join("\n")
    const out = [head]
    for (const p of open) {
      out.push(headOf(p))
      const errors = p.console.filter(isError).slice(-PROMPT_ERRORS)
      if (errors.length) out.push(`  console errors (${p.errors}, the last ${errors.length}):`, ...errors.map((l) => `    ${clip(l.text, LINE_CHARS)}`))
      const text = this.texts.get(p.id)
      if (text) out.push(`  text (read ${text.at.slice(11, 19)}${text.url && text.url !== p.url ? ` at ${text.url}` : ""}):`, ...text.lines.map((l) => `    ${l}`), ...(text.more ? [`    … ${text.more} more lines: ${this.name}.text`] : []))
      else out.push(`  (its text not read yet: ${this.name}.text)`)
    }
    const closed = pages.length - open.length
    if (closed) out.push(`(${closed} closed)`)
    return out.join("\n")
  }
}
