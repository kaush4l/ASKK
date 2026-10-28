import { Tool } from "../tool/tool.js"
import { FIND_CHARS, narrowText, READ_CHARS } from "../util/text.js"

// web.search / web.read: the web through the host (GET web/search, GET web/read on ctx.host), for any agent that
// lists them (2026-10-17: ported from the research desk's tools/web-search.js when that desk was archived — its
// 429/5xx fallback and its 2-minute advice kept, its tests in backend/kernel/test/builtin-web.test.js).
//
// web.search: a rate-limited (429) or failing (5xx) wikipedia / arxiv / hn call is retried once on web, and the result says
// so (note); when that fails too, the error names the sources to leave alone for 2 minutes. web.read: with find, only the
// passages around those terms (narrowText, here: the host returns the page whole).
//
// Both are data tools (type function, view web): the same call twice in one run answers from the first.

const SOURCES = ["web", "wikipedia", "arxiv", "hn"]
const FALLS_BACK = ["wikipedia", "arxiv", "hn"] // a 429 or 5xx from these is retried once on web
const LIMIT = 6
const READ_MAX = 4000 // web.read's text without max_chars

const msg = (e) => String(e?.message ?? e)
const retryable = (e) => /HTTP (429|5\d\d)/.test(msg(e))
const why = (e) => {
  const code = msg(e).match(/HTTP (\d{3})/)?.[1]
  if (!code) return msg(e)
  return code === "429" ? "HTTP 429 rate limit" : code[0] === "5" ? `HTTP ${code} server error` : `HTTP ${code}`
}
const hostOf = (ctx, tool) => {
  if (!ctx?.host?.get) throw new Error(`${tool}: no host here (ctx.host) — the desk server reaches the web`)
  return ctx.host
}
const terms = (find) => (find == null || find === "" ? [] : Array.isArray(find) ? find : String(find).split(",")).map((t) => String(t).trim()).filter(Boolean)

export function webSearchTool() {
  return new Tool({
    name: "web.search",
    view: "web",
    description:
      "search the web, wikipedia, arxiv or hn: numbered results with source, title, URL and snippet. Prefer source web for general questions; use arxiv only for papers. A rate-limited or failing wikipedia/arxiv/hn call is retried once on web (see the note); if that fails too, the error names the sources to leave alone for 2 minutes (those rate-limited or failing 5xx)",
    input: { q: "the search terms (query works too)", limit: `results, default ${LIMIT}`, source: "web (default) | wikipedia | arxiv | hn" },
    run: async (input = {}, ctx = {}) => {
      const q = String(input.q ?? input.query ?? "").trim()
      if (!q) throw new Error("q: what to search for")
      const src = String(input.source || "web").trim().toLowerCase()
      if (!SOURCES.includes(src)) throw new Error(`source: one of ${SOURCES.join(", ")}`)
      const host = hostOf(ctx, "web.search")
      const limit = Math.max(1, Math.min(20, Number(input.limit) || LIMIT))
      // GET web/search → { engine, query, results: [{ title, url, snippet, source }], note? }
      const get = (s) => host.get(`web/search?q=${encodeURIComponent(q)}&limit=${limit}&source=${s}`, { signal: ctx.signal })
      let r
      let used = src
      let fellBack = ""
      try {
        r = await get(src)
      } catch (e) {
        if (!FALLS_BACK.includes(src) || !retryable(e)) throw e
        try {
          r = await get("web")
          used = "web"
          fellBack = `source ${src} failed (${why(e)}); these results came from source web instead`
        } catch (e2) {
          // only a 429 or 5xx is worth waiting out; a 4xx or a network error is not
          const wait = [[src, e], ["web", e2]].filter(([, x]) => retryable(x)).map(([s]) => s)
          throw new Error(
            `web.search failed on every source tried: ${src} (${why(e)}), web (${why(e2)}). ` +
              (wait.length ? `Do not call web.search with source ${wait.join(" or ")} again for 2 minutes; w` : "W") +
              `ork from the results you have or web.read known URLs.`,
          )
        }
      }
      const lines = (r?.results ?? []).map((x, i) => `${i + 1}. [${x.source ?? used}] ${x.title} — ${x.url}\n   ${x.snippet ?? ""}`)
      const head = [fellBack, r?.note].filter(Boolean).map((n) => `note: ${n}\n`).join("")
      return head + (lines.join("\n") || `no results for ${q} (source ${used})`)
    },
  })
}

export function webReadTool() {
  return new Tool({
    name: "web.read",
    view: "web",
    description: "read a public page: its title, URL and text — with find, only the passages around those terms (use it: a whole page is long)",
    input: { url: "https://…", find: "terms, comma-separated (optional)", max_chars: `the most text to keep (default ${READ_MAX}, at most ${READ_CHARS})` },
    run: async (input = {}, ctx = {}) => {
      const url = String(input.url ?? "").trim()
      if (!/^https?:\/\//i.test(url)) throw new Error("url: a public http(s) address")
      const host = hostOf(ctx, "web.read")
      // GET web/read → { url, title, text, truncated } — the host returns the page whole: narrowed here
      const page = await host.get(`web/read?url=${encodeURIComponent(url)}`, { signal: ctx.signal })
      const find = terms(input.find)
      const max = Number(input.max_chars) > 0 ? Math.min(READ_CHARS, Math.floor(Number(input.max_chars))) : find.length ? undefined : READ_MAX
      const { text, truncated } = narrowText(page?.text ?? "", { find, max })
      const cut = truncated ? `\n… cut at ${max ?? FIND_CHARS} chars: narrow it with find, or raise max_chars` : ""
      return `${page?.title ?? ""} (${page?.url ?? url})\n${text}${cut}`
    },
  })
}

export const WEB_TOOLS = { "web.search": webSearchTool, "web.read": webReadTool }
