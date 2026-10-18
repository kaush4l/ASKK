// web/search with an injected fetch, DNS lookup and clock: no real network.
import { describe, expect, test } from "bun:test"
import { createWeb, parseArxiv, parseHn, parseWikipedia, privateAddress, webRoutes } from "./web.js"

// ── fixtures (trimmed real answers) ─────────────────────────────────────

const DDG_RESULTS = `<html><body>
<div class="result results_links results_links_deep web-result "><div class="links_main links_deep result__body">
<h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fagents&amp;rut=1">Multi-<b>agent</b> systems</a></h2>
<a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">Agents that <b>cooperate</b> &amp; plan.</a></div></div>
<div class="result results_links results_links_deep web-result "><div class="links_main links_deep result__body">
<h2 class="result__title"><a rel="nofollow" class="result__a" href="https://example.org/llm">LLM research</a></h2>
<a class="result__snippet" href="https://example.org/llm">A survey.</a></div></div>
</body></html>`

const DDG_ANOMALY = `<html><body><form id="challenge-form" class="anomaly-modal__form"><div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too.</div><div class="anomaly-modal__description">Please complete the following challenge to confirm this search was made by a human.</div></form></body></html>`

const WIKI = {
  batchcomplete: "",
  query: {
    searchinfo: { totalhits: 304 },
    search: [
      { ns: 0, title: "Multi-agent system", pageid: 938833, snippet: '(<span class="searchmatch">LLMs</span>), <span class="searchmatch">LLM</span>-based systems &amp; agents' },
      { ns: 0, title: "Agent harness", pageid: 83636670, snippet: 'An <span class="searchmatch">agent</span> harness' },
      { ns: 0, title: "AC/DC: a test", pageid: 1, snippet: "slash title" },
    ],
  },
}

const SUMMARY = "AutoGen is an open-source framework that allows developers to build LLM applications via multiple agents that can converse with each other to accomplish tasks. AutoGen agents are customizable, conversable, and can operate in various modes that employ combinations of LLMs, human inputs, and tools. Using AutoGen, developers can also flexibly define agent interaction behaviors."
const ARXIV = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <link href="http://arxiv.org/api/query?search_query%3Dall%3Amulti%26max_results%3D2" rel="self" type="application/atom+xml"/>
  <title type="html">ArXiv Query: search_query=all:multi&amp;max_results=2</title>
  <id>http://arxiv.org/api/abc</id>
  <updated>2026-10-16T00:00:00-04:00</updated>
  <entry>
    <id>http://arxiv.org/abs/2308.08155v2</id>
    <updated>2023-10-03T17:01:04Z</updated>
    <published>2023-08-16T05:57:52Z</published>
    <title>AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent
  Conversation</title>
    <summary>  ${SUMMARY}
</summary>
    <author><name>Qingyun Wu</name></author>
    <link href="http://arxiv.org/abs/2308.08155v2" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2308.08155v2" rel="related" type="application/pdf"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2402.01680v1</id>
    <published>2024-01-21T09:00:00Z</published>
    <title>Large Language Model based Multi-Agents: A Survey of Progress &amp; Challenges</title>
    <summary>A survey.</summary>
  </entry>
</feed>`

const HN = {
  hits: [
    { objectID: "49605822", title: "Multi-Agents LLM Financial Trading Framework", url: "https://github.com/TauricResearch/TradingAgents", points: 120, num_comments: 81, created_at: "2026-09-08T05:20:23Z" },
    { objectID: "41000001", title: "Ask HN: How do you run multi-agent research?", url: null, points: 15, num_comments: 9, created_at: "2025-07-01T10:00:00Z" },
  ],
}

// ── a fake network and clock ────────────────────────────────────────────

function harness({ ddg = () => DDG_RESULTS, ddgStatus = 200, wiki = () => WIKI, arxiv = () => ARXIV, hn = () => HN, env = {}, ddgDelay = 0 } = {}) {
  let t = 0
  const calls = [] // { host, url, at }
  let active = 0
  const peak = {}
  const now = () => t
  const sleep = async (ms) => {
    t += ms
  }
  const reply = (body, status = 200, type = "application/json") =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } })
  const fetch = async (raw, init) => {
    const url = new URL(String(raw))
    calls.push({ host: url.host, url, init, at: t })
    active++
    peak[url.host] = Math.max(peak[url.host] ?? 0, active)
    try {
      if (url.host === "html.duckduckgo.com") {
        if (ddgDelay) await sleep(ddgDelay)
        const body = ddg(url, init)
        return reply(body, body === DDG_ANOMALY ? 202 : ddgStatus, "text/html")
      }
      if (url.host === "en.wikipedia.org") return reply(wiki(url))
      if (url.host === "export.arxiv.org") return reply(arxiv(url), 200, "application/atom+xml")
      if (url.host === "hn.algolia.com") return reply(hn(url))
      if (url.host === "127.0.0.1:8888") return reply(env.searx(url))
      if (url.host === "duckduckgo.com" || url.host === "example.com") return reply("<html><title>Page</title><body><p>Text</p></body></html>", 200, "text/html")
      throw new Error(`unexpected fetch ${url}`)
    } finally {
      active--
    }
  }
  const lookups = []
  const lookup = async (host) => {
    lookups.push(host)
    return [{ address: "93.184.216.34" }]
  }
  const web = createWeb(env, { fetch, lookup, now, sleep })
  return {
    web,
    calls,
    peak,
    lookups,
    count: (host) => calls.filter((c) => c.host === host).length,
    starts: (host) => calls.filter((c) => c.host === host).map((c) => c.at),
    advance: (ms) => (t += ms),
    get now() {
      return t
    },
  }
}

const DDG = "html.duckduckgo.com"
const SOURCES = new Set(["wikipedia", "arxiv", "hn"])

// ── parsers ─────────────────────────────────────────────────────────────

describe("API parsers", () => {
  test("wikipedia: title, /wiki/ url with underscores, snippet without tags", () => {
    const r = parseWikipedia(JSON.stringify(WIKI))
    expect(r[0]).toEqual({ title: "Multi-agent system", url: "https://en.wikipedia.org/wiki/Multi-agent_system", snippet: "(LLMs), LLM-based systems & agents", source: "wikipedia" })
    expect(r[2].url).toBe("https://en.wikipedia.org/wiki/AC/DC:_a_test")
  })

  test("arxiv: Atom entries → title, https abs link, summary ≤ 300 chars, published day", () => {
    const r = parseArxiv(ARXIV)
    expect(r).toHaveLength(2)
    expect(r[0].title).toBe("AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation")
    expect(r[0].url).toBe("https://arxiv.org/abs/2308.08155v2")
    expect(r[0].snippet.length).toBeLessThanOrEqual(300)
    expect(r[0].snippet.startsWith("AutoGen is an open-source framework")).toBe(true)
    expect(r[0].published).toBe("2023-08-16")
    expect(r[0].source).toBe("arxiv")
    expect(r[1]).toMatchObject({ title: "Large Language Model based Multi-Agents: A Survey of Progress & Challenges", url: "https://arxiv.org/abs/2402.01680v1" })
    expect(parseArxiv(`<feed><entry><id>http://arxiv.org/api/errors#incorrect_id</id><title>Error</title></entry></feed>`)).toEqual([])
  })

  test("hn: story url, else the item page; points · comments · date", () => {
    const r = parseHn(JSON.stringify(HN))
    expect(r[0]).toEqual({ title: "Multi-Agents LLM Financial Trading Framework", url: "https://github.com/TauricResearch/TradingAgents", snippet: "120 points · 81 comments · 2026-09-08", source: "hn" })
    expect(r[1].url).toBe("https://news.ycombinator.com/item?id=41000001")
  })
})

// ── sources ─────────────────────────────────────────────────────────────

describe("web/search sources", () => {
  test("duckduckgo answers: results tagged duckduckgo, redirect links unwrapped", async () => {
    const h = harness()
    const r = await h.web.search("multi agent", 5)
    expect(r.engine).toBe("duckduckgo")
    expect(r.note).toBeUndefined()
    expect(r.results).toEqual([
      { title: "Multi-agent systems", url: "https://example.com/agents", snippet: "Agents that cooperate & plan.", source: "duckduckgo" },
      { title: "LLM research", url: "https://example.org/llm", snippet: "A survey.", source: "duckduckgo" },
    ])
    expect(h.count(DDG)).toBe(1)
  })

  test("source wikipedia | arxiv | hn asks that API only, with its own query", async () => {
    const h = harness()
    const w = await h.web.search("multi-agent LLM", 3, "wikipedia")
    expect(w.engine).toBe("wikipedia")
    expect(w.results.every((r) => r.source === "wikipedia")).toBe(true)
    const a = await h.web.search("multi-agent LLM", 3, "arxiv")
    expect(a.results.map((r) => r.source)).toEqual(["arxiv", "arxiv"])
    const n = await h.web.search("multi-agent LLM", 3, "HN")
    expect(n.engine).toBe("hn")
    expect(h.calls.map((c) => c.host)).toEqual(["en.wikipedia.org", "export.arxiv.org", "hn.algolia.com"])
    const [wiki, arxiv, hn] = h.calls.map((c) => c.url.searchParams)
    expect([wiki.get("action"), wiki.get("list"), wiki.get("srsearch"), wiki.get("srlimit"), wiki.get("format")]).toEqual(["query", "search", "multi-agent LLM", "3", "json"])
    expect(arxiv.get("search_query")).toBe("all:multi-agent AND all:LLM")
    expect(arxiv.get("max_results")).toBe("3")
    expect([hn.get("query"), hn.get("hitsPerPage"), hn.get("tags")]).toEqual(["multi-agent LLM", "3", "story"])
    // every API call went through the public-address check and names the project
    expect(h.lookups).toEqual(["en.wikipedia.org", "export.arxiv.org", "hn.algolia.com"])
    expect(h.calls[0].init.headers["user-agent"]).toMatch(/^ASKK-web-search\/1\.0 \(/)
  })

  test("an unknown source → 400 listing the valid ones (through the route)", async () => {
    const h = harness()
    const error = await webRoutes(h.web).GET["web/search"](new URLSearchParams("q=agents&source=bing")).catch((e) => e)
    expect(error.status).toBe(400)
    expect(error.message).toBe('Unknown source "bing"; use one of: web, wikipedia, arxiv, hn.')
    expect(h.calls).toHaveLength(0)
    // no source = web
    expect((await webRoutes(h.web).GET["web/search"](new URLSearchParams("q=agents&limit=2"))).engine).toBe("duckduckgo")
  })

  test("SearXNG path unchanged: the owner's instance, no address check, results tagged searxng", async () => {
    const searx = (url) => ({
      results: [
        { title: "A", url: "https://a.example/", content: "first" },
        { title: "B", url: "https://b.example/", content: "second" },
        { title: "C", url: "https://c.example/", content: "third" },
      ],
    })
    const h = harness({ env: { ASKK_SEARXNG_URL: "http://127.0.0.1:8888", searx } })
    const r = await h.web.search("agents", 2)
    expect(h.web.engine).toBe("searxng")
    expect(r).toEqual({
      engine: "searxng",
      query: "agents",
      results: [
        { title: "A", url: "https://a.example/", snippet: "first", source: "searxng" },
        { title: "B", url: "https://b.example/", snippet: "second", source: "searxng" },
      ],
    })
    expect(String(h.calls[0].url)).toBe("http://127.0.0.1:8888/search?q=agents&format=json")
    expect(h.lookups).toEqual([])
    expect(h.count(DDG)).toBe(0)
  })

  test("SearXNG down → the fallback, with a note naming why", async () => {
    const h = harness({ env: { ASKK_SEARXNG_URL: "http://127.0.0.1:8888", searx: () => { throw new Error("connection refused") } } })
    const r = await h.web.search("agents", 4)
    expect(r.engine).toBe("fallback")
    expect(r.note).toMatch(/^searxng failed \(SearXNG at http:\/\/127\.0\.0\.1:8888 did not answer/)
    expect(r.note).toMatch(/answered from wikipedia, arxiv, hn$/)
  })
})

// ── rate limits: retries, fallback, cooling ─────────────────────────────

describe("duckduckgo rate limits", () => {
  test("anomaly page → retried after 3 s and 8 s, then the fallback: merged round-robin, tagged, with a note", async () => {
    const h = harness({ ddg: () => DDG_ANOMALY })
    const r = await h.web.search("multi-agent LLM", 6)
    expect(h.starts(DDG)).toEqual([0, 3000, 11000]) // 1 try + 2 retries, never more
    expect(r.engine).toBe("fallback")
    expect(r.query).toBe("multi-agent LLM")
    expect(r.note).toBe("duckduckgo rate-limited (3 tries; skipped for 120 s); answered from wikipedia, arxiv, hn")
    expect(r.results).toHaveLength(6)
    expect(r.results.map((x) => x.source)).toEqual(["wikipedia", "arxiv", "hn", "wikipedia", "arxiv", "hn"])
    expect(r.results.every((x) => SOURCES.has(x.source) && x.title && x.url)).toBe(true)
  })

  test("a 429 counts as rate-limited too", async () => {
    const h = harness({ ddg: () => "", ddgStatus: 429 })
    const r = await h.web.search("agents", 3)
    expect(h.count(DDG)).toBe(3)
    expect(r.note).toMatch(/^duckduckgo rate-limited/)
  })

  test("cooling: for 2 min after its retries DuckDuckGo is skipped, then tried again", async () => {
    let limited = true
    const h = harness({ ddg: () => (limited ? DDG_ANOMALY : DDG_RESULTS) })
    await h.web.search("first question", 3)
    expect(h.count(DDG)).toBe(3)
    h.advance(60000)
    const r = await h.web.search("second question", 3)
    expect(h.count(DDG)).toBe(3) // skipped
    expect(r.engine).toBe("fallback")
    expect(r.note).toMatch(/^duckduckgo is cooling down after rate limits \(\d+ s left\); answered from wikipedia, arxiv, hn$/)
    limited = false
    h.advance(61000) // past the 2 min
    const back = await h.web.search("third question", 3)
    expect(h.count(DDG)).toBe(4)
    expect(back.engine).toBe("duckduckgo")
  })

  test("searches queued behind a rate-limited one fall back without hitting DuckDuckGo", async () => {
    const h = harness({ ddg: () => DDG_ANOMALY })
    const answers = await Promise.all(["a one", "b two", "c three"].map((q) => h.web.search(q, 3)))
    expect(h.count(DDG)).toBe(3) // only the first search's 1 + 2 retries
    expect(answers.every((a) => a.engine === "fallback")).toBe(true)
  })

  test("a source that does not answer is skipped for 30 s, so its queue does not wait out timeout after timeout", async () => {
    const timeout = () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" })
    }
    const h = harness({ ddg: () => DDG_ANOMALY, arxiv: timeout })
    const first = await h.web.search("one", 3)
    expect(first.note).toMatch(/; answered from wikipedia, hn \(arxiv: export\.arxiv\.org is not reachable \(timeout\)\)$/)
    const second = await h.web.search("two", 3)
    expect(h.count("export.arxiv.org")).toBe(1)
    expect(second.note).toMatch(/\(arxiv is cooling down after a failure \(\d+ s left\)\)$/)
    h.advance(30000)
    await h.web.search("three", 3)
    expect(h.count("export.arxiv.org")).toBe(2)
  })

  test("every fallback source down too → an error naming each", async () => {
    const down = () => {
      throw new Error("down")
    }
    const h = harness({ ddg: () => DDG_ANOMALY, wiki: down, arxiv: down, hn: down })
    const error = await h.web.search("agents", 3).catch((e) => e)
    expect(error.status).toBe(429)
    expect(error.message).toMatch(/^duckduckgo rate-limited .*; the fallback failed too \(wikipedia: .*; arxiv: .*; hn: .*\)$/)
  })
})

// ── queues ──────────────────────────────────────────────────────────────

describe("per-engine queues", () => {
  test("duckduckgo: one request at a time, starts ≥ 1.5 s apart, parallel or back to back", async () => {
    const h = harness({ ddgDelay: 400 })
    await Promise.all(["one", "two", "three"].map((q) => h.web.search(q, 2)))
    await h.web.search("four", 2)
    const starts = h.starts(DDG)
    expect(starts).toHaveLength(4)
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(1500)
    expect(h.peak[DDG]).toBe(1)
  })

  test("arxiv: starts ≥ 3 s apart (its API terms)", async () => {
    const h = harness()
    await Promise.all(["one", "two"].map((q) => h.web.search(q, 2, "arxiv")))
    const [a, b] = h.starts("export.arxiv.org")
    expect(b - a).toBeGreaterThanOrEqual(3000)
  })

  test("web/read of a DuckDuckGo page waits its turn with the searches", async () => {
    const h = harness()
    await h.web.search("agents", 2)
    await h.web.read("https://duckduckgo.com/about")
    await h.web.read("https://example.com/") // other hosts are not paced
    expect(h.calls.map((c) => [c.host, c.at])).toEqual([[DDG, 0], ["duckduckgo.com", 1500], ["example.com", 1500]])
  })

  test("process-wide: webs on the real clock share DuckDuckGo's queue (desks hosted together)", async () => {
    // A web with its own clock (the tests above) gets its own queues; the host's createWeb() calls share one.
    const starts = []
    const fetch = async () => {
      starts.push(Date.now())
      return new Response(DDG_RESULTS, { status: 200, headers: { "content-type": "text/html" } })
    }
    const lookup = async () => [{ address: "93.184.216.34" }]
    const a = createWeb({}, { fetch, lookup })
    const b = createWeb({}, { fetch, lookup })
    await Promise.all([a.search("process-wide queue one", 1), b.search("process-wide queue two", 1)])
    expect(starts).toHaveLength(2)
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1490) // real timers; unshared queues would start together
  })
})

// ── cache ───────────────────────────────────────────────────────────────

describe("cache", () => {
  test("the same normalised query + limit + source within 10 min makes no second fetch", async () => {
    const h = harness()
    const first = await h.web.search("Multi-Agent  LLM", 3, "wikipedia")
    const again = await h.web.search("  multi-agent llm ", 3, "wikipedia")
    expect(h.count("en.wikipedia.org")).toBe(1)
    expect(again.results).toEqual(first.results)
    expect(again.query).toBe("multi-agent llm")
    await h.web.search("multi-agent llm", 4, "wikipedia") // another limit
    await h.web.search("multi-agent llm", 3, "hn") // another source
    expect(h.count("en.wikipedia.org")).toBe(2)
    h.advance(10 * 60000)
    await h.web.search("multi-agent llm", 3, "wikipedia")
    expect(h.count("en.wikipedia.org")).toBe(3) // expired
  })

  test("web: a DuckDuckGo answer is kept; two identical searches at once fetch once", async () => {
    const h = harness({ ddgDelay: 100 })
    await Promise.all([h.web.search("agents", 2), h.web.search("Agents", 2)])
    await h.web.search("agents", 2)
    expect(h.count(DDG)).toBe(1)
  })

  test("a fallback answer is not kept as web, but its sources are", async () => {
    const h = harness({ ddg: () => DDG_ANOMALY })
    await h.web.search("agents", 3)
    const fetched = h.calls.length
    const again = await h.web.search("agents", 3) // cooling: falls back again, every source from memory
    expect(again.engine).toBe("fallback")
    expect(h.calls.length).toBe(fetched)
  })
})

// ── read ────────────────────────────────────────────────────────────────

test("read still refuses private addresses", async () => {
  const web = createWeb({}, { fetch: () => Promise.reject(new Error("no fetch")), lookup: async () => [{ address: "10.0.0.5" }], now: () => 0, sleep: async () => {} })
  expect((await web.read("https://intranet.example/").catch((e) => e)).status).toBe(403)
  expect((await web.read("http://localhost:3000/").catch((e) => e)).status).toBe(403)
})

// 2026-10-17: the check went by string prefixes, so 127.0.0.1 and 169.254.169.254 spelled as IPv6 got through.
describe("read: private addresses however they are spelled", () => {
  // Each one loopback, private, link-local or metadata; P is a live loopback port.
  const refused = (P) => [
    `http://[::ffff:127.0.0.1]:${P}/`,
    "http://[::ffff:7f00:1]/",
    "http://[::ffff:a9fe:a9fe]/", // 169.254.169.254
    "http://[64:ff9b::7f00:1]/", // NAT64
    "http://[::7f00:1]/", // IPv4-compatible
    "http://[2002:7f00:1::]/", // 6to4 of 127.0.0.1
    "http://[::1]/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
  ]

  const spy = (answer) => {
    const fetched = []
    const fetch = async (url, init) => {
      fetched.push(String(url))
      return answer(url, init)
    }
    return { fetched, fetch }
  }

  test("each is refused with 403 and makes no fetch", async () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("reached") })
    let hits = 0
    const { fetched, fetch } = spy(() => {
      hits++
      return new Response("reached")
    })
    try {
      const web = createWeb({}, { fetch, lookup: async () => [{ address: "93.184.216.34" }], now: () => 0, sleep: async () => {} })
      for (const url of refused(server.port)) {
        const error = await web.read(url).catch((e) => e)
        expect([url, error.status]).toEqual([url, 403])
      }
      expect(fetched).toEqual([])
      expect(hits).toBe(0)
    } finally {
      server.stop(true)
    }
  })

  test("a redirect hop to any of them is refused with 403 after the one public fetch", async () => {
    for (const target of refused(8080)) {
      const { fetched, fetch } = spy(() => new Response("", { status: 302, headers: { location: target } }))
      const web = createWeb({}, { fetch, lookup: async () => [{ address: "93.184.216.34" }], now: () => 0, sleep: async () => {} })
      const error = await web.read("https://public.example/start").catch((e) => e)
      expect([target, error.status]).toEqual([target, 403])
      expect(fetched).toEqual(["https://public.example/start"])
    }
  })

  test("a DNS answer in any of those spellings is refused too", async () => {
    for (const address of ["::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a9fe:a9fe", "::7f00:1", "2002:a00:1::", "fe80::1%en0", "::"]) {
      const { fetched, fetch } = spy(() => new Response("reached"))
      const web = createWeb({}, { fetch, lookup: async () => [{ address }], now: () => 0, sleep: async () => {} })
      expect([address, (await web.read("http://named.example/").catch((e) => e)).status]).toEqual([address, 403])
      expect(fetched).toEqual([])
    }
  })

  test("public addresses still pass", async () => {
    const { fetched, fetch } = spy(() => new Response("<html><title>Public</title><body><p>ok</p></body></html>", { headers: { "content-type": "text/html" } }))
    const web = createWeb({}, { fetch, lookup: async () => [{ address: "2606:4700:4700::1111" }], now: () => 0, sleep: async () => {} })
    for (const url of ["http://[2606:4700:4700::1111]/", "http://8.8.8.8/", "http://[::ffff:8.8.8.8]/", "https://named.example/"]) {
      expect((await web.read(url)).title).toBe("Public")
    }
    expect(fetched).toEqual(["http://[2606:4700:4700::1111]/", "http://8.8.8.8/", "http://[::ffff:808:808]/", "https://named.example/"])
  })

  test("privateAddress decides on the bytes", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "100.64.0.1", "172.16.0.1", "192.168.1.1", "0.0.0.0", "224.0.0.1",
      "::", "::1", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::FFFF:A9FE:A9FE", "::ffff:0:7f00:1", "64:ff9b::7f00:1",
      "64:ff9b::10.0.0.1", "64:ff9b:1::1", "::7f00:1", "::127.0.0.1", "2002:7f00:1::", "2002:c0a8:101::1", "2001:0:4136:e378::1",
      "2001:db8::1", "fd00::1", "fc00::1", "fe80::1", "febf::1", "fec0::1", "ff02::1", "100::1", "not-an-address", "1::2::3"]) {
      expect([ip, privateAddress(ip)]).toEqual([ip, true])
    }
    for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8", "64:ff9b::8.8.8.8", "2002:808:808::1", "2a00:1450:4001::200e"]) {
      expect([ip, privateAddress(ip)]).toEqual([ip, false])
    }
  })
})

// 2026-10-17: the address checked was resolved once and the fetch resolved the name again, so a DNS answer that
// changed in between (rebinding) reached loopback. http: now connects to the checked address.
describe("read: DNS rebinding", () => {
  // A rebinding name server: each name answers a public address the first time, 127.0.0.1 every time after.
  function rebinding() {
    const seen = new Map()
    const lookups = []
    const lookup = async (host) => {
      lookups.push(host)
      const n = (seen.get(host) ?? 0) + 1
      seen.set(host, n)
      return [{ address: n === 1 ? "93.184.216.34" : "127.0.0.1" }]
    }
    return { lookup, lookups }
  }

  // A fetch that connects the way the network would: a name is resolved at connect time through the same name
  // server; 127.0.0.1 reaches the real loopback server; the public address answers here (no internet in tests).
  function network(lookup, publicAnswer) {
    const sent = []
    const fetch = async (raw, init) => {
      const url = new URL(String(raw))
      sent.push({ url: url.href, host: init.headers?.host ?? null })
      const host = url.hostname.replace(/^\[|\]$/g, "")
      const address = /^[\d.]+$/.test(host) || host.includes(":") ? host : (await lookup(host))[0].address
      if (address === "127.0.0.1") return globalThis.fetch(`http://127.0.0.1:${url.port}${url.pathname}`, { redirect: "manual" })
      return publicAnswer(url, init)
    }
    return { fetch, sent }
  }

  test("http: the loopback server receives no request; the checked address is fetched with the site's Host", async () => {
    let received = 0
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => (received++, new Response("<title>Owner's machine</title>", { headers: { "content-type": "text/html" } })) })
    try {
      const { lookup, lookups } = rebinding()
      const { fetch, sent } = network(lookup, () => new Response("<html><title>Public page</title><body>hi</body></html>", { headers: { "content-type": "text/html" } }))
      const web = createWeb({}, { fetch, lookup, now: () => 0, sleep: async () => {} })
      const page = await web.read(`http://rebind.example:${server.port}/secret`)
      expect(received).toBe(0)
      expect(page.title).toBe("Public page")
      expect(page.url).toBe(`http://rebind.example:${server.port}/secret`)
      expect(sent).toEqual([{ url: `http://93.184.216.34:${server.port}/secret`, host: `rebind.example:${server.port}` }])
      expect(lookups).toEqual(["rebind.example"]) // resolved once: the check
    } finally {
      server.stop(true)
    }
  })

  test("a redirect hop follows the same rule", async () => {
    let received = 0
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => (received++, new Response("owner")) })
    try {
      const P = server.port
      const { lookup } = rebinding()
      const { fetch, sent } = network(lookup, (url) =>
        url.pathname === "/start"
          ? new Response("", { status: 302, headers: { location: `http://second.example:${P}/next` } })
          : new Response("<html><title>Second</title><body>ok</body></html>", { headers: { "content-type": "text/html" } }))
      const web = createWeb({}, { fetch, lookup, now: () => 0, sleep: async () => {} })
      expect((await web.read(`http://first.example:${P}/start`)).title).toBe("Second")
      expect(received).toBe(0)
      expect(sent).toEqual([
        { url: `http://93.184.216.34:${P}/start`, host: `first.example:${P}` },
        { url: `http://93.184.216.34:${P}/next`, host: `second.example:${P}` },
      ])
    } finally {
      server.stop(true)
    }
  })

  test("https: fetched by name (the certificate check covers a rebinding), no Host override", async () => {
    const { lookup } = rebinding()
    const { fetch, sent } = network(lookup, () => new Response("<title>TLS</title>", { headers: { "content-type": "text/html" } }))
    const web = createWeb({}, { fetch, lookup: async () => [{ address: "93.184.216.34" }], now: () => 0, sleep: async () => {} })
    // the name goes to the network, which resolves it at connect time
    expect((await web.read("https://named.example/")).title).toBe("TLS")
    expect(sent).toEqual([{ url: "https://named.example/", host: null }])
  })
})
