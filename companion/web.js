// Web search and page reading for agents (capability `web`), on the host
// because a browser cannot fetch other sites (CORS).
//
//   GET web/search?q=…&limit=…   { engine, query, results: [{ title, url, snippet }] }
//   GET web/read?url=…           { url, title, text, truncated }
//
// Search: SearXNG (free, open-source metasearch, AGPL) when ASKK_SEARXNG_URL
// names an instance with the JSON format on (`search.formats: [html, json]`
// in its settings.yml; `docker run -p 8888:8080 searxng/searxng`). Without
// it, DuckDuckGo's keyless HTML page. No key, no account either way.
//
// Read: public http(s) pages only. The host refuses loopback, private and
// link-local addresses (an agent's URL must never reach the owner's network),
// follows at most 5 redirects, each re-checked, and returns plain text.

import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

const UA = "Mozilla/5.0 (compatible; ASKK/1.0; +https://github.com/kaush4l/ASKK)"
const MAX_BYTES = 2_000_000
const MAX_TEXT = 40_000
const TIMEOUT = 15_000

class WebError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// ── addresses ───────────────────────────────────────────────────────────

function privateV4(ip) {
  const [a, b] = ip.split(".").map(Number)
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
}
function privateAddress(ip) {
  if (isIP(ip) === 4) return privateV4(ip)
  const v6 = ip.toLowerCase()
  if (v6.startsWith("::ffff:")) return privateAddress(v6.slice(7))
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff")
}

async function publicUrl(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new WebError(400, `Not a URL: ${raw}`)
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new WebError(400, "Only http(s) URLs can be read.")
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new WebError(403, "Local addresses cannot be read.")
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => [])
  if (!addresses.length) throw new WebError(502, `Cannot resolve ${host}.`)
  if (addresses.some(({ address }) => privateAddress(address))) throw new WebError(403, "Private network addresses cannot be read.")
  return url
}

// Fetch a public URL, re-checking every redirect hop.
async function fetchPublic(raw, init = {}) {
  let url = await publicUrl(raw)
  for (let hop = 0; hop <= 5; hop++) {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      headers: { "user-agent": UA, "accept-language": "en", ...init.headers },
      signal: AbortSignal.timeout(TIMEOUT),
    }).catch((error) => {
      throw new WebError(502, `${url.host} is not reachable (${error.name === "TimeoutError" ? "timeout" : error.message}).`)
    })
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      url = await publicUrl(new URL(response.headers.get("location"), url).href)
      continue
    }
    return { url, response }
  }
  throw new WebError(502, "Too many redirects.")
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
  return new TextDecoder().decode(Buffer.concat(chunks))
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

export function htmlToText(html) {
  const title = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
  const body = (html.match(/<(main|article)\b[\s\S]*?<\/\1>/i)?.[0] ?? html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html)
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|li|tr|h[1-6]|pre|blockquote)>|<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<h([1-6])[^>]*>/gi, (_, n) => `\n${"#".repeat(Number(n))} `)
  const text = decode(body.replace(/<[^>]+>/g, ""))
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .filter((line, i, all) => line || all[i - 1])
    .join("\n")
    .trim()
  return { title, text }
}

// ── search ──────────────────────────────────────────────────────────────

async function searxng(base, query, limit) {
  const url = new URL("search", base.endsWith("/") ? base : `${base}/`)
  url.search = new URLSearchParams({ q: query, format: "json" }).toString()
  // The owner's own instance may run on this machine: no public-address check.
  const response = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT) }).catch(() => null)
  if (!response?.ok) throw new WebError(502, `SearXNG at ${url.origin} did not answer (is format json enabled?).`)
  const data = await response.json()
  return (data.results ?? []).slice(0, limit).map((r) => ({ title: r.title ?? "", url: r.url, snippet: r.content ?? "" }))
}

async function duckduckgo(query, limit) {
  const { response } = await fetchPublic("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: query }).toString(),
  })
  if (!response.ok) throw new WebError(502, `DuckDuckGo answered ${response.status}.`)
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
    results.push({ title: strip(link[2]), url: href, snippet: strip(snippet) })
    if (results.length >= limit) break
  }
  if (!results.length && /anomaly|captcha/i.test(html)) {
    throw new WebError(429, "DuckDuckGo is rate-limiting this machine; set ASKK_SEARXNG_URL to a SearXNG instance.")
  }
  return results
}

export function createWeb(env = process.env) {
  const searx = env.ASKK_SEARXNG_URL?.trim() || null
  const engine = searx ? "searxng" : "duckduckgo"
  return {
    engine,
    async search(query, limit = 8) {
      query = String(query ?? "").trim()
      if (!query) throw new WebError(400, "Give a query (q).")
      const n = Math.min(Math.max(Number(limit) || 8, 1), 20)
      const results = searx ? await searxng(searx, query, n) : await duckduckgo(query, n)
      return { engine, query, results }
    },
    async read(raw) {
      const { url, response } = await fetchPublic(String(raw ?? ""))
      if (!response.ok) throw new WebError(502, `${url.host} answered ${response.status}.`)
      const type = response.headers.get("content-type") ?? ""
      const body = await readBody(response)
      const page = /html|xml/.test(type) || /^\s*</.test(body) ? htmlToText(body) : { title: "", text: body.trim() }
      const truncated = page.text.length > MAX_TEXT
      return { url: url.href, title: page.title, text: truncated ? `${page.text.slice(0, MAX_TEXT)}\n…[truncated]` : page.text, truncated }
    },
  }
}
