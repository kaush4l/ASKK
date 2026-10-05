// The web.* tools: search the internet and read a page as text.
//
// Local mode (capability `web`): the host does both (companion/web.js) —
// SearXNG when ASKK_SEARXNG_URL names one (free, open-source metasearch),
// else DuckDuckGo's keyless HTML page; pages are fetched by the host, public
// addresses only. Browser-only: search falls back to Wikipedia's open API
// (CORS-enabled), and web.read fetches directly, so only sites that allow
// cross-origin reads work.
//
//   web.search({"query": "bun 1.4 release notes", "limit": 5})
//   web.read({"url": "https://bun.com/blog"})

import { withBase } from "@/backend/platform/base-path"
import { detectHost, hasCapability } from "@/backend/platform/host"

const MAX_TEXT = 40_000

async function host(endpoint, params) {
  let response
  try {
    response = await fetch(`${withBase(`/__askk/${endpoint}`)}?${new URLSearchParams(params)}`, { cache: "no-store" })
  } catch {
    throw new Error("The ASKK companion is not reachable.")
  }
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) throw new Error(data?.error ?? `Web request failed (${response.status}).`)
  return data
}

const stripTags = (html = "") => html.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#0?39;/g, "'")

async function wikipedia(query, limit) {
  const url = `https://en.wikipedia.org/w/api.php?${new URLSearchParams({
    action: "query", list: "search", srsearch: query, srlimit: String(limit), format: "json", origin: "*",
  })}`
  const response = await fetch(url).catch(() => null)
  if (!response?.ok) throw new Error("Wikipedia search is not reachable.")
  const data = await response.json()
  return (data.query?.search ?? []).map((r) => ({
    title: r.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`,
    snippet: stripTags(r.snippet),
  }))
}

function formatResults({ engine, query, results }) {
  if (!results.length) return `No results for “${query}” (${engine}).`
  return [
    `${results.length} results for “${query}” (${engine}):`,
    ...results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`),
  ].join("\n")
}

async function search({ query, limit = 8 }) {
  const q = String(query ?? "").trim()
  if (!q) throw new Error('Expected {"query": "what to search for"}.')
  const n = Math.min(Math.max(Number(limit) || 8, 1), 20)
  if (hasCapability(await detectHost(), "web")) return formatResults(await host("web/search", { q, limit: n }))
  return formatResults({ engine: "wikipedia (browser-only mode)", query: q, results: await wikipedia(q, n) })
}

async function read({ url }) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) throw new Error('Expected {"url": "https://…"}.')
  let page
  if (hasCapability(await detectHost(), "web")) {
    page = await host("web/read", { url })
  } else {
    const response = await fetch(url).catch(() => null)
    if (!response) throw new Error(`${url} cannot be read from the browser (CORS); run ASKK locally to read any page.`)
    if (!response.ok) throw new Error(`${url} answered ${response.status}.`)
    const raw = await response.text()
    // Workers have no DOMParser: strip tags by hand.
    const text = /html/.test(response.headers.get("content-type") ?? "")
      ? raw.replace(/<(script|style|noscript|svg|nav|footer|header)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim()
      : raw.trim()
    const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? ""
    page = { url, title, text: text.slice(0, MAX_TEXT), truncated: text.length > MAX_TEXT }
  }
  return `${page.title ? `# ${page.title}\n` : ""}${page.url}\n\n${page.text}${page.truncated ? "\n…[truncated]" : ""}`
}

async function describeWeb() {
  return hasCapability(await detectHost(), "web")
    ? "Web: web.search searches the internet; web.read returns a public page as text."
    : "Web: browser-only mode — web.search covers Wikipedia only; web.read works only on sites that allow cross-origin reads."
}

export const WEB_TOOLS = {
  "web.search": {
    description:
      "Search the internet. Returns numbered results: title, URL, snippet. Search first, then web.read the best 1-3 URLs " +
      "before trusting a snippet.",
    inputs: {
      type: "object",
      properties: { query: { type: "string", minLength: 1, maxLength: 400 }, limit: { type: "integer", minimum: 1, maximum: 20 } },
      required: ["query"],
      additionalProperties: false,
    },
    context: describeWeb,
    run: search,
  },
  "web.read": {
    description: "Read one web page (http/https URL) as plain text (max 40K characters).",
    inputs: {
      type: "object",
      properties: { url: { type: "string", minLength: 8, maxLength: 2000 } },
      required: ["url"],
      additionalProperties: false,
    },
    context: describeWeb,
    run: read,
  },
}
