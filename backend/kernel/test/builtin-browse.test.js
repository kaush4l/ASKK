// browse (backend/kernel/builtin/browse.js, 2026-10-18 owner: "not just get but also be able to navigate the web"): a
// tab per holder over the host's web/page and web/search — open, search, click, back, more, find, links, submit — the
// twin, the prompt, and a restored tab fetched again.

import { describe, expect, test } from "bun:test"
import { Browse, BROWSE_PART, builtinKit } from "../index.js"
import { fakeHost } from "./fake-host.js"

const SITE = {
  "https://site.example/": {
    title: "Home",
    text: "Welcome. Read the RoPE notes [1] or the paper list [2].\n[form F1: q (text)]",
    links: [
      { n: 1, text: "RoPE notes", url: "https://site.example/rope" },
      { n: 2, text: "paper list", url: "https://site.example/papers" },
    ],
    forms: [
      { n: "F1", method: "get", action: "https://site.example/find", fields: [{ name: "q", type: "text", value: "" }, { name: "lang", type: "hidden", value: "en" }] },
      { n: "F2", method: "post", action: "https://site.example/login", fields: [{ name: "user", type: "text", value: "" }] },
    ],
  },
  "https://site.example/rope": { title: "RoPE", text: `${"rotary ".repeat(1000)}theta base 10000 end`, links: [{ n: 1, text: "home", url: "https://site.example/" }], forms: [] },
  "https://site.example/papers": { title: "Papers", text: "Gemma 4 [1] Kimi K3 [2]", links: [{ n: 1, text: "Gemma 4", url: "https://site.example/gemma" }, { n: 2, text: "Kimi K3", url: "https://site.example/kimi" }], forms: [] },
}

function setup() {
  const fetched = []
  const host = fakeHost({
    page: (url) => {
      fetched.push(url)
      const u = new URL(url)
      if (u.pathname === "/find") return { url, title: `found ${u.searchParams.get("q")}`, text: `results for ${u.searchParams.get("q")} (${u.searchParams.get("lang")})`, links: [], forms: [] }
      const p = SITE[url]
      if (!p) throw new Error(`HTTP 502 ${u.host} answered 404.`)
      return { url, ...p }
    },
    search: ({ q }) => ({ engine: "duckduckgo", query: q, results: [{ title: "Gemma 4 guide", url: "https://site.example/papers", snippet: "the developer guide", source: "duckduckgo" }] }),
  })
  const browse = new Browse({ clock: () => new Date("2026-10-18T16:00:00Z") })
  const ctx = (name = "lead") => ({ host, agent: { name } })
  return { browse, ctx, fetched, host }
}

describe("browse", () => {
  test("open: the page's text with its links and forms; the twin a tab", async () => {
    const { browse, ctx } = setup()
    const out = await browse.open({ url: "https://site.example/" }, ctx())
    expect(out).toContain("Home — https://site.example/")
    expect(out).toContain("RoPE notes [1]")
    expect(out).toContain("2 links: browse.click {link: n}")
    expect(out).toContain("F2 (POST: never sent)")
    expect(browse.state.tabs).toEqual([{ agent: "lead", url: "https://site.example/", title: "Home", part: 1, parts: 1, links: 2, forms: 2, at: "2026-10-18T16:00:00.000Z", history: [] }])
    expect(browse.state.visits[0]).toMatchObject({ agent: "lead", how: "open", url: "https://site.example/" })
    expect(browse.brief()).toBe("lead on site.example")
  })

  test("open refuses anything but http(s)", async () => {
    const { browse, ctx } = setup()
    await expect(browse.open({ url: "file:///etc/passwd" }, ctx())).rejects.toThrow("public http(s)")
  })

  test("click by number or words, back from memory, the history in the twin", async () => {
    const { browse, ctx, fetched } = setup()
    await browse.open({ url: "https://site.example/" }, ctx())
    expect(await browse.click({ link: "[2]" }, ctx())).toContain("Papers — https://site.example/papers")
    expect(await browse.click({ link: "kimi" }, ctx()).catch((e) => e.message)).toContain("site.example answered 404")
    expect(await browse.click({ link: 9 }, ctx()).catch((e) => e.message)).toContain("no link [9]")
    expect(browse.state.tabs[0].history.map((h) => h.url)).toEqual(["https://site.example/"])
    const n = fetched.length
    expect(await browse.back({}, ctx())).toContain("Home — https://site.example/")
    expect(fetched.length).toBe(n) // from memory
    expect(browse.state.tabs[0].history).toEqual([])
    await expect(browse.back({}, ctx())).rejects.toThrow("nothing to go back to")
  })

  test("words matching several links equally ask for a number", async () => {
    const { browse, ctx } = setup()
    await browse.open({ url: "https://site.example/papers" }, ctx())
    expect(await browse.click({ link: "k3 gemma" }, ctx()).catch((e) => e.message)).toContain("pick one by number")
  })

  test("more reads the page in parts; find searches it whole", async () => {
    const { browse, ctx } = setup()
    const first = await browse.open({ url: "https://site.example/rope" }, ctx())
    const parts = Math.ceil(SITE["https://site.example/rope"].text.length / BROWSE_PART)
    expect(first).toContain(`part 1/${parts}`)
    expect(first).not.toContain("theta base")
    const second = await browse.more({}, ctx())
    expect(second).toContain(`part 2/${parts}`)
    expect(second).toContain("theta base 10000")
    expect(browse.state.tabs[0].part).toBe(2)
    expect(await browse.more({}, ctx())).toContain("that was all of it")
    expect(await browse.find({ text: "theta" }, ctx())).toContain("theta base 10000")
  })

  test("search makes a results page whose results click follows", async () => {
    const { browse, ctx } = setup()
    const out = await browse.search({ q: "gemma 4 architecture" }, ctx())
    expect(out).toContain("Gemma 4 guide [1] — site.example")
    expect(browse.state.tabs[0].url).toBe("search:web:gemma 4 architecture")
    expect(await browse.click({ link: 1 }, ctx())).toContain("Papers")
    expect(await browse.back({}, ctx())).toContain("gemma 4 architecture — search (duckduckgo)")
  })

  test("submit: a GET form with its hidden fields; a POST form or an unknown field refused", async () => {
    const { browse, ctx, fetched } = setup()
    await browse.open({ url: "https://site.example/" }, ctx())
    expect(await browse.submit({ form: "F1", fields: { q: "rope scaling" } }, ctx())).toContain("results for rope scaling (en)")
    expect(fetched.at(-1)).toBe("https://site.example/find?q=rope+scaling&lang=en")
    await browse.back({}, ctx())
    await expect(browse.submit({ form: "F2", fields: { user: "x" } }, ctx())).rejects.toThrow("POST form: never sent")
    await expect(browse.submit({ form: "1", fields: { nope: 1 } }, ctx())).rejects.toThrow("has no field nope")
    expect(await browse.submit({ form: "F1", fields: '{"q":"yarn"}' }, ctx())).toContain("results for yarn")
  })

  test("links lists and filters", async () => {
    const { browse, ctx } = setup()
    await browse.open({ url: "https://site.example/" }, ctx())
    expect(await browse.links({}, ctx())).toBe("[1] RoPE notes — https://site.example/rope\n[2] paper list — https://site.example/papers")
    expect(await browse.links({ filter: "paper" }, ctx())).toBe("[2] paper list — https://site.example/papers")
  })

  test("a tab per holder; the prompt shows the holder's own", async () => {
    const { browse, ctx } = setup()
    await browse.open({ url: "https://site.example/" }, ctx("lead"))
    await browse.open({ url: "https://site.example/papers" }, ctx("research"))
    await browse.click({ link: 1 }, ctx("lead"))
    const agent = (name) => ({ name, tools: new Set(["browse.open", "browse.click"]) })
    expect(browse.render(agent("lead"))).toContain("ON: RoPE — https://site.example/rope")
    expect(browse.render(agent("lead"))).toContain("BACK: Home")
    expect(browse.render(agent("lead"))).toContain(": browse.open, browse.click")
    expect(browse.render(agent("research"))).toContain("ON: Papers")
    expect(browse.render(agent("critic"))).toContain("(no page open)")
    expect(browse.state.tabs.map((t) => t.agent).sort()).toEqual(["lead", "research"])
  })

  test("restored: the tab's page is fetched again at its part when read", async () => {
    const a = setup()
    await a.browse.open({ url: "https://site.example/rope" }, a.ctx())
    await a.browse.more({}, a.ctx())
    const b = setup()
    b.browse.restore(JSON.parse(JSON.stringify(a.browse.snapshot())))
    expect(b.browse.render({ name: "lead", tools: new Set() })).toContain("ON: RoPE — https://site.example/rope · part 2/")
    expect(b.fetched).toEqual([])
    expect(await b.browse.find({ text: "theta" }, b.ctx())).toContain("theta base")
    expect(b.fetched).toEqual(["https://site.example/rope"])
  })

  test("the kit: one browse per desk, commands typed dev with view browse", () => {
    const kit = builtinKit({})
    const one = kit.artifacts.browse({ name: "a" }, {})
    expect(kit.artifacts.browse({ name: "b" }, {})).toBe(one)
    const cmds = one.commands()
    expect(cmds.map((t) => t.name)).toEqual(["browse.open", "browse.search", "browse.click", "browse.back", "browse.more", "browse.find", "browse.links", "browse.submit"])
    expect(cmds.every((t) => t.type === "dev" && t.view === "browse")).toBe(true)
    expect(one.twin()).toMatchObject({ id: "browse", kind: "browse", view: "browse", keep: "day", brief: "no pages open", state: { tabs: [], visits: [] } })
  })
})
