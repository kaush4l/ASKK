import { Artifact } from "../artifact/artifact.js"
import { Tool } from "../tool/tool.js"
import { narrowText } from "../util/text.js"

// Browse (2026-10-18 owner: "The desk needs a websearch tool. Not just get but also be able to navigate the web."): the
// desk's web browser — text, on the host. web.search finds and web.read gets one page; browse keeps a tab per holder
// and moves through the web: search, open, follow a link by its number, go back, read on, find on the page, submit a
// search form. Over the host's GET web/page (companion/capabilities/web.js: public addresses only, every redirect hop
// re-checked, no script on any page ever runs) and GET web/search. Id `browse`, view and kind `browse`, keep `day`
// (the tabs' addresses and histories; a page's text is in memory only, fetched again when it is needed after a restart).
//
//   browse.open   {url}                 a public http(s) page: its text in parts of PART chars, each link "text [n]",
//                                       each form "[form Fn: …]"; the page you were on goes on your back list
//   browse.search {q, source?, limit?}  a results page (host web/search): each result a link to follow
//   browse.click  {link}                follow a link of the page you are on: its number (7, "[7]") or words of its text
//   browse.back   {}                    the page before (from memory when it is still there)
//   browse.more   {part?}               the next part of the page (or that part)
//   browse.find   {text}                the passages of the whole page around those words (comma-separated), links kept
//   browse.links  {filter?}             the page's links (n, text, address), filtered by words
//   browse.submit {form, fields?}       a GET form of the page (a search box) with your fields: opens the answer. A POST
//                                       form is never sent (it would change something on another site)
//
// Commands are type `dev` (never answered from the data cache: the same browse.more twice is two parts). Prompt: the
// holder's own tab — where it is, the part, the back list. State {tabs: [{agent, url, title, part, parts, links, forms,
// at, history: [{url, title, at}] ≤ HISTORY}], visits: [{agent, how, url, title, at}] ≤ VISITS}.

export const PART = 4000 // chars of a page per part
const HISTORY = 12 // back list per tab, in the twin and kept
const VISITS = 40 // the desk's recent visits, in the twin
const CACHED = 6 // pages kept in memory per tab (back goes there first)
const LINKS_SHOWN = 60
const TITLE = 160
const SOURCES = ["web", "wikipedia", "arxiv", "hn"]

const clip = (s, n) => (String(s ?? "").length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? ""))
const words = (v) => String(v ?? "").toLowerCase().split(/[\s,]+/).filter(Boolean)
const parts = (page) => Math.max(1, Math.ceil(String(page.text ?? "").length / PART))
const hostName = (url) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
const hostOf = (ctx, name) => {
  const host = ctx?.host ?? ctx?.agent?.context?.host
  if (!host?.get) throw new Error(`${name}: no host here (ctx.host) — the desk server reaches the web`)
  return host
}

export class Browse extends Artifact {
  constructor({ id = "browse", title, clock = () => new Date() } = {}) {
    super({ name: id, title: title ?? (id === "browse" ? "browse — the desk's web browser (text)" : `${id} — browser`) })
    this.kind = "browse"
    this.view = "browse"
    this.keep = "day"
    this.clock = clock
    this.state = { tabs: [], visits: [] }
    this.tabs = new Map() // agent -> {page, history: [{url, title, at}], cache: Map(url -> page)}
  }

  // ---- state ----

  #tab(name) {
    if (!this.tabs.has(name)) this.tabs.set(name, { page: null, history: [], cache: new Map() })
    return this.tabs.get(name)
  }

  #publish() {
    const tabs = [...this.tabs.entries()]
      .filter(([, t]) => t.page)
      .map(([agent, t]) => ({ agent, url: t.page.url, title: clip(t.page.title, TITLE), part: t.page.part, parts: t.page.parts, links: t.page.links.length, forms: t.page.forms.length, at: t.page.at, history: t.history.slice(-HISTORY) }))
    const next = { tabs, visits: this.state.visits }
    if (JSON.stringify(next) === JSON.stringify(this.state)) return
    this.state = next
    this.changed()
  }

  #visit(agent, how, page) {
    this.state = { ...this.state, visits: [{ agent, how, url: page.url, title: clip(page.title, TITLE), at: page.at }, ...this.state.visits].slice(0, VISITS) }
  }

  snapshot() {
    return { tabs: this.state.tabs, visits: this.state.visits }
  }

  // The text is not kept: each tab's page comes back as a stub, fetched again when it is read.
  restore(data) {
    if (!data || !Array.isArray(data.tabs)) return
    this.state = { tabs: data.tabs, visits: Array.isArray(data.visits) ? data.visits.slice(0, VISITS) : [] }
    for (const t of data.tabs) {
      if (!t?.agent || !t.url) continue
      const page = { url: t.url, title: t.title ?? "", text: "", part: t.part ?? 1, parts: t.parts ?? 1, at: t.at, stub: true, links: [], forms: [] }
      this.tabs.set(t.agent, { page, history: Array.isArray(t.history) ? t.history.slice(-HISTORY) : [], cache: new Map() })
    }
  }

  // ---- the host ----

  async #fetch(url, ctx) {
    // GET web/page → {url, title, type, text, truncated, links: [{n, text, url}], forms: [{n, method, action, fields}]}
    const r = await hostOf(ctx, this.name).get(`web/page?url=${encodeURIComponent(url)}`, { signal: ctx?.signal })
    return { url: r?.url ?? url, title: r?.title ?? "", text: r?.text ?? "", truncated: !!r?.truncated, links: r?.links ?? [], forms: r?.forms ?? [] }
  }

  async #search(input, ctx) {
    const q = String(input.q ?? input.query ?? "").trim()
    if (!q) throw new Error("q: what to search for")
    const source = String(input.source || "web").trim().toLowerCase()
    if (!SOURCES.includes(source)) throw new Error(`source: one of ${SOURCES.join(", ")}`)
    const limit = Math.max(1, Math.min(20, Number(input.limit) || 10))
    const r = await hostOf(ctx, this.name).get(`web/search?q=${encodeURIComponent(q)}&limit=${limit}&source=${source}`, { signal: ctx?.signal })
    const results = r?.results ?? []
    const links = results.map((x, i) => ({ n: i + 1, text: clip(x.title || x.url, 120), url: x.url }))
    const lines = results.map((x, i) => `${x.title} [${i + 1}] — ${hostName(x.url)}${x.published ? ` · ${x.published}` : ""}\n  ${x.snippet ?? ""}`)
    const text = [r?.note ? `note: ${r.note}` : "", ...lines].filter(Boolean).join("\n") || `no results for ${q}`
    return { url: `search:${source}:${q}`, title: `${q} — search (${r?.engine ?? source})`, text, truncated: false, links, forms: [] }
  }

  #load(url, ctx) {
    if (!url.startsWith("search:")) return this.#fetch(url, ctx)
    const [, source, ...q] = url.split(":")
    return this.#search({ q: q.join(":"), source }, ctx)
  }

  // ---- moving ----

  async #go(ctx, how, load, { push = true } = {}) {
    if (ctx?.signal?.aborted) throw new Error("stopped")
    const name = ctx?.agent?.name ?? "agent"
    const tab = this.#tab(name)
    const loaded = await load()
    const page = { ...loaded, stub: false, part: 1, at: this.clock().toISOString() }
    page.parts = parts(page)
    if (push && tab.page && tab.page.url !== page.url) tab.history = [...tab.history, { url: tab.page.url, title: clip(tab.page.title, TITLE), at: tab.page.at }].slice(-HISTORY)
    tab.page = page
    tab.cache.delete(page.url)
    tab.cache.set(page.url, page)
    while (tab.cache.size > CACHED) tab.cache.delete(tab.cache.keys().next().value)
    this.#visit(name, how, page)
    this.#publish()
    return this.#show(page)
  }

  // The holder's tab with its page whole (a restored stub fetched again, at its part).
  async #current(ctx) {
    const tab = this.#tab(ctx?.agent?.name ?? "agent")
    if (!tab.page) throw new Error(`no page open: ${this.name}.open {url} or ${this.name}.search {q} first`)
    if (tab.page.stub) {
      const { part, at } = tab.page
      const page = { ...(await this.#load(tab.page.url, ctx)), stub: false, at }
      page.parts = parts(page)
      page.part = Math.min(part, page.parts)
      tab.page = page
      tab.cache.set(page.url, page)
    }
    return tab
  }

  #show(page, part = page.part) {
    const n = page.parts
    const at = Math.min(Math.max(1, part), n)
    const text = page.text.slice((at - 1) * PART, at * PART)
    const head = `${page.title || "(no title)"} — ${page.url}${n > 1 ? ` · part ${at}/${n}` : ""}${page.truncated ? " · cut by the host at 40,000 chars" : ""}`
    const foot = [
      page.links.length ? `${page.links.length} links: ${this.name}.click {link: n}` : "no links",
      at < n ? `${this.name}.more for part ${at + 1}/${n}` : "",
      page.forms.length ? `forms ${page.forms.map((f) => `${f.n}${f.method === "post" ? " (POST: never sent)" : ""}`).join(", ")}: ${this.name}.submit {form, fields}` : "",
      `${this.name}.find {text} searches the whole page`,
    ].filter(Boolean)
    return `${head}\n${text || "(no text)"}\n— ${foot.join(" · ")}`
  }

  #link(page, raw) {
    const s = String(raw ?? "").trim()
    if (!s) throw new Error("link: its number (7) or words of its text")
    const num = s.match(/^\[?(\d+)\]?$/)
    if (num) {
      const link = page.links.find((l) => l.n === Number(num[1]))
      if (!link) throw new Error(`no link [${num[1]}] on ${page.url} (it has ${page.links.length}): ${this.name}.links lists them`)
      return link
    }
    const want = words(s)
    const scored = page.links
      .map((l) => ({ l, hit: want.filter((w) => `${l.text} ${l.url}`.toLowerCase().includes(w)).length }))
      .filter((x) => x.hit)
      .sort((a, b) => b.hit - a.hit || a.l.n - b.l.n)
    if (!scored.length) throw new Error(`no link matching "${s}" on ${page.url}: ${this.name}.links {filter} lists them`)
    if (scored.length > 1 && scored[1].hit === scored[0].hit && scored[0].hit < want.length) {
      throw new Error(`"${s}" matches several links — pick one by number: ${scored.slice(0, 6).map(({ l }) => `[${l.n}] ${l.text}`).join(" · ")}`)
    }
    return scored[0].l
  }

  // ---- commands ----

  async open(input = {}, ctx = {}) {
    const url = String(input.url ?? "").trim()
    if (!/^https?:\/\//i.test(url)) throw new Error("url: a public http(s) address")
    return this.#go(ctx, "open", () => this.#fetch(url, ctx))
  }

  async search(input = {}, ctx = {}) {
    return this.#go(ctx, "search", () => this.#search(input, ctx))
  }

  async click(input = {}, ctx = {}) {
    const tab = await this.#current(ctx)
    const link = this.#link(tab.page, input.link ?? input.n ?? input.text)
    return this.#go(ctx, `click [${link.n}]`, () => this.#fetch(link.url, ctx))
  }

  async back(_input = {}, ctx = {}) {
    const tab = this.#tab(ctx?.agent?.name ?? "agent")
    const prev = tab.history.at(-1)
    if (!prev) throw new Error("nothing to go back to")
    tab.history = tab.history.slice(0, -1)
    const kept = tab.cache.get(prev.url)
    return this.#go(ctx, "back", async () => kept ?? this.#load(prev.url, ctx), { push: false })
  }

  async more(input = {}, ctx = {}) {
    const { page } = await this.#current(ctx)
    const want = input.part == null || input.part === "" ? page.part + 1 : Number(input.part)
    if (!Number.isInteger(want) || want < 1) throw new Error(`part: 1 to ${page.parts}`)
    if (want > page.parts) return `${page.url} has ${page.parts} part${page.parts === 1 ? "" : "s"}: that was all of it`
    page.part = want
    this.#publish()
    return this.#show(page, want)
  }

  async find(input = {}, ctx = {}) {
    const { page } = await this.#current(ctx)
    const terms = String(input.text ?? input.find ?? "").split(",").map((t) => t.trim()).filter(Boolean)
    if (!terms.length) throw new Error("text: the words to find (comma-separated)")
    const { text } = narrowText(page.text, { find: terms })
    return `${page.title || "(no title)"} — ${page.url}\n${text || `none of ${terms.join(", ")} on this page`}`
  }

  async links(input = {}, ctx = {}) {
    const { page } = await this.#current(ctx)
    const want = words(input.filter)
    const all = page.links.filter((l) => want.every((w) => `${l.text} ${l.url}`.toLowerCase().includes(w)))
    const shown = all.slice(0, LINKS_SHOWN)
    if (!shown.length) return `no links${want.length ? ` matching ${want.join(" ")}` : ""} on ${page.url}`
    return [...shown.map((l) => `[${l.n}] ${l.text} — ${l.url}`), all.length > shown.length ? `… ${all.length - shown.length} more: narrow it with filter` : ""].filter(Boolean).join("\n")
  }

  async submit(input = {}, ctx = {}) {
    const { page } = await this.#current(ctx)
    const id = String(input.form ?? "F1").trim().toUpperCase().replace(/^(\d+)$/, "F$1")
    const form = page.forms.find((f) => f.n === id)
    if (!form) throw new Error(`no form ${id} on ${page.url}${page.forms.length ? ` (it has ${page.forms.map((f) => f.n).join(", ")})` : ""}`)
    if (form.method !== "get") throw new Error(`${id} is a POST form: never sent (it would change something on another site) — the owner does that`)
    let fields = input.fields ?? {}
    if (typeof fields === "string") {
      try {
        fields = JSON.parse(fields)
      } catch {
        throw new Error('fields: an object {name: value}, e.g. {"q": "rope scaling"}')
      }
    }
    const known = new Set(form.fields.map((f) => f.name))
    const unknown = Object.keys(fields).filter((k) => !known.has(k))
    if (unknown.length) throw new Error(`${id} has no field ${unknown.join(", ")} — its fields: ${form.fields.map((f) => f.name).join(", ")}`)
    const url = new URL(form.action)
    const query = new URLSearchParams()
    for (const f of form.fields) query.append(f.name, String(fields[f.name] ?? f.value ?? ""))
    url.search = query.toString()
    return this.#go(ctx, `submit ${id}`, () => this.#fetch(url.href, ctx))
  }

  commands() {
    const tool = (name, description, input, run) => new Tool({ name: `${this.name}.${name}`, type: "dev", view: "browse", description, input, run })
    return [
      tool("open", "open a public web page in your tab: its text in parts, each link marked [n], each form [form Fn: …]", { url: "https://…" }, (i, c) => this.open(i, c)),
      tool("search", "search the web into your tab: a results page whose results you follow with click", { q: "the search terms", source: "web (default) | wikipedia | arxiv | hn", limit: "results (default 10)" }, (i, c) => this.search(i, c)),
      tool("click", "follow a link of the page you are on", { link: "its number (7) or words of its text" }, (i, c) => this.click(i, c)),
      tool("back", "go back to the page before", {}, (i, c) => this.back(i, c)),
      tool("more", `read on: the next ${PART}-char part of the page`, { part: "a part number (default: the next)" }, (i, c) => this.more(i, c)),
      tool("find", "the passages of the whole page around words (links kept)", { text: "words, comma-separated" }, (i, c) => this.find(i, c)),
      tool("links", "the page's links: number, text, address", { filter: "words the link's text or address has (optional)" }, (i, c) => this.links(i, c)),
      tool("submit", "submit a GET form of the page (a search box) with your fields; a POST form is never sent", { form: "F1", fields: "{name: value}" }, (i, c) => this.submit(i, c)),
    ]
  }

  brief() {
    const tabs = this.state.tabs
    if (!tabs.length) return "no pages open"
    const first = [...tabs].sort((a, b) => String(b.at).localeCompare(String(a.at)))[0]
    return `${first.agent} on ${first.url.startsWith("search:") ? "a search" : hostName(first.url)}${tabs.length > 1 ? ` · ${tabs.length} tabs` : ""}`
  }

  render(agent) {
    const can = ["open", "search", "click", "back", "more", "find", "links", "submit"].filter((c) => !agent || agent.tools?.has(`${this.name}.${c}`)).map((c) => `${this.name}.${c}`)
    const head = `your web browser (text; public pages only, no script runs, POST forms never sent)${can.length ? `: ${can.join(", ")}` : ""}`
    const tab = agent ? this.tabs.get(agent.name) : null
    if (!tab?.page) return `${head}\n(no page open)`
    const p = tab.page
    const detail = p.stub ? "" : ` · ${p.links.length} links${p.forms.length ? ` · forms ${p.forms.map((f) => f.n).join(", ")}` : ""}`
    const out = [head, `ON: ${p.title || "(no title)"} — ${p.url} · part ${p.part}/${p.parts}${detail}`]
    if (tab.history.length) out.push(`BACK: ${tab.history.slice(-5).reverse().map((h) => clip(h.title || h.url, 60)).join(" ← ")}`)
    return out.join("\n")
  }
}
