// Preview pages (browser.js): real headless pages (Bun.WebView) on local Bun.serve apps; the "desk server" is one
// more Bun.serve whose port no page may show. Screenshots in a temp state folder, removed after.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { agentView, allowedUrl, browserRoutes, createBrowser, enterView, sameDocument } from "./browser.js"

const state = realpathSync(mkdtempSync(join(tmpdir(), "browser-test-")))
let desk // the desk server: never shown
let app // an app the desk built
let browser
const PAGE = (deskPort) => `<!doctype html><html><head><title>Loss dashboard</title></head><body>
<h1>Training</h1><p>val_bpb is <b>1.23</b> after 5 minutes.</p>
<nav><a id="runs" href="/runs">Runs</a> <a id="desk" href="http://127.0.0.1:${deskPort}/">Desk</a></nav>
<button id="go" onclick="document.querySelector('h1').textContent = 'Clicked'; console.warn('clicked')">Train again</button>
<label>Seed <input name="seed" placeholder="seed"></label>
<script>console.log("dashboard up", { runs: 3 }); setTimeout(() => { throw new Error("late failure") }, 300)</script>
</body></html>`

beforeAll(() => {
  desk = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("<title>desk</title>the desk", { headers: { "content-type": "text/html" } }) })
  app = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const path = new URL(req.url).pathname
      if (path === "/away") return Response.redirect(`http://127.0.0.1:${desk.port}/`, 302)
      if (path === "/runs") return new Response("<title>Runs</title><h2>3 runs</h2>", { headers: { "content-type": "text/html" } })
      return new Response(PAGE(desk.port), { headers: { "content-type": "text/html" } })
    },
  })
  browser = createBrowser({ state, blockedPorts: () => [desk.port] })
})
afterAll(() => {
  browser?.closeAll()
  desk?.stop(true)
  app?.stop(true)
  rmSync(state, { recursive: true, force: true })
})

describe("allowedUrl", () => {
  test("this computer's http(s) pages only, never a blocked port", () => {
    expect(allowedUrl("http://localhost:3000/x", [1111])).toEqual({ ok: true, url: "http://localhost:3000/x" })
    expect(allowedUrl("http://[::1]:8080/", [1111]).ok).toBe(true)
    expect(allowedUrl("http://0.0.0.0:8000/", []).url).toBe("http://127.0.0.1:8000/")
    expect(allowedUrl("http://127.0.0.1:1111/", [1111]).ok).toBe(false)
    expect(allowedUrl("http://localhost/", [80]).ok).toBe(false) // the default port counts
    for (const bad of ["https://example.com/", "http://192.168.1.2:3000/", "file:///etc/passwd", "data:text/html,x", "javascript:alert(1)", "http://user:pw@localhost:3000/", "nope"]) expect(allowedUrl(bad, []).ok).toBe(false)
  })
})

describe("H6: open", () => {
  test("the desk's own port and a non-loopback URL are refused", async () => {
    await expect(browser.open({ url: `http://127.0.0.1:${desk.port}/` })).rejects.toMatchObject({ status: 403 })
    await expect(browser.open({ url: `http://localhost:${desk.port}/__askk/whoami` })).rejects.toMatchObject({ status: 403 })
    await expect(browser.open({ url: "https://example.com/" })).rejects.toMatchObject({ status: 403 })
    expect(browser.list().pages).toEqual([])
  })

  test("a loopback page on another port opens with a screenshot; GET browser/shot is the PNG", async () => {
    const { page } = await browser.open({ url: `http://localhost:${app.port}/`, by: "coder", width: 800, height: 600 })
    expect(page).toMatchObject({ status: "open", title: "Loss dashboard", by: "coder", width: 800, height: 600, shot: { n: 1, url: `/__askk/browser/shot?id=${page.id}&n=1` } })
    expect(page.shot.width).toBeGreaterThanOrEqual(800)
    expect(existsSync(join(state, "browser", page.id, "1.png"))).toBe(true)
    const res = await browserRoutes(browser).GET["browser/shot"](new URLSearchParams({ id: page.id, n: "1" }))
    expect(res).toBeInstanceOf(Response)
    expect(res.headers.get("content-type")).toBe("image/png")
    expect(res.headers.get("cache-control")).toContain("immutable")
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    await expect(browser.image("../../etc", "1")).rejects.toMatchObject({ status: 400 })
    await expect(browser.image(page.id, "99")).rejects.toMatchObject({ status: 404 })
    browser.close({ id: page.id })
  })

  // 2026-10-18 owner: the screenshot goes with the agent's next model call.
  test("GET browser/image: the shot for a model — a JPEG at most max px wide, base64; bad ids refused like the PNG", async () => {
    const { page } = await browser.open({ url: `http://localhost:${app.port}/`, by: "coder", width: 800, height: 600 })
    const img = await browserRoutes(browser).GET["browser/image"](new URLSearchParams({ id: page.id, n: "1", max: "400" }))
    expect(img).toMatchObject({ id: page.id, n: 1, media_type: "image/jpeg" })
    expect(img.width).toBeLessThanOrEqual(400)
    expect(img.bytes).toBe(Buffer.from(img.data, "base64").length)
    expect([...Buffer.from(img.data, "base64").subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
    expect((await browser.modelImage(page.id, "")).n).toBe(1) // none given: the latest
    await expect(browser.modelImage("../../etc", "1")).rejects.toMatchObject({ status: 400 })
    await expect(browser.modelImage(page.id, "99")).rejects.toMatchObject({ status: 404 })
    browser.close({ id: page.id })
  })
})

describe("actions", () => {
  let id
  beforeAll(async () => {
    id = (await browser.open({ url: `http://127.0.0.1:${app.port}/` })).page.id
    await Bun.sleep(500) // the late page error
  })

  test("click changes the page and takes a fresh screenshot; eval reads it back", async () => {
    const before = browser.list().pages.find((p) => p.id === id).shot.n
    const { page } = await browser.click({ id, selector: "#go" })
    expect(page.shot.n).toBe(before + 1)
    expect((await browser.evaluate({ id, expression: "document.querySelector('h1').textContent" })).value).toBe("Clicked")
    const big = await browser.evaluate({ id, expression: "'x'.repeat(30000)" })
    expect(big.truncated).toBe(true)
    expect(big.value.length).toBeLessThan(20010)
  })

  test("type into a field, text outline (headings, text, links, buttons, inputs)", async () => {
    await browser.type({ id, selector: "input[name=seed]", text: "42" })
    const { url, title, text } = await browser.text({ id })
    expect(url).toBe(`http://127.0.0.1:${app.port}/`)
    expect(title).toBe("Loss dashboard")
    expect(text).toContain("# Clicked")
    expect(text).toContain("val_bpb is 1.23 after 5 minutes.")
    expect(text).toContain("[link] Runs → /runs")
    expect(text).toContain("[button] Train again")
    expect(text).toContain("[input text seed] Seed = 42")
    expect(text).not.toContain("console.log")
  })

  test("console lines and page errors are captured (summary: last 20 and an error count)", async () => {
    const { lines } = browser.console({ id })
    expect(lines.map((l) => [l.level, l.text])).toEqual(expect.arrayContaining([["log", 'dashboard up {"runs":3}'], ["warn", "clicked"], ["error", expect.stringContaining("[page error] Error: late failure")]]))
    expect(browser.list().pages.find((p) => p.id === id).errors).toBeGreaterThanOrEqual(1)
  })

  test("a link inside the allowed pages follows; press and scroll act", async () => {
    const { page } = await browser.click({ id, selector: "#runs" })
    expect(page).toMatchObject({ url: `http://127.0.0.1:${app.port}/runs`, title: "Runs", status: "open" })
    expect((await browser.scroll({ id, dy: 200 })).page.status).toBe("open")
    expect((await browser.press({ id, key: "Tab" })).page.status).toBe("open")
    expect((await browser.navigate({ id, url: `http://127.0.0.1:${app.port}/` })).page.title).toBe("Loss dashboard")
  })

  // 2026-10-18: goto …/model.html#L1:2 on that very page waited for a load that never comes (504).
  test("a goto to another #hash of the same page moves the hash, and the same URL reloads — no 504", async () => {
    const shots = browser.list().pages.find((p) => p.id === id).shot.n
    const r = await browser.navigate({ id, url: `http://127.0.0.1:${app.port}/#L2:attention:2` })
    expect(r.page).toMatchObject({ url: `http://127.0.0.1:${app.port}/#L2:attention:2`, status: "open" })
    expect(r.page.shot.n).toBeGreaterThan(shots)
    expect((await browser.navigate({ id, url: `http://127.0.0.1:${app.port}/#L2:attention:2` })).page.status).toBe("open")
    expect((await browser.navigate({ id, url: `http://127.0.0.1:${app.port}/` })).page.title).toBe("Loss dashboard")
  })

  test("refused: navigating to a blocked URL (the page stays), bad input", async () => {
    await expect(browser.navigate({ id, url: "https://example.com/" })).rejects.toMatchObject({ status: 403 })
    expect(browser.list().pages.find((p) => p.id === id).status).toBe("open")
    await expect(browser.click({ id })).rejects.toMatchObject({ status: 400 })
    await expect(browser.click({ id, selector: "#missing" })).rejects.toMatchObject({ status: 400 }) // after the 10 s action timeout
  }, 15000)
})

describe("H7: leaving the allowed pages closes the page", () => {
  test("a redirect to the desk server's port", async () => {
    const { page } = await browser.open({ url: `http://127.0.0.1:${app.port}/` })
    await expect(browser.navigate({ id: page.id, url: `http://127.0.0.1:${app.port}/away` })).rejects.toMatchObject({ status: 403 })
    expect(browser.list().pages.find((p) => p.id === page.id)).toMatchObject({ status: "closed", reason: expect.stringContaining(`left the allowed pages: http://127.0.0.1:${desk.port}/`) })
    await expect(browser.shot({ id: page.id })).rejects.toMatchObject({ status: 403 })
  })

  test("a link the page follows by itself", async () => {
    const { page } = await browser.open({ url: `http://127.0.0.1:${app.port}/` })
    await browser.click({ id: page.id, selector: "#desk" }).catch(() => {})
    for (let i = 0; i < 40 && browser.list().pages.find((p) => p.id === page.id).status === "open"; i++) await Bun.sleep(50)
    expect(browser.list().pages.find((p) => p.id === page.id)).toMatchObject({ status: "closed", reason: expect.stringContaining("left the allowed pages") })
  })

  test("an open that redirects away is refused and leaves no page open", async () => {
    await expect(browser.open({ url: `http://127.0.0.1:${app.port}/away` })).rejects.toMatchObject({ status: 403 })
    expect(browser.list().pages.filter((p) => p.status === "open").length).toBe(1) // the actions page
  })
})

describe("caps and close", () => {
  test("3 open pages per desk; closeAll closes them and refuses more", async () => {
    const other = createBrowser({ state, blockedPorts: () => [desk.port] })
    const opened = []
    for (let i = 0; i < 3; i++) opened.push((await other.open({ url: `http://127.0.0.1:${app.port}/runs` })).page.id)
    await expect(other.open({ url: `http://127.0.0.1:${app.port}/runs` })).rejects.toMatchObject({ status: 429 })
    other.closeAll()
    expect(other.list().pages.map((p) => [p.status, p.reason])).toEqual(opened.map(() => ["closed", "the desk stopped"]))
    await expect(other.open({ url: `http://127.0.0.1:${app.port}/runs` })).rejects.toMatchObject({ status: 410 })
  }, 20000)
})

test("sameDocument: hash, reload or a real navigation", () => {
  expect(sameDocument("http://127.0.0.1:8090/model.html#L1:2", "http://127.0.0.1:8090/model.html#L2:attention:2")).toBe("hash")
  expect(sameDocument("http://127.0.0.1:8090/model.html#L1:2", "http://127.0.0.1:8090/model.html#L1:2")).toBe("reload")
  expect(sameDocument("http://127.0.0.1:8090/model.html", "http://127.0.0.1:8090/model.html")).toBe("reload")
  expect(sameDocument("http://127.0.0.1:8090/model.html#L1", "http://127.0.0.1:8090/model.html")).toBeNull()
  expect(sameDocument("http://127.0.0.1:8090/model.html", "http://127.0.0.1:8090/model.html?fresh=1#L3")).toBeNull()
  expect(sameDocument("http://127.0.0.1:8090/a", "http://127.0.0.1:8091/a#x")).toBeNull()
  expect(sameDocument("", "http://127.0.0.1:8090/a#x")).toBeNull()
})

// 2026-10-25: a desk with browser: {app: true} sees this app itself — through view/enter, marked, writes refused.
describe("an agent's view of this app", () => {
  let self
  let viewer
  const seen = []
  beforeAll(() => {
    self = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/__askk/view/enter") return enterView(url)
        if (url.pathname === "/__askk/write") {
          seen.push({ method: req.method, agent: agentView(req) })
          return agentView(req) && req.method !== "GET" ? Response.json({ error: "refused" }, { status: 403 }) : Response.json({ ok: true })
        }
        return new Response(`<title>App</title><h1 id="out">idle</h1><button id="w" onclick="fetch('/__askk/write', {method: 'POST'}).then((r) => { document.querySelector('#out').textContent = 'status ' + r.status })">Write</button>`, { headers: { "content-type": "text/html" } })
      },
    })
    viewer = createBrowser({ state, blockedPorts: () => [self.port, desk.port], appPorts: () => [self.port] })
  })
  afterAll(() => {
    viewer?.closeAll()
    self?.stop(true)
  })

  test("the app's port opens marked: a read passes, its own script's POST carries the mark and is refused, eval is refused", async () => {
    const { page } = await viewer.open({ url: `http://127.0.0.1:${self.port}/` })
    expect(page).toMatchObject({ status: "open", app: true, url: `http://127.0.0.1:${self.port}/` })
    await viewer.click({ id: page.id, selector: "#w" })
    await Bun.sleep(300)
    expect((await viewer.text({ id: page.id })).text).toContain("status 403")
    expect(seen.at(-1)).toEqual({ method: "POST", agent: true })
    expect(viewer.evaluate({ id: page.id, expression: "1" })).rejects.toThrow(/agent's view of this app: no eval/)
    // closed: its token is gone — a request with it is no agent's any more
    viewer.close({ id: page.id })
    expect(agentView(new Request("http://x/", { headers: { cookie: "askk_view=nope" } }))).toBe(false)
  })

  test("without appPorts the port stays refused; enter with an unknown token is refused; a recording keeps its shots", async () => {
    expect(browser.open({ url: `http://127.0.0.1:${desk.port}/` })).rejects.toThrow(/desk server's own/)
    expect(enterView(new URL(`http://127.0.0.1:${self.port}/__askk/view/enter?t=forged&to=/`)).status).toBe(403)
    const { page } = await viewer.open({ url: `http://127.0.0.1:${self.port}/` })
    expect(viewer.record({ id: page.id, on: true }).page.recording).toBe(true)
    expect(viewer.record({ id: page.id, on: false }).page.recording).toBeUndefined()
  })
})
