// web.search / web.read (backend/kernel/builtin/web.js, 2026-10-17): ported with the research desk's tests (archived
// ~/.askk/archive/2026-10-17-research-desk/desk/tests/web-search.test.js) — the 429/5xx fallback note, the 2-minute
// advice — plus query as q, and web.read narrowed here (find, max_chars).

import { describe, expect, test } from "bun:test"
import { webReadTool, webSearchTool } from "../index.js"

const search = webSearchTool()
const read = webReadTool()

// A stub ctx.host whose get fails per source with the given message, or answers with one result.
const ctx = (fails, seen = []) => ({
  host: {
    get: async (path) => {
      seen.push(path)
      const s = new URL(`http://x/${path}`).searchParams.get("source")
      if (fails[s]) throw new Error(fails[s])
      return { engine: s, query: "q", results: [{ title: "T", url: "https://example.org/t", snippet: "S", source: s }] }
    },
  },
})
const fail = (input, fails) =>
  search.run(input, ctx(fails)).then(
    () => {
      throw new Error("expected web.search to throw")
    },
    (e) => e.message,
  )

describe("web.search", () => {
  test("wikipedia 429 then web 400 names wikipedia only, reports web HTTP 400", async () => {
    const m = await fail({ q: "bun runtime", source: "wikipedia" }, { wikipedia: "HTTP 429 Too Many Requests", web: "HTTP 400 Bad Request" })
    expect(m).toContain("wikipedia (HTTP 429 rate limit)")
    expect(m).toContain("web (HTTP 400)")
    expect(m).not.toContain("server error")
    expect(m).toContain("Do not call web.search with source wikipedia again for 2 minutes")
    expect(m).not.toContain("wikipedia or web")
  })

  test("wikipedia 503 then web 429 names both", async () => {
    const m = await fail({ q: "bun runtime", source: "wikipedia" }, { wikipedia: "HTTP 503 Service Unavailable", web: "HTTP 429 Too Many Requests" })
    expect(m).toContain("wikipedia (HTTP 503 server error)")
    expect(m).toContain("web (HTTP 429 rate limit)")
    expect(m).toContain("Do not call web.search with source wikipedia or web again for 2 minutes")
  })

  test("arxiv 429 then web 404 labels 404 by its code only", async () => {
    const m = await fail({ q: "llm agents", source: "arxiv" }, { arxiv: "HTTP 429 Too Many Requests", web: "HTTP 404 Not Found" })
    expect(m).toContain("web (HTTP 404)")
    expect(m).not.toContain("HTTP 404 server error")
    expect(m).toContain("source arxiv again for 2 minutes")
  })

  test("a network error on web is not named in the 2-minute advice", async () => {
    const m = await fail({ q: "news", source: "hn" }, { hn: "HTTP 502 Bad Gateway", web: "fetch failed" })
    expect(m).toContain("web (fetch failed)")
    expect(m).toContain("source hn again for 2 minutes")
    expect(m).not.toContain("hn or web")
  })

  test("a 4xx from wikipedia is passed through, not retried", async () => {
    expect(await fail({ q: "x", source: "wikipedia" }, { wikipedia: "HTTP 403 Forbidden" })).toBe("HTTP 403 Forbidden")
  })

  test("a 5xx from wikipedia is retried once on web, with the fallback note", async () => {
    const out = await search.run({ q: "bun runtime", source: "wikipedia" }, ctx({ wikipedia: "HTTP 503 Service Unavailable" }))
    expect(out).toContain("note: source wikipedia failed (HTTP 503 server error); these results came from source web instead")
    expect(out).toContain("1. [web] T — https://example.org/t")
  })

  test("query works as q; the host's note is shown; a bad source, no terms or no host are refused", async () => {
    const seen = []
    const out = await search.run({ query: "nemotron mxfp8", limit: 3 }, ctx({}, seen))
    expect(seen).toEqual(["web/search?q=nemotron%20mxfp8&limit=3&source=web"])
    expect(out).toBe("1. [web] T — https://example.org/t\n   S")
    const noted = await search.run({ q: "x" }, { host: { get: async () => ({ engine: "fallback", results: [], note: "DuckDuckGo rate-limited" }) } })
    expect(noted).toBe("note: DuckDuckGo rate-limited\nno results for x (source web)")
    await expect(search.run({ q: "x", source: "bing" }, ctx({}))).rejects.toThrow("source: one of web, wikipedia, arxiv, hn")
    await expect(search.run({}, ctx({}))).rejects.toThrow("q: what to search for")
    await expect(search.run({ q: "x" }, {})).rejects.toThrow("web.search: no host here")
    expect(search).toMatchObject({ type: "function", view: "web" })
  })
})

describe("web.read", () => {
  const page = `${"intro ".repeat(400)}The FOMC held rates. ${"filler ".repeat(400)}CPI rose 0.4%. ${"tail ".repeat(400)}`
  const host = (seen = []) => ({ get: async (path) => (seen.push(path), { url: "https://example.org/a", title: "Rates", text: page, truncated: false }) })

  test("find narrows to the passages around the terms (here: the host sends the page whole)", async () => {
    const seen = []
    const out = await read.run({ url: "https://example.org/a", find: "fomc, cpi" }, { host: host(seen) })
    expect(seen).toEqual(["web/read?url=https%3A%2F%2Fexample.org%2Fa"])
    expect(out.split("\n")[0]).toBe("Rates (https://example.org/a)")
    expect(out).toContain("[2 passage(s) matching fomc, cpi]")
    expect(out).toContain("The FOMC held rates.")
    expect(out).toContain("CPI rose 0.4%.")
    expect(out.length).toBeLessThan(page.length)
  })

  test("max_chars caps the text and says so; without find it keeps 4000 chars", async () => {
    const out = await read.run({ url: "https://example.org/a", max_chars: 500 }, { host: host() })
    expect(out).toEndWith("… cut at 500 chars: narrow it with find, or raise max_chars")
    expect(out.split("\n")[1]).toHaveLength(500)
    const whole = await read.run({ url: "https://example.org/a", find: ["nothing-here"] }, { host: host() })
    expect(whole).toContain("[no passage matches nothing-here]")
    const plain = await read.run({ url: "https://example.org/a" }, { host: host() })
    expect(plain.split("\n")[1]).toHaveLength(4000)
    await expect(read.run({ url: "file:///etc/passwd" }, { host: host() })).rejects.toThrow("url: a public http(s) address")
  })
})
