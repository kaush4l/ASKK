// The hosted version's desk in a tab (backend/browser, 2026-10-20): one agent on the kernel with the browser's kit,
// served with the desk server's protocol, kept in the browser store — tested over a memory store, a scripted model and a
// fake fetch.

import { describe, expect, test } from "bun:test"

import { buildBrowserDesk, browserInfer, LEAD } from "./desk.js"
import { browserHost, cleanWorkspacePath, privateHost } from "./host.js"
import { baseUrlProblem, fetchModels, PRESETS, readConnection, saveConnection } from "./settings.js"
import { memoryStore } from "./storage.js"
import { createBrowserTeam } from "./team.js"

const reply = (thought, calls = [], answer) => JSON.stringify(answer == null ? { thought, calls } : { thought, calls, answer })
const REPORT = "VERDICT: done\nEVIDENCE: notes/a.md (files.write)\nCONFIDENCE: 0.8\nFALSIFIER: the file is missing\nGAPS: none"

function fakeFetch(routes) {
  const calls = []
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    for (const [match, body] of routes) if (String(url).includes(match)) return typeof body === "function" ? body(url, init) : new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
    throw new TypeError("Failed to fetch")
  }
  f.calls = calls
  return f
}

describe("browserHost", () => {
  test("fs: write, read, list, revision checks; paths cleaned; .env never", async () => {
    const host = browserHost({ store: memoryStore(), clock: () => 1000 })
    expect(await host.post("fs/write", { path: "notes/a.md", text: "hi" })).toMatchObject({ path: "notes/a.md", size: 2, created: true })
    const read = await host.get("fs/read?path=notes%2Fa.md")
    expect(read).toMatchObject({ path: "notes/a.md", text: "hi", mtime: 1000 })
    await expect(host.post("fs/write", { path: "notes/a.md", text: "x", revision: "nope" })).rejects.toThrow("changed since it was read")
    expect((await host.post("fs/write", { path: "notes/a.md", text: "x", revision: read.revision })).created).toBe(false)
    expect(await host.get("fs/list?path=")).toEqual({ path: "", entries: [{ name: "notes", type: "dir", size: 0, mtime: 0 }] })
    expect((await host.get("fs/list?path=notes")).entries.map((e) => e.name)).toEqual(["a.md"])
    await expect(host.get("fs/read?path=missing.md")).rejects.toMatchObject({ status: 404 })
    expect(() => cleanWorkspacePath("../x")).toThrow('no ".."')
    expect(() => cleanWorkspacePath("a/.env")).toThrow("never written or read here")
    expect(cleanWorkspacePath("/a//./b")).toBe("a/b")
    await expect(host.get("term/list")).rejects.toMatchObject({ status: 501 })
  })

  test("fs: the Files page's tree and delete (a folder needs recursive; a stale revision refused)", async () => {
    const host = browserHost({ store: memoryStore(), clock: () => 1000 })
    await host.post("fs/write", { path: "notes/a.md", text: "a" })
    await host.post("fs/write", { path: "notes/deep/b.md", text: "b" })
    await host.post("fs/write", { path: "top.md", text: "t" })
    expect(await host.get("fs/tree?path=")).toEqual({
      path: "",
      entries: [
        { name: "notes", type: "dir", children: [{ name: "deep", type: "dir", children: [{ name: "b.md", type: "file" }] }, { name: "a.md", type: "file" }] },
        { name: "top.md", type: "file" },
      ],
    })
    await expect(host.post("fs/delete", { path: "top.md", revision: "stale" })).rejects.toMatchObject({ status: 409 })
    expect(await host.post("fs/delete", { path: "top.md" })).toEqual({ path: "top.md", type: "file" })
    await expect(host.post("fs/delete", { path: "notes" })).rejects.toThrow("recursive")
    expect(await host.post("fs/delete", { path: "notes", recursive: true })).toEqual({ path: "notes", type: "dir" })
    expect(await host.get("fs/list?path=")).toEqual({ path: "", entries: [] })
    await expect(host.post("fs/delete", { path: "gone.md" })).rejects.toMatchObject({ status: 404 })
  })

  test("web: search over wikipedia and hn with a note; read a page that allows it; one that does not says so", async () => {
    const fetch = fakeFetch([
      ["prop=extracts", { query: { pages: { 1: { title: "Bun (software)", extract: "Bun is a JavaScript runtime." } } } }],
      ["wikipedia.org/w/api.php", { query: { search: [{ title: "Bun (software)", snippet: "a <b>JavaScript</b> runtime" }] } }],
      ["hn.algolia.com", { hits: [{ title: "Bun 1.4", url: "https://bun.sh/blog", points: 300, created_at: "2026-10-01" }] }],
      ["example.org/page", () => new Response("<html><head><title>Ex</title></head><body><script>var hidden = 1</script><p>Hello page</p></body></html>", { headers: { "content-type": "text/html" } })],
    ])
    const host = browserHost({ store: memoryStore(), fetch })
    const r = await host.get("web/search?q=bun&limit=4&source=web")
    expect(r.engine).toBe("browser")
    expect(r.results.map((x) => x.source)).toEqual(["wikipedia", "hn"])
    expect(r.results[0]).toMatchObject({ title: "Bun (software)", url: "https://en.wikipedia.org/wiki/Bun_(software)", snippet: "a JavaScript runtime" })
    expect(r.note).toContain("no general web search")
    const page = await host.get(`web/read?url=${encodeURIComponent("https://example.org/page")}`)
    expect(page).toMatchObject({ title: "Ex", truncated: false })
    expect(page.text).toContain("Hello page")
    expect(page.text).not.toContain("hidden")
    await expect(host.get(`web/read?url=${encodeURIComponent("https://blocked.example/")}`)).rejects.toThrow("does not let a browser page read it (CORS)")
    // A Wikipedia article (no CORS on its pages): its text through the extracts API.
    expect(await host.get(`web/read?url=${encodeURIComponent("https://en.wikipedia.org/wiki/Bun_(software)")}`)).toEqual({ url: "https://en.wikipedia.org/wiki/Bun_(software)", title: "Bun (software)", text: "Bun is a JavaScript runtime.", truncated: false })
    await expect(host.get("web/search?q=x&source=arxiv")).rejects.toMatchObject({ status: 501 })
  })

  test("web.read: never this computer or the local network, nor a redirect there", async () => {
    for (const h of ["localhost", "127.0.0.1", "10.0.0.8", "192.168.1.1", "172.20.0.1", "169.254.169.254", "router.local", "app.localhost", "[::1]", "0.0.0.0"]) expect(privateHost(new URL(`http://${h}/`).hostname)).toBe(true)
    for (const h of ["example.org", "172.32.0.1", "8.8.8.8"]) expect(privateHost(h)).toBe(false)
    const fetch = fakeFetch([["example.org/moved", () => Object.defineProperty(new Response("<p>admin</p>", { headers: { "content-type": "text/html" } }), "url", { value: "http://192.168.1.1/admin" })]])
    const host = browserHost({ store: memoryStore(), fetch })
    await expect(host.get(`web/read?url=${encodeURIComponent("http://192.168.1.1/admin")}`)).rejects.toMatchObject({ status: 403 })
    expect(fetch.calls).toHaveLength(0)
    await expect(host.get(`web/read?url=${encodeURIComponent("https://example.org/moved")}`)).rejects.toThrow("redirected to a private address")
  })
})

describe("settings", () => {
  test("presets name local servers and keyed ones; a connection is checked and kept", async () => {
    expect(PRESETS.map((p) => p.id)).toEqual(["ollama", "lmstudio", "llamacpp", "openai", "openrouter", "custom"])
    expect(PRESETS.find((p) => p.id === "ollama").base_url).toBe("http://localhost:11434/v1")
    const store = memoryStore()
    expect(readConnection(store)).toBeNull()
    expect(() => saveConnection(store, { base_url: "ftp://x", model: "m" })).toThrow("http or https")
    expect(() => saveConnection(store, { base_url: "http://localhost:11434/v1" })).toThrow("model:")
    expect(saveConnection(store, { base_url: "http://localhost:11434/v1/", model: "llama3.1", preset: "ollama" })).toEqual({ base_url: "http://localhost:11434/v1", api_key: "", model: "llama3.1", preset: "ollama" })
    expect(readConnection(store).model).toBe("llama3.1")
    // Plain http only to this computer or the local network: a key never crosses the internet in clear text.
    expect(baseUrlProblem("http://192.168.1.20:11434/v1")).toBeNull()
    expect(baseUrlProblem("http://models.example.com/v1")).toBe("base URL: https for models.example.com (plain http only on this computer or the local network)")
    expect(() => saveConnection(memoryStore(), { base_url: "http://models.example.com/v1", model: "m" })).toThrow("https for models.example.com")
    // A stored value this version would not save (hand-edited, old) reads as none.
    const odd = memoryStore()
    odd.set("model", { base_url: "not a url", model: "m" })
    expect(readConnection(odd)).toBeNull()
    const original = globalThis.fetch
    globalThis.fetch = fakeFetch([["/v1/models", { data: [{ id: "llama3.1" }, { id: "qwen3" }] }]])
    try {
      expect(await fetchModels(readConnection(store))).toEqual(["llama3.1", "qwen3"])
    } finally {
      globalThis.fetch = original
    }
  })

  test("browserInfer calls the endpoint's /chat/completions with the key, from the tab", async () => {
    const original = globalThis.fetch
    const seen = []
    globalThis.fetch = async (url, init) => {
      seen.push({ url: String(url), auth: init.headers.authorization, body: JSON.parse(init.body) })
      const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: "hello" } }] })}\n\ndata: [DONE]\n\n`
      return new Response(sse, { headers: { "content-type": "text/event-stream" } })
    }
    try {
      const infer = browserInfer({ base_url: "https://api.example.com/v1", api_key: "sk-test", model: "m1" })
      expect(await infer("say hello", { name: "agent", config: {} })).toBe("hello")
      expect(seen[0]).toMatchObject({ url: "https://api.example.com/v1/chat/completions", auth: "Bearer sk-test" })
      expect(seen[0].body.model).toBe("m1")
      await expect(browserInfer(null)("x", { name: "agent" })).rejects.toThrow("no model set")
    } finally {
      globalThis.fetch = original
    }
  })
})

describe("the browser desk", () => {
  test("one lead with the browser's kit; a run spawns a kept helper, writes a file, answers; a new tab picks it all up", async () => {
    const store = memoryStore()
    const script = {
      agent: [
        reply("look", [{ tool: "agent.catalog", input: {} }]),
        reply("a helper", [{ tool: "agent.spawn", input: { name: "scribe", role: "Writes notes from what it is given.", goal: "notes kept", tools: [], artifacts: ["files"], keep: "desk" } }]),
        reply("ask it", [{ tool: "scribe", input: { requirement: "the note is 'hello'", ask: "write notes/a.md", outcome: "the path" } }]),
        reply("tick", [
          { tool: "agent.practice.tick", input: { id: "intent", evidence: "write a note" } },
          { tool: "agent.practice.tick", input: { id: "work", evidence: "notes/a.md (scribe)" } },
          { tool: "agent.practice.tick", input: { id: "deliver", evidence: "the answer names the path" } },
          { tool: "agent.practice.reflect", input: { worked: "the scribe wrote it", missed: "none", changes: "none: the bar held" } },
        ]),
        reply("done", [], REPORT),
      ],
      scribe: [reply("write", [{ tool: "files.write", input: { path: "notes/a.md", content: "hello" } }]), reply("done", [], "VERDICT: notes/a.md written\nEVIDENCE: files.write\nCONFIDENCE: 0.9\nFALSIFIER: no file\nGAPS: none")],
    }
    const infer = async (_prompt, agent) => script[agent.name]?.shift() ?? reply("done", [], REPORT)
    const { desk } = buildBrowserDesk({ store, infer })
    expect(desk.lead.name).toBe(LEAD.name)
    expect([...desk.lead.tools.keys()]).toEqual(expect.arrayContaining(["web.search", "web.read", "agent.spawn", "agent.catalog", "agent.update", "agent.dismiss", "dispatch.start", "files.write", "plan.write", "talk.say", "agent.practice.reflect"]))
    const team = await createBrowserTeam({ desk, store })
    const events = []
    const off = team.subscribe((e) => events.push(e))
    expect(events[0]).toMatchObject({ type: "snapshot", registry: { requiredId: "agent" } })
    expect(Object.keys(events[0].kernel.artifacts)).toEqual(expect.arrayContaining(["agent.practice", "dispatch", "files", "plan", "talk"]))

    const r = await team.call({ target: "agent", method: "ask", args: ["write a note"] })
    expect(r).toEqual({ ok: true, value: REPORT })
    off()
    // The UI saw the run, the helper arrive, its file.
    expect(events.some((e) => e.type === "registry" && e.registry.engines.some((x) => x.id === "scribe"))).toBe(true)
    const rows = events.filter((e) => e.type === "state" && e.id === "agent").flatMap((e) => e.patch.messages?.items ?? [])
    expect(rows.map((m) => m.role)).toContain("tool")
    expect(rows.find((m) => m.action === "answer").content).toBe(REPORT)
    expect(store.get("fs:notes/a.md").text).toBe("hello\n") // files.write ends a file with a newline
    // Kept in the store: the run, the kept helper, the practice.
    await Bun.sleep(450)
    expect(store.get("runs:agent").map((x) => x.answer)).toEqual([REPORT])
    expect(store.get("thread:agent").length).toBeGreaterThan(3)
    expect(store.get("kept")).toEqual([{ by: "agent", at: expect.any(String), input: expect.objectContaining({ name: "scribe", role: "Writes notes from what it is given." }) }])
    expect(store.get("practice:agent")).toContain("## Checklist\n- !intent:")
    team.terminate()

    // A new tab: the helper is back, the earlier run is in the lead's history and thread.
    const again = await createBrowserTeam({ desk: buildBrowserDesk({ store, infer }).desk, store })
    const snap = []
    again.subscribe((e) => snap.push(e))
    expect(snap[0].registry.engines.map((e) => e.id)).toEqual(["agent", "scribe"])
    expect(snap[0].states.agent.messages.some((m) => m.content === REPORT)).toBe(true)
    expect(again.team.lead.history.map((h) => h.answer)).toEqual([REPORT])
    expect(snap[0].log.map((l) => l.text)).toContain("desk: kept helpers back: scribe")
    // A run the tab closed on: the next tab says it was interrupted (the thread never hangs on its request).
    store.set("thread:agent", [...store.get("thread:agent"), { id: "x1", role: "user", kind: "request", content: "a run cut off", at: new Date().toISOString() }])
    const third = await createBrowserTeam({ desk: buildBrowserDesk({ store, infer }).desk, store })
    const s3 = []
    third.subscribe((e) => s3.push(e))
    expect(s3[0].states.agent.messages.at(-1)).toMatchObject({ role: "assistant", action: "answer", error: "interrupted" })
    third.terminate()
    // Owner calls: guide (idle: not delivered), stop, desk calls refused.
    expect((await again.call({ target: "agent", method: "guide", args: ["x"] })).value).toEqual({ delivered: false })
    expect((await again.call({ target: "desk", method: "schedule", args: [] })).ok).toBe(false)
    expect((await again.call({ target: "agent", method: "stop" })).value).toEqual({ stopped: 0 })
    again.terminate()
  })
})
