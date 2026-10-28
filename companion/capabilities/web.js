// Web search and page reading for agents (capability `web`), on the host
// because a browser cannot fetch other sites (CORS).
//
//   GET web/search?q=…&limit=…&source=…
//        { engine, query, results: [{ title, url, snippet, source, published? }], note? }
//   GET web/read?url=…           { url, title, text, truncated }
//   GET web/page?url=…           { url, title, text, truncated, links: [{n, text, url}], forms: [{n, method, action,
//                                  fields: [{name, type, value}]}] } — the page to navigate (2026-10-18 owner: "not
//                                  just get but also be able to navigate the web"): its text with each link marked
//                                  "[n]" and each form "[form Fn: …]", so the kernel's browse artifact can follow one
//
// Search sources (`source`, default web):
//   web        SearXNG (free, open-source metasearch, AGPL) when ASKK_SEARXNG_URL
//              names an instance with the JSON format on (`search.formats: [html, json]`
//              in its settings.yml; `docker run -p 8888:8080 searxng/searxng`); without
//              it, DuckDuckGo's keyless HTML page. When that engine fails (rate limit,
//              cooling, network) or finds nothing, the FALLBACK answers: wikipedia +
//              arxiv + hn merged round-robin, engine "fallback", `note` says why.
//   wikipedia  the MediaWiki search API (en.wikipedia.org)
//   arxiv      the arXiv API (export.arxiv.org, Atom)
//   hn         Hacker News stories through the Algolia HN API
// Only official, keyless APIs whose terms allow programmatic use; no engine is
// scraped besides DuckDuckGo's HTML endpoint, and that one gently.
//
// Parallel agents share one process: every engine has one queue per process
// (HOST_LIMITS.web.engines: requests at once, ms between starts). DuckDuckGo runs
// one request at a time, 1.5 s apart; a rate-limited answer (429, anomaly or
// captcha page) is retried after 3 s, then 8 s, and an engine still limited after
// its retries is skipped ("cooling") for 2 min; one that does not answer (timeout,
// network, 5xx), for 30 s. arXiv requests start 3 s apart (its API terms). The
// same query + limit + source answers from memory for 10 min (a fallback answer is
// not kept: its sources are, so the engine gets its chance again once it has cooled).
//
// Read: public http(s) pages only. The host refuses loopback, private and
// link-local addresses however they are spelled (an agent's URL must never reach
// the owner's network), connects an http: page to the address it checked (no
// second DNS answer), follows at most 5 redirects, each re-checked the same way,
// and returns plain text.

import { isIP } from "node:net"
import { HttpError } from "../shared/http.js"
import { HOST_LIMITS } from "../shared/config.js"
import { attempt } from "../shared/safe.js"

const UA = "Mozilla/5.0 (compatible; ASKK/1.0; +https://github.com/kaush4l/ASKK)"
// Wikimedia's User-Agent policy: a descriptive agent naming the project (no contact address here).
const API_UA = "ASKK-web-search/1.0 (ASKK agent desk host; programmatic search through public APIs)"
const LIMITS = HOST_LIMITS.web
const MAX_BYTES = LIMITS.readBytes
const MAX_TEXT = LIMITS.readChars
const TIMEOUT = LIMITS.timeoutMs

const SOURCES = ["web", "wikipedia", "arxiv", "hn"]
const FALLBACK = ["wikipedia", "arxiv", "hn"]

// An error that says why an engine did not answer: "rate-limited" (after its retries) or "cooling".
const engineError = (status, message, reason) => Object.assign(new HttpError(status, message), { reason })
// A 502 for an engine that answered badly; `down`: it is skipped a while.
const badAnswer = (message, down) => Object.assign(new HttpError(502, message), { down })
// Its first part, for a note: "duckduckgo rate-limited (3 tries; skipped for 120 s)".
const brief = (error) => error.message.replace(/: .*$|\.$/, "")

// ── addresses ───────────────────────────────────────────────────────────
// Decided on the address's bytes, never on how it is spelled (2026-10-17: string prefixes let ::ffff:7f00:1,
// 64:ff9b::7f00:1, ::7f00:1 and 2002:7f00:1:: through — each one 127.0.0.1 in another form).

function v4Bytes(ip) {
  const parts = String(ip).split(".")
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return null
  const bytes = parts.map(Number)
  return bytes.every((b) => b <= 255) ? bytes : null
}

// An IPv6 address → its 16 bytes (a dotted IPv4 tail and a %zone allowed), or null.
function v6Bytes(ip) {
  let s = String(ip).replace(/^\[|\]$/g, "").replace(/%.*$/, "").toLowerCase()
  const dotted = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const v4 = v4Bytes(dotted[2])
    if (!v4) return null
    s = `${dotted[1]}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`
  }
  const halves = s.split("::")
  if (halves.length > 2) return null
  const groups = (part) => (part ? part.split(":") : [])
  const head = groups(halves[0])
  const tail = halves.length === 2 ? groups(halves[1]) : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail]
  if (!all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null
  return all.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 0xff])
}

// "This host", private, shared (CGN), loopback, link-local (cloud metadata 169.254.169.254), IETF protocol
// assignments, benchmarking, multicast and reserved.
function privateV4([a, b, c]) {
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) || a >= 224
}

function privateV6(b) {
  const zero = (from, to) => b.slice(from, to).every((x) => x === 0)
  const v4 = (at) => privateV4(b.slice(at, at + 4))
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return v4(12) // ::ffff:a.b.c.d IPv4-mapped
  if (zero(0, 12)) return v4(12) // ::a.b.c.d IPv4-compatible; :: and ::1 are 0.0.0.0 and 0.0.0.1
  if (zero(0, 8) && b[8] === 0xff && b[9] === 0xff && zero(10, 12)) return v4(12) // ::ffff:0:a.b.c.d IPv4-translated
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return zero(4, 12) ? v4(12) : true // NAT64 64:ff9b::/96; 64:ff9b:1::/48 local-use
  if (b[0] === 0x20 && b[1] === 0x02) return v4(2) // 6to4 2002:a.b.c.d::/48
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return true // Teredo: a tunnel to an IPv4 address of its own
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true // documentation
  if (b[0] === 0x01 && zero(1, 8)) return true // discard-only 100::/64
  if ((b[0] & 0xfe) === 0xfc) return true // unique local fc00::/7
  if (b[0] === 0xfe && (b[1] & 0x80) === 0x80) return true // link-local fe80::/10, site-local fec0::/10
  return b[0] === 0xff // multicast
}

// True for every address an agent's URL must not reach, however it is spelled; an address that cannot be
// parsed counts as private.
export function privateAddress(ip) {
  const v4 = v4Bytes(ip)
  if (v4) return privateV4(v4)
  const v6 = v6Bytes(ip)
  return v6 ? privateV6(v6) : true
}

// The URL and the checked address its host resolved to (the one to connect to).
async function publicUrl(net, raw) {
  const url = attempt(() => new URL(raw))
  if (!url) throw new HttpError(400, `Not a URL: ${raw}`)
  if (!["http:", "https:"].includes(url.protocol)) throw new HttpError(400, "Only http(s) URLs can be read.")
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new HttpError(403, "Local addresses cannot be read.")
  const addresses = isIP(host) ? [{ address: host }] : await Promise.resolve(net.lookup(host)).catch(() => [])
  if (!addresses.length) throw new HttpError(502, `Cannot resolve ${host}.`)
  if (addresses.some(({ address }) => privateAddress(address))) throw new HttpError(403, "Private network addresses cannot be read.")
  // Every answer was checked; connect to an IPv4 one when there is one (a network without IPv6 still connects).
  const pick = addresses.find(({ address }) => isIP(address) === 4) ?? addresses[0]
  return { url, address: isIP(host) ? null : pick.address }
}

// Fetch a public URL, re-checking every redirect hop. http: connects to the address that was checked, the Host
// header naming the site, so a DNS answer that changes between the check and the connect (rebinding) cannot reach
// a local address (2026-10-17). https: by name (TLS needs it): a rebinding to a local address cannot present a
// valid certificate for the attacker's name, so the certificate check refuses the connection.
async function fetchPublic(net, raw, { timeoutMs = TIMEOUT, ...init } = {}) {
  let { url, address } = await publicUrl(net, raw)
  for (let hop = 0; hop <= 5; hop++) {
    const via = url.protocol === "http:" ? address : null
    const response = await net.fetch(url, { ...init, redirect: "manual", headers: { "user-agent": UA, "accept-language": "en", ...init.headers } }, timeoutMs, via).catch((error) => {
      throw badAnswer(`${url.host} is not reachable (${error.name === "TimeoutError" ? "timeout" : error.message}).`, true)
    })
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      ;({ url, address } = await publicUrl(net, new URL(response.headers.get("location"), url).href))
      continue
    }
    return { url, response }
  }
  throw new HttpError(502, "Too many redirects.")
}

// The URL with its host replaced by an address (IPv6 in brackets); path, query and port kept.
function pinned(url, address) {
  const target = new URL(url)
  target.hostname = isIP(address) === 6 ? `[${address}]` : address
  return target
}

async function readBody(response) {
  const reader = response.body?.getReader()
  if (!reader) return ""
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    chunks.push(value)
    if (size >= MAX_BYTES) {
      reader.cancel().catch(() => {})
      break
    }
  }
  return new TextDecoder().decode(Bun.concatArrayBuffers(chunks))
}

// ── HTML → text ─────────────────────────────────────────────────────────

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
  })
const strip = (html) => decode(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim()
const clip = (text, max = LIMITS.snippetChars) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

const titleOf = (html) => strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
// Markup removed, entities decoded, each line cleaned by `tidyLine`, blank runs squeezed.
const plain = (markup, tidyLine) =>
  decode(markup.replace(/<[^>]+>/g, ""))
    .split("\n")
    .map(tidyLine)
    .filter((line, i, all) => line || all[i - 1])
    .join("\n")
    .trim()

export function htmlToText(html) {
  const title = titleOf(html)
  const body = (html.match(/<(main|article)\b[\s\S]*?<\/\1>/i)?.[0] ?? html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html)
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|li|tr|h[1-6]|pre|blockquote)>|<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<h([1-6])[^>]*>/gi, (_, n) => `\n${"#".repeat(Number(n))} `)
  return { title, text: plain(body, (line) => line.replace(/[ \t\f\v]+/g, " ").trim()) }
}

// ── HTML → a page to navigate ───────────────────────────────────────────
// Unlike htmlToText it keeps the page's navigation (nav, header, footer): following links is the point. Every link to
// an http(s) address is "text [n]" in the text, the same address the same n (at most LINKS_MAX); javascript:, mailto:,
// tel: and same-page "#" links are dropped. Forms are "[form Fn: name (type), …]"; only GET forms can be submitted
// (the kernel refuses POST: it would change something on another site). No script on the page ever runs.

const LINKS_MAX = 400
const FORMS_MAX = 20
const FIELDS_MAX = 30
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>"']+))`, "i"))
  return m ? decode(m[1] ?? m[2] ?? m[3] ?? "") : null
}
const absolute = (href, base) => {
  if (href == null) return null
  const raw = href.trim()
  if (!raw || raw.startsWith("#")) return null
  return attempt(() => {
    const url = new URL(raw, base)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    url.hash = ""
    return url.href
  })
}

export function htmlToPage(html, pageUrl) {
  const title = titleOf(html)
  const base = absolute(attr(html.match(/<base\b[^>]*>/i)?.[0] ?? "", "href"), pageUrl) ?? pageUrl
  const links = []
  const numbers = new Map() // url -> n
  const forms = []
  let body = (html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html)
    .replace(/<(script|style|noscript|svg|iframe|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
  body = body.replace(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi, (_, open, inner) => {
    if (forms.length >= FORMS_MAX) return inner
    const method = (attr(` ${open}`, "method") ?? "get").toLowerCase() === "post" ? "post" : "get"
    const action = absolute(attr(` ${open}`, "action") ?? "", base) ?? absolute(pageUrl, pageUrl)
    const fields = []
    for (const m of inner.matchAll(/<(input|textarea)\b([^>]*)>|<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
      const tag = ` ${m[2] ?? m[3]}`
      const name = attr(tag, "name")
      const type = m[1] == null ? "select" : m[1].toLowerCase() === "input" ? (attr(tag, "type") ?? "text").toLowerCase() : "textarea"
      if (!name || ["submit", "button", "image", "reset", "file", "password"].includes(type)) continue
      if ((type === "checkbox" || type === "radio") && !/\schecked\b/i.test(tag)) continue
      let value = attr(tag, "value") ?? ""
      if (type === "select") {
        const options = [...(m[4] ?? "").matchAll(/<option\b([^>]*)>([^<]*)/gi)]
        const chosen = options.find((o) => /\sselected\b/i.test(` ${o[1]}`)) ?? options[0]
        value = chosen ? (attr(` ${chosen[1]}`, "value") ?? strip(chosen[2])) : ""
      }
      if (fields.length < FIELDS_MAX) fields.push({ name, type, value })
    }
    const n = `F${forms.length + 1}`
    forms.push({ n, method, action, fields })
    const shown = fields.filter((f) => f.type !== "hidden").map((f) => `${f.name} (${f.type})`)
    return `\n[form ${n}${method === "post" ? " POST" : ""}: ${shown.join(", ") || "no fields"}]\n${inner.replace(/<select\b[\s\S]*?<\/select>/gi, " ").replace(/<textarea\b[\s\S]*?<\/textarea>/gi, " ")}\n`
  })
  body = body.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, open, inner) => {
    const url = absolute(attr(` ${open}`, "href"), base)
    const text = strip(inner) || attr(` ${open}`, "title") || attr(inner, "alt") || ""
    if (!url) return inner
    let n = numbers.get(url)
    if (n == null) {
      if (links.length >= LINKS_MAX) return inner
      n = links.length + 1
      numbers.set(url, n)
      links.push({ n, text: clip(text || url, 120), url })
    }
    return ` ${inner} [${n}] `
  })
  body = body
    .replace(/<\/(p|div|section|article|main|nav|header|footer|aside|li|tr|h[1-6]|pre|blockquote|table|ul|ol|dl|dd|dt)>|<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<h([1-6])[^>]*>/gi, (_, n) => `\n${"#".repeat(Number(n))} `)
    .replace(/<(td|th)[^>]*>/gi, " | ")
  const text = plain(body, (line) => line.replace(/[ \t\f\v]+/g, " ").replace(/ +\[/g, " [").replace(/\] +([.,;:!?)])/g, "]$1").trim())
  return { title, text, links, forms }
}

// ── search engines and APIs ─────────────────────────────────────────────
// Each takes (net, query, limit) and returns [{ title, url, snippet, source }]. A rate-limited answer throws
// with `rateLimited: true` (the queue retries it, then cools the engine); one the host did not answer (no answer,
// timeout, 5xx) with `down: true` (the engine is skipped a while, so a queue does not wait out timeout after timeout).
const rateLimited = (message) => Object.assign(new HttpError(429, message), { rateLimited: true })

async function searxng(net, base, query, limit) {
  const url = new URL("search", base.endsWith("/") ? base : `${base}/`)
  url.search = new URLSearchParams({ q: query, format: "json" }).toString()
  // The owner's own instance may run on this machine: no public-address check.
  const response = await net.fetch(url, { headers: { "user-agent": UA } }, TIMEOUT).catch(() => null)
  if (response?.status === 429) throw rateLimited(`SearXNG at ${url.origin} is rate-limiting (429).`)
  if (!response?.ok) throw badAnswer(`SearXNG at ${url.origin} did not answer (is format json enabled?).`, !response || response.status >= 500)
  const data = await response.json()
  return (data.results ?? []).slice(0, limit).map((r) => ({ title: r.title ?? "", url: r.url, snippet: r.content ?? "", source: "searxng" }))
}

async function duckduckgo(net, query, limit) {
  const { response } = await fetchPublic(net, "https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: query }).toString(),
  })
  if (response.status === 429 || response.status === 403) throw rateLimited(`DuckDuckGo answered ${response.status}.`)
  if (!response.ok) throw badAnswer(`DuckDuckGo answered ${response.status}.`, response.status >= 500)
  const html = await readBody(response)
  const results = []
  for (const block of html.split(/class="result results_links/).slice(1)) {
    const link = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!link) continue
    let href = decode(link[1])
    const target = href.match(/[?&]uddg=([^&]+)/)
    if (target) href = decodeURIComponent(target[1])
    if (href.startsWith("//")) href = `https:${href}`
    if (/duckduckgo\.com\/y\.js/.test(href)) continue // ads
    const snippet = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? ""
    results.push({ title: strip(link[2]), url: href, snippet: strip(snippet), source: "duckduckgo" })
    if (results.length >= limit) break
  }
  if (!results.length && /anomaly|captcha/i.test(html)) throw rateLimited("DuckDuckGo answered with its anomaly (bot check) page.")
  return results
}

const apiUrl = (base, params) => `${base}?${new URLSearchParams(params)}`

// A public API's JSON or XML body, through the public-address checks.
async function apiBody(net, name, url) {
  const { response } = await fetchPublic(net, url, { timeoutMs: LIMITS.apiTimeoutMs, headers: { "user-agent": API_UA } })
  if (response.status === 429 || response.status === 503) throw rateLimited(`${name} answered ${response.status} (rate limit).`)
  if (!response.ok) throw badAnswer(`${name} answered ${response.status}.`, response.status >= 500)
  return readBody(response)
}

async function wikipedia(net, query, limit) {
  return parseWikipedia(await apiBody(net, "Wikipedia", apiUrl("https://en.wikipedia.org/w/api.php", { action: "query", list: "search", srsearch: query, format: "json", srlimit: String(limit) })))
}

export function parseWikipedia(body) {
  const data = typeof body === "string" ? JSON.parse(body) : body
  return (data?.query?.search ?? []).map((r) => ({
    title: r.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(r.title).replace(/ /g, "_")).replace(/%2F/g, "/").replace(/%3A/g, ":")}`,
    snippet: clip(strip(r.snippet ?? "")),
    source: "wikipedia",
  }))
}

async function arxiv(net, query, limit) {
  // arXiv's query syntax: every word as all:<word>, joined with AND; operators and punctuation dropped.
  const words = query.replace(/[^\p{L}\p{N}\s.-]/gu, " ").split(/\s+/).filter((w) => w && !/^(and|or|andnot)$/i.test(w))
  if (!words.length) return []
  return parseArxiv(await apiBody(net, "arXiv", apiUrl("https://export.arxiv.org/api/query", { search_query: words.map((w) => `all:${w}`).join(" AND "), start: "0", max_results: String(limit), sortBy: "relevance" })))
}

export function parseArxiv(xml) {
  const results = []
  for (const [, entry] of String(xml).matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)) {
    const tag = (name) => strip(entry.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? "")
    const alternate = entry.match(/<link\b(?=[^>]*rel="alternate")[^>]*href="([^"]+)"/)?.[1]
    const url = decode(alternate ?? tag("id")).replace(/^http:\/\//, "https://")
    if (!url || url.includes("/api/errors")) continue // an error entry (a bad query)
    results.push({ title: tag("title"), url, snippet: clip(tag("summary")), source: "arxiv", published: tag("published").slice(0, 10) })
  }
  return results
}

async function hn(net, query, limit) {
  return parseHn(await apiBody(net, "HN Algolia", apiUrl("https://hn.algolia.com/api/v1/search", { query, tags: "story", hitsPerPage: String(limit) })))
}

export function parseHn(body) {
  const data = typeof body === "string" ? JSON.parse(body) : body
  return (data?.hits ?? [])
    .filter((h) => h.title || h.story_title)
    .map((h) => ({
      title: h.title || h.story_title,
      url: h.url || `https://news.ycombinator.com/item?id=${h.story_id ?? h.objectID}`,
      snippet: `${h.points ?? 0} points · ${h.num_comments ?? 0} comments · ${String(h.created_at ?? "").slice(0, 10)}`,
      source: "hn",
    }))
}

// ── queues, cooling, cache ──────────────────────────────────────────────

// One engine's queue: run() lets at most `concurrency` searches in at once; paced(request) starts every request to the
// engine's host (retries and redirect hops included) `spacingMs` after the one before, the clock read in the same tick
// as the request starts.
function createQueue({ concurrency = 1, spacingMs = 0 }, clock) {
  let active = 0
  let nextStart = -Infinity
  const waiting = []
  return {
    async run(task) {
      if (active < concurrency) active++
      else await new Promise((resolve) => waiting.push(resolve)) // the slot is handed over on release
      try {
        return await task()
      } finally {
        const next = waiting.shift()
        if (next) next()
        else active--
      }
    },
    async paced(request) {
      for (let wait; (wait = nextStart - clock.now()) > 0; ) await clock.sleep(wait) // re-checked: another may go first
      nextStart = clock.now() + spacingMs
      return request()
    },
  }
}

function createSearchState(clock) {
  return {
    queues: Object.fromEntries(Object.entries(LIMITS.engines).map(([name, cfg]) => [name, createQueue(cfg, clock)])),
    cooling: new Map(), // engine -> { until: ms, why }
    cache: new Map(), // key -> { at, value }
    inflight: new Map(), // key -> Promise (the same search asked twice at once runs once)
  }
}

// Every web in this process shares one state (the desks hosted together share the engines' limits); a web with its
// own clock (tests) gets its own.
let processState = null

const DDG_HOST = /(^|\.)duckduckgo\.com$/i
const API_HOSTS = { "en.wikipedia.org": "wikipedia", "export.arxiv.org": "arxiv", "hn.algolia.com": "hn" }

export function createWeb(env = process.env, deps = {}) {
  const searx = env.ASKK_SEARXNG_URL?.trim() || null
  const engine = searx ? "searxng" : "duckduckgo"
  const clock = { now: deps.now ?? (() => Date.now()), sleep: deps.sleep ?? ((ms) => Bun.sleep(ms)) }
  const state = deps.state ?? (deps.now || deps.sleep ? createSearchState(clock) : (processState ??= createSearchState(clock)))
  const send = deps.fetch ?? ((url, init) => fetch(url, init))
  const searxOrigin = attempt(() => (searx ? new URL(searx).origin : null))
  // Every request to an engine's host waits for its spacing, whoever makes it: a search, a retry, a redirect hop, or
  // web/read of a DuckDuckGo page. The timeout starts once the request may go.
  const queueFor = (url) =>
    DDG_HOST.test(url.hostname) ? "duckduckgo" : url.origin === searxOrigin ? "searxng" : url.protocol === "https:" ? API_HOSTS[url.hostname] : undefined
  const net = {
    lookup: deps.lookup ?? ((host) => Bun.dns.lookup(host)),
    // `via`: the checked address to connect to instead of resolving the name again (fetchPublic, http:); the queue
    // still goes by the URL's own host.
    fetch(raw, init = {}, timeoutMs = TIMEOUT, via = null) {
      const url = new URL(raw)
      const target = via ? pinned(url, via) : url
      const headers = via ? { ...init.headers, host: url.host } : init.headers
      const go = () => send(target, { ...init, ...(headers ? { headers } : {}), signal: AbortSignal.timeout(timeoutMs) })
      const queue = state.queues[queueFor(url)]
      return queue ? queue.paced(go) : go()
    },
  }

  const coolingLeft = (name) => Math.max(0, (state.cooling.get(name)?.until ?? 0) - clock.now())
  const cooling = (name) => engineError(429, `${name} is cooling down ${state.cooling.get(name).why} (${Math.ceil(coolingLeft(name) / 1000)} s left).`, "cooling")
  const cool = (name, ms, why) => state.cooling.set(name, { until: clock.now() + ms, why })

  // One engine search through its queue: skipped while cooling, a rate-limited answer retried after each backoff in
  // retryMs (each request still paced by net.fetch), then the engine cools for coolMs; an engine that is down
  // (no answer, timeout, 5xx) is skipped for downMs.
  async function limited(name, request) {
    const cfg = LIMITS.engines[name]
    const queue = state.queues[name]
    if (coolingLeft(name)) throw cooling(name)
    return queue.run(async () => {
      for (let attempt = 0; ; attempt++) {
        if (coolingLeft(name)) throw cooling(name)
        try {
          return await request()
        } catch (error) {
          if (!error.rateLimited) {
            if (error.down && cfg.downMs) cool(name, cfg.downMs, "after a failure")
            throw error
          }
          const wait = cfg.retryMs?.[attempt]
          if (wait == null) {
            cool(name, cfg.coolMs, "after rate limits")
            const tries = `${attempt + 1} ${attempt ? "tries" : "try"}`
            throw engineError(429, `${name} rate-limited (${tries}; skipped for ${cfg.coolMs / 1000} s): ${error.message}`, "rate-limited")
          }
          await clock.sleep(wait)
        }
      }
    })
  }

  // The same key within cacheMs answers from memory; `keep` says which answers are stored.
  async function cached(key, produce, keep) {
    const hit = state.cache.get(key)
    if (hit && clock.now() - hit.at < LIMITS.cacheMs) return hit.value
    if (hit) state.cache.delete(key)
    if (state.inflight.has(key)) return state.inflight.get(key)
    const pending = produce()
      .then((value) => {
        if (keep(value)) {
          state.cache.set(key, { at: clock.now(), value })
          while (state.cache.size > LIMITS.cacheEntries) state.cache.delete(state.cache.keys().next().value)
        }
        return value
      })
      .finally(() => state.inflight.delete(key))
    state.inflight.set(key, pending)
    return pending
  }

  const apis = { wikipedia, arxiv, hn }
  const api = (source, query, n) =>
    cached(`${source}\n${n}\n${query.toLowerCase()}`, async () => ({ engine: source, query, results: await limited(source, () => apis[source](net, query, n)) }), (v) => v.results.length > 0)

  // wikipedia + arxiv + hn, merged round-robin up to n, each result tagged with its source.
  async function fallback(query, n, why, status) {
    const settled = await Promise.allSettled(FALLBACK.map((source) => api(source, query, n)))
    const answered = FALLBACK.filter((_, i) => settled[i].status === "fulfilled")
    // An engine error already names its source ("arxiv rate-limited (…)"); others get it in front.
    const failure = (source, error) => (error?.reason ? brief(error) : `${source}: ${String(error?.message ?? error).replace(/\.$/, "")}`)
    const failed = FALLBACK.flatMap((source, i) => (settled[i].status === "rejected" ? [failure(source, settled[i].reason)] : []))
    if (!answered.length) throw new HttpError(status === 429 ? 429 : 502, `${why}; the fallback failed too (${failed.join("; ")})`)
    const lists = settled.map((r) => (r.status === "fulfilled" ? r.value.results : []))
    const results = []
    const seen = new Set()
    for (let i = 0; results.length < n && lists.some((list) => i < list.length); i++) {
      for (const list of lists) {
        const r = list[i]
        if (!r || seen.has(r.url) || results.length >= n) continue
        seen.add(r.url)
        results.push(r)
      }
    }
    const note = `${why}; answered from ${answered.join(", ")}${failed.length ? ` (${failed.join("; ")})` : ""}`
    return { engine: "fallback", query, results, note }
  }

  async function web(query, n) {
    let results
    try {
      results = await limited(engine, () => (searx ? searxng(net, searx, query, n) : duckduckgo(net, query, n)))
    } catch (error) {
      const why = error.reason ? brief(error) : `${engine} failed (${error.message.replace(/\.$/, "")})`
      return fallback(query, n, why, error.status)
    }
    if (!results.length) return fallback(query, n, `${engine} returned no results`, 502)
    return { engine, query, results }
  }

  // A public page's body, and whether it is markup.
  async function readPage(raw) {
    const { url, response } = await fetchPublic(net, String(raw ?? ""))
    if (!response.ok) throw new HttpError(502, `${url.host} answered ${response.status}.`)
    const type = response.headers.get("content-type") ?? ""
    const body = await readBody(response)
    return { url, body, type, html: /html|xml/.test(type) || /^\s*</.test(body) }
  }
  const shown = (text) => (text.length > MAX_TEXT ? { text: `${text.slice(0, MAX_TEXT)}\n…[truncated]`, truncated: true } : { text, truncated: false })

  return {
    engine,
    sources: SOURCES,
    async search(query, limit = LIMITS.searchResults, source = "web") {
      query = String(query ?? "").trim().replace(/\s+/g, " ")
      if (!query) throw new HttpError(400, "Give a query (q).")
      source = String(source ?? "web").trim().toLowerCase() || "web"
      if (!SOURCES.includes(source)) throw new HttpError(400, `Unknown source "${source}"; use one of: ${SOURCES.join(", ")}.`)
      const n = Math.min(Math.max(Number(limit) || LIMITS.searchResults, 1), LIMITS.searchResultsMax)
      const answer =
        source === "web"
          ? await cached(`web\n${n}\n${query.toLowerCase()}`, () => web(query, n), (v) => v.engine !== "fallback" && v.results.length > 0)
          : await api(source, query, n)
      return { ...answer, query }
    },
    async read(raw) {
      const { url, body, html } = await readPage(raw)
      const page = html ? htmlToText(body) : { title: "", text: body.trim() }
      return { url: url.href, title: page.title, ...shown(page.text) }
    },
    // The page to navigate (htmlToPage): the same public-address checks at every hop as read; the address it landed on
    // (after redirects) is the base its links resolve against. Not HTML: its text, no links.
    async page(raw) {
      const { url, body, html, type } = await readPage(raw)
      const page = html ? htmlToPage(body, url.href) : { title: "", text: body.trim(), links: [], forms: [] }
      return { url: url.href, title: page.title, type: type.split(";")[0].trim(), ...shown(page.text), links: page.links, forms: page.forms }
    },
  }
}

// The host routes (companion/server/host-api.js).
export const webRoutes = (web) => ({
  GET: {
    "web/search": (params) => web.search(params.get("q"), params.get("limit"), params.get("source") ?? undefined),
    "web/read": (params) => web.read(params.get("url")),
    "web/page": (params) => web.page(params.get("url")),
  },
})
