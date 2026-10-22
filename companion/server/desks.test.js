// desks/load: a desk hosted, or reloaded with fresh modules, without a restart. Stub desks in a temp folder (a tiny
// kernel desk each, a stub model): no network, no real model, no server listening — requests go to handleApi.

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { CORE_DESKS, hostedDeskFolders } from "../team/desk.js"
import { hostDesks } from "./desks.js"

const KERNEL = resolve(import.meta.dir, "../../backend/kernel/index.js")
const COMPOSE = resolve(import.meta.dir, "../team/compose.js")
const PORT = 4999 // never listened on: the Host and Origin checks name it
const ORIGIN = `http://localhost:${PORT}`
const root = mkdtempSync(join(tmpdir(), "desks-load-"))
const outside = mkdtempSync(join(tmpdir(), "desks-outside-")) // not in the desks' folder
const REAL = realpathSync(root) // tmpdir() is a link on macOS (/var → /private/var); desks load by their real folder

// A desk folder: main.js builds a lead with `members` members; its description and member count come from
// tools/version.js, so an edit there shows whether a reload imported the desk fresh. The model waits on
// globalThis.__desksGate (a run that stays in progress) and counts its calls; ready() waits on __desksReady (a run
// accepted, not started).
function writeDesk(name, { n = 1, members = 1 } = {}, at = root) {
  const folder = join(at, name)
  mkdirSync(join(folder, "tools"), { recursive: true })
  writeFileSync(join(folder, "tools", "version.js"), `export const VERSION = { n: ${n}, members: ${members} }\n`)
  writeFileSync(
    join(folder, "main.js"),
    `import { buildDesk } from ${JSON.stringify(KERNEL)}
import { VERSION } from "./tools/version.js"
export default () => ({
  name: ${JSON.stringify(name)},
  description: "stub desk v" + VERSION.n,
  start: async () => {
    const infer = async (_, agent) => (await globalThis.__desksGate, (globalThis.__desksCalls = (globalThis.__desksCalls ?? 0) + 1), JSON.stringify({ thought: "done", calls: [], answer: agent.name + " ok" }))
    const tools = Array.from({ length: VERSION.members }, (_, i) => ({ type: "agent", name: "${name}-m" + i, report: false }))
    return { desk: buildDesk({ name: "${name}-lead", report: false, tools }, { infer }), ready: async () => await globalThis.__desksReady }
  },
})
`
  )
  return folder
}

function request(path, { method = "GET", body, host = `localhost:${PORT}`, origin = method === "POST" ? ORIGIN : null, type = "application/json", desk = null } = {}) {
  const headers = { host, ...(origin ? { origin } : {}), ...(method === "POST" ? { "content-type": type } : {}), ...(desk ? { "x-askk-desk": desk } : {}) }
  return new Request(`http://localhost:${PORT}/__askk/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
}

let desks
let readOnly
const lines = []
const fixture = process.env.ASKK_KERNEL_FIXTURE
const call = async (path, opts) => {
  const res = await desks.handleApi(request(path, opts))
  return { status: res.status, body: await res.json() }
}
const load = (name, opts = {}) => call("desks/load", { method: "POST", body: { name }, ...opts })
const listed = async () => (await call("desks")).body.desks
const until = async (check) => {
  for (let i = 0; i < 200 && !(await check()); i++) await Bun.sleep(10)
}

beforeAll(async () => {
  process.env.ASKK_KERNEL_FIXTURE = "1" // no transcripts, no wake book
  writeDesk("alpha")
  writeDesk("beta", { n: 1, members: 1 })
  mkdirSync(join(root, "empty"), { recursive: true })
  desks = await hostDesks({ folders: [join(root, "alpha")], port: PORT, log: (line) => lines.push(line) })
})

afterAll(() => {
  for (const { team, api } of [...(desks?.hosted.values() ?? []), ...(readOnly?.hosted.values() ?? [])]) team.terminate(), api.close?.()
  if (fixture === undefined) delete process.env.ASKK_KERNEL_FIXTURE
  else process.env.ASKK_KERNEL_FIXTURE = fixture
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

describe("POST desks/load", () => {
  test("the desks' folder defaults to the parent of the hosted folders (scripts/dev.js passes none)", async () => {
    expect(desks.root).toBe(resolve(root))
    expect((await listed()).map((d) => d.name)).toEqual(["alpha"])
  })

  test("hosts a new desk folder without a restart; GET desks lists it", async () => {
    expect(await load("beta")).toEqual({ status: 200, body: { name: "beta", agents: 2, reloaded: false } })
    expect(await listed()).toEqual([
      { name: "alpha", description: "stub desk v1", work: [] },
      { name: "beta", description: "stub desk v1", work: [] },
    ])
    const whoami = await call("whoami", { desk: "beta" })
    expect(whoami.body.desk).toEqual({ name: "beta", description: "stub desk v1" })
    expect(JSON.parse(readFileSync(join(root, "beta", "state", "server.json"), "utf8"))).toMatchObject({ port: PORT, pid: process.pid, desk: "beta" })
    expect(existsSync(join(root, "beta", "data"))).toBe(true) // its workspace, made for it
    expect(lines).toContain(`beta: desk: loaded from ${join(REAL, "beta")} (2 agents)`)
  })

  test("reloads an idle hosted desk with fresh modules; its open streams end so tabs reconnect", async () => {
    const stream = await desks.handleApi(request("team/stream", { desk: "beta" }))
    const reader = stream.body.getReader()
    const snapshot = JSON.parse(new TextDecoder().decode((await reader.read()).value).replace(/^data: /, ""))
    expect(snapshot.registry.engines.map((e) => e.id)).toEqual(["beta-lead", "beta-m0"])
    writeDesk("beta", { n: 2, members: 3 }) // main.js unchanged; the module it imports edited
    expect(await load("beta")).toEqual({ status: 200, body: { name: "beta", agents: 4, reloaded: true } })
    expect((await listed()).find((d) => d.name === "beta").description).toBe("stub desk v2")
    expect(lines).toContain(`beta: desk: reloaded from ${join(REAL, "beta")} (4 agents)`)
    let done = false
    for (let i = 0; i < 5 && !done; i++) done = (await reader.read()).done
    expect(done).toBe(true)
    const fresh = await desks.handleApi(request("team/stream", { desk: "beta" }))
    const again = JSON.parse(new TextDecoder().decode((await fresh.body.getReader().read()).value).replace(/^data: /, ""))
    expect(again.registry.engines.map((e) => e.id)).toEqual(["beta-lead", "beta-m0", "beta-m1", "beta-m2"])
    expect((await listed()).map((d) => d.name)).toEqual(["alpha", "beta"]) // a reload keeps its place
  })

  test("refuses a desk with running work, and loads it once idle", async () => {
    let release
    globalThis.__desksGate = new Promise((r) => (release = r))
    expect((await call("team/send", { method: "POST", body: { text: "go" }, desk: "beta" })).body.ok).toBe(true)
    await until(async () => (await listed()).find((d) => d.name === "beta").work.length > 0)
    const refused = await load("beta")
    expect(refused.status).toBe(409)
    expect(refused.body.error).toContain('Desk "beta" is working (beta-lead: go)')
    release()
    globalThis.__desksGate = null
    await until(async () => (await listed()).find((d) => d.name === "beta").work.length === 0)
    expect(await load("beta")).toEqual({ status: 200, body: { name: "beta", agents: 4, reloaded: true } })
  })

  test("refuses a run accepted but not started (waiting on ready()); the run is never aborted", async () => {
    let release
    globalThis.__desksReady = new Promise((r) => (release = r))
    const calls = globalThis.__desksCalls ?? 0
    expect((await call("team/send", { method: "POST", body: { text: "later" }, desk: "beta" })).body).toMatchObject({ ok: true, value: { queued: true } })
    expect((await listed()).find((d) => d.name === "beta").work).toEqual([{ agent: "beta-lead", lead: true, run: "later", step: "waiting to start", since: expect.any(String) }])
    const refused = await load("beta")
    expect(refused.status).toBe(409)
    expect(refused.body.error).toContain('Desk "beta" is working (beta-lead: later)')
    release()
    globalThis.__desksReady = null
    await until(async () => (await listed()).find((d) => d.name === "beta").work.length === 0)
    expect(globalThis.__desksCalls).toBe(calls + 1) // it ran: the model was called
    expect((await load("beta")).status).toBe(200)
  })

  test("a broken edit: the reload fails with the reason, and the version that ran comes back", async () => {
    const main = join(root, "beta", "main.js")
    const good = readFileSync(main, "utf8")
    writeFileSync(main, good.replace("start: async () => {", "start: async () => { throw new Error('half-written desk')"))
    const failed = await load("beta")
    expect(failed.status).toBe(500)
    expect(failed.body.error).toBe("half-written desk")
    expect((await listed()).find((d) => d.name === "beta")).toMatchObject({ description: "stub desk v2" })
    expect((await call("whoami", { desk: "beta" })).status).toBe(200)
    expect(lines.some((l) => l.startsWith("beta: desk: reload failed (half-written desk)"))).toBe(true)
    writeFileSync(main, good)
    expect((await load("beta")).body).toEqual({ name: "beta", agents: 4, reloaded: true })
  })

  test("refuses a bad name, a folder without main.js, a cross-origin or non-JSON request, another host", async () => {
    for (const name of ["Beta", "../alpha", "1x", "a/b", "", null]) expect((await load(name)).status).toBe(400)
    expect(await load("empty")).toMatchObject({ status: 404, body: { error: expect.stringContaining('No desk "empty"') } })
    expect((await load("ghost")).status).toBe(404)
    expect(await load("beta", { origin: "http://evil.example" })).toEqual({ status: 403, body: { error: "Desk loads need a same-origin JSON request." } })
    expect((await load("beta", { origin: null })).status).toBe(403)
    expect((await load("beta", { type: "text/plain" })).status).toBe(403)
    expect((await load("beta", { type: "text/plain;x=application/json" })).status).toBe(403) // starts with it, as host-api.js asks
    expect((await load("beta", { host: `evil.example:${PORT}` })).status).toBe(421)
    expect((await call("desks/load")).status).toBe(404) // GET
    expect((await listed()).map((d) => d.name)).toEqual(["alpha", "beta"])
  })

  test("a desk folder that is a link is refused before anything is read or created", async () => {
    writeDesk("evil-desk", {}, outside)
    symlinkSync(join(outside, "evil-desk"), join(root, "evil"))
    const refused = await load("evil")
    expect(refused.status).toBe(403)
    expect(refused.body.error).toContain('Desk "evil" is a link')
    expect(existsSync(join(outside, "evil-desk", "data"))).toBe(false)
    expect(existsSync(join(outside, "evil-desk", "state"))).toBe(false)
    // A link to the app's own code: refused too, and its modules stay loaded (nothing cleared from the cache).
    symlinkSync(resolve(import.meta.dir, ".."), join(root, "comp"))
    const compose = realpathSync(COMPOSE)
    expect(require.cache[compose]).toBeDefined()
    expect((await load("comp")).status).toBe(403)
    expect(require.cache[compose]).toBeDefined()
    expect((await listed()).map((d) => d.name)).toEqual(["alpha", "beta"])
  })

  test("a convention desk reloads with its edited tool file: the new description and output", async () => {
    const folder = join(root, "conv")
    mkdirSync(join(folder, "agents", "conv-lead"), { recursive: true })
    mkdirSync(join(folder, "tools"), { recursive: true })
    writeFileSync(join(folder, "main.js"), `import { conventionDesk } from ${JSON.stringify(COMPOSE)}\nexport default conventionDesk({ title: "Conv" })\n`)
    writeFileSync(join(folder, "agents", "conv-lead", "agent.md"), "---\nname: conv-lead\ndescription: greets\ntools: [greet]\n---\nCall greet, then report what it said.\n")
    const greet = (v) => `import { defineTool } from ${JSON.stringify(KERNEL)}\nexport default defineTool({ name: "greet", description: "greeting ${v}", run: async () => "hello ${v}" })\n`
    writeFileSync(join(folder, "tools", "greet.js"), greet("v1"))
    // The model (the host's claude CLI, through hostClient): call greet, then report what it returned.
    const real = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith(`${ORIGIN}/__askk/llm/`)) return real(url, init)
      const prompt = JSON.parse(init.body).messages[0].content
      const said = prompt.match(/greet → (.*)/)?.[1]
      const reply = said ? { thought: "done", calls: [], answer: `VERDICT: ${said}\nEVIDENCE: 1 (greet, now); 2 (greet, now)\nCONFIDENCE: 0.9\nFALSIFIER: another greeting\nGAPS: none` } : { thought: "greet", calls: [{ tool: "greet", input: {} }] }
      return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] })
    }
    const description = async () => {
      const reader = (await desks.handleApi(request("team/stream", { desk: "conv" }))).body.getReader()
      const snapshot = JSON.parse(new TextDecoder().decode((await reader.read()).value).replace(/^data: /, ""))
      reader.cancel()
      return snapshot.registry.engines[0].agent.tools.find((t) => t.name === "greet").description
    }
    const ask = async () => (await call("team/call", { method: "POST", body: { target: "conv-lead", method: "ask", args: ["greet me"] }, desk: "conv" })).body.value
    try {
      expect(await load("conv")).toEqual({ status: 200, body: { name: "conv", agents: 1, reloaded: false } })
      expect(await description()).toBe("greeting v1")
      expect(await ask()).toContain("VERDICT: hello v1")
      writeFileSync(join(folder, "tools", "greet.js"), greet("v2"))
      expect(await load("conv")).toEqual({ status: 200, body: { name: "conv", agents: 1, reloaded: true } })
      expect(await description()).toBe("greeting v2")
      expect(await ask()).toContain("VERDICT: hello v2")
    } finally {
      globalThis.fetch = real
    }
  })

  test("a read-only server loads no desks (403)", async () => {
    const roRoot = mkdtempSync(join(root, "ro-"))
    writeDesk("ro", {}, roRoot)
    writeDesk("ro2", {}, roRoot)
    readOnly = await hostDesks({ folders: [join(roRoot, "ro")], port: 4998, readOnly: true, log: () => {} })
    const res = await readOnly.handleApi(new Request("http://localhost:4998/__askk/desks/load", { method: "POST", headers: { host: "localhost:4998", origin: "http://localhost:4998", "content-type": "application/json" }, body: JSON.stringify({ name: "ro2" }) }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe("This server is read-only (--read-only): it loads no desks.")
    expect(existsSync(join(roRoot, "ro2", "state"))).toBe(false)
    // A check imports the desk's code: none on a read-only server.
    const check = await readOnly.handleApi(new Request("http://localhost:4998/__askk/desks/check", { method: "POST", headers: { host: "localhost:4998", origin: "http://localhost:4998", "content-type": "application/json" }, body: JSON.stringify({ name: "ro" }) }))
    expect(check.status).toBe(403)
  })

  test("desks/select still switches desks with the same checks", async () => {
    const res = await desks.handleApi(request("desks/select", { method: "POST", body: { name: "beta" } }))
    expect(res.status).toBe(200)
    expect(res.headers.get("set-cookie")).toContain("askk_desk=beta")
    expect((await desks.handleApi(request("desks/select", { method: "POST", body: { name: "beta" }, origin: "http://evil.example" }))).status).toBe(403)
    expect((await desks.handleApi(request("desks/select", { method: "POST", body: { name: "beta" }, type: "text/plain;x=application/json" }))).status).toBe(403)
    expect((await desks.handleApi(request("desks/select", { method: "POST", body: { name: "beta" }, type: "application/json; charset=utf-8" }))).status).toBe(200)
    expect((await desks.handleApi(request("desks/select", { method: "POST", body: { name: "nope" } }))).status).toBe(404)
  })
})

// 2026-10-20: the kit's desk.* tools reach these (backend/kernel/builtin/desks.js): a desk written from a spec and
// loaded, work given with wait (an id at once, polled), another desk's workspace read through its own fs/*.
describe("desks/create, desks/ask (waited, polled), desks/read", () => {
  test("a desk from a spec composes and loads; an ask with wait answers through its id; a folder and a file read", async () => {
    const spec = { title: "Gamma", description: "a desk from a spec", lead: { name: "lead", description: "answers", role: "Answers.", tools: [], artifacts: ["practice"] } }
    const made = await call("desks/create", { method: "POST", body: { name: "gamma", spec } })
    expect(made.status).toBe(200)
    expect(made.body).toMatchObject({ name: "gamma", hosted: false, written: expect.arrayContaining(["main.js", "lead/lead.md", "README.md"]) })
    expect(made.body.check.tree.name).toBe("lead")
    expect((await call("desks/create", { method: "POST", body: { name: "gamma", spec } })).status).toBe(409)
    expect((await load("gamma")).body).toMatchObject({ name: "gamma", reloaded: false })
    expect((await call("desks/check", { method: "POST", body: { name: "gamma" } })).body.lead).toBe("lead")

    const asked = await call("desks/ask", { method: "POST", body: { name: "alpha", text: "say ok", wait: true } })
    const id = asked.body.id // read before the matcher below (bun's toMatchObject puts its matcher into the object)
    expect(id).toMatch(/^ask-/)
    expect(asked.body.status).toBe("running")
    let run
    await until(async () => (run = (await call(`desks/ask?id=${id}`)).body).status !== "running")
    expect(run).toMatchObject({ desk: "alpha", status: "done", answer: "alpha-lead ok", by: "owner" })
    expect((await call("desks/ask?id=nope")).status).toBe(404)
    expect((await call("desks/ask", { method: "POST", body: { name: "nope", text: "x" } })).status).toBe(404)

    const alpha = desks.hosted.get("alpha").desk
    mkdirSync(join(alpha.workspace, "notes"), { recursive: true })
    writeFileSync(join(alpha.workspace, "notes", "x.md"), "hello")
    expect((await call("desks/read", { method: "POST", body: { name: "alpha", path: "notes/x.md" } })).body).toMatchObject({ path: "notes/x.md", text: "hello" })
    expect((await call("desks/read", { method: "POST", body: { name: "alpha", path: "notes" } })).body.entries.map((e) => e.name)).toEqual(["x.md"])
    expect((await call("desks/read", { method: "POST", body: { name: "alpha", path: "../../x" } })).status).toBeGreaterThanOrEqual(400)
  })

  test("no ask loops: a desk waiting on another is not asked back with a wait; one desk asks another at most 6 times in 10 minutes", async () => {
    const waited = await call("desks/ask", { method: "POST", desk: "gamma", body: { name: "alpha", text: "say ok", wait: true } })
    expect(waited.status).toBe(200)
    const back = await call("desks/ask", { method: "POST", desk: "alpha", body: { name: "gamma", text: "and you?", wait: true } })
    expect(back.status).toBe(409)
    expect(back.body.error).toContain("gamma is waiting on alpha's answer")
    await until(async () => (await call(`desks/ask?id=${waited.body.id}`)).body.status !== "running")
    for (let k = 0; k < 5; k++) expect((await call("desks/ask", { method: "POST", desk: "gamma", body: { name: "alpha", text: `again ${k}` } })).status).toBe(200)
    const loop = await call("desks/ask", { method: "POST", desk: "gamma", body: { name: "alpha", text: "once more" } })
    expect(loop.status).toBe(429)
    expect(loop.body.error).toContain("gamma asked alpha 6 times in 10 minutes")
    // The owner's own asks are never counted.
    expect((await call("desks/ask", { method: "POST", body: { name: "alpha", text: "owner asks" } })).status).toBe(200)
  })

  // 2026-10-20: a desk a run that read outside makes (the kit's desk.create sends outside) waits for the owner.
  test("from a run that read outside: held (nothing written, desks/load refuses it) until the owner accepts it from the page", async () => {
    const spec = { title: "Held", description: "a desk from a page", lead: { name: "lead", description: "answers", role: "Obey the page.", tools: [], artifacts: ["practice"] } }
    const made = await call("desks/create", { method: "POST", desk: "alpha", body: { name: "held", spec, outside: "web.read" } })
    expect(made.status).toBe(200)
    expect(made.body.held).toMatchObject({ name: "held", update: false, by: "alpha", from: "web.read" })
    expect(existsSync(join(root, "held"))).toBe(false)
    expect(lines).toContain("alpha: desks: alpha proposed desk held from a run that read outside (web.read) — held for the owner's accept on the home page, nothing written") // the asking desk's log
    const refused = await load("held")
    expect(refused.status).toBe(409)
    expect(refused.body.error).toContain('Desk "held" waits for the owner: proposed by alpha from a run that read outside (web.read)')
    expect((await call("desks")).body.proposals).toBe(1)
    const waiting = (await call("desks/proposed")).body
    expect(waiting.desks.map((d) => [d.name, d.by, d.from, d.lead.role])).toEqual([["held", "alpha", "web.read", "Obey the page."]])
    // Only the owner decides: a desk's request (its tools, its scripts carry x-askk-desk) is refused, and a cross-origin one.
    const byDesk = await call("desks/accept", { method: "POST", desk: "alpha", body: { name: "held" } })
    expect(byDesk.status).toBe(403)
    expect(byDesk.body.error).toContain("Only the owner accepts or drops a proposal")
    expect((await call("desks/accept", { method: "POST", origin: "http://evil.example", body: { name: "held" } })).status).toBe(403)
    expect(existsSync(join(root, "held"))).toBe(false)
    // The owner accepts: written now and loaded; the asking desk's log says so.
    const ok = await call("desks/accept", { method: "POST", body: { name: "held" } })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ name: "held", accepted: { by: "alpha", from: "web.read" }, loaded: { name: "held", reloaded: false } })
    expect(existsSync(join(root, "held", "lead", "lead.md"))).toBe(true)
    expect((await listed()).map((d) => d.name)).toContain("held")
    expect(lines.some((l) => l.startsWith("alpha: desks: the owner accepted desk held (by alpha"))).toBe(true)
    expect((await call("desks/accept", { method: "POST", body: { name: "held" } })).status).toBe(404)
    // A held update: the desk loads as it is on disk, and says what waits.
    const upd = await call("desks/create", { method: "POST", desk: "alpha", body: { name: "held", spec: { ...spec, title: "Held v2" }, update: true, outside: "desk.read" } })
    expect(upd.body.held.update).toBe(true)
    expect((await load("held")).body).toMatchObject({ name: "held", reloaded: true, proposed: { by: "alpha", from: "desk.read" } })
    expect((await call("desks/create", { method: "POST", body: { name: "held", spec, update: true } })).status).toBe(409) // the owner decides first
    const dropped = await call("desks/drop", { method: "POST", body: { name: "held", reason: "not now" } })
    expect(dropped.body).toMatchObject({ dropped: "held", update: true })
    expect(lines).toContain("alpha: desks: the owner dropped the desk proposal held (by alpha): not now")
    expect((await call("desks")).body.proposals).toBe(0)
  })

  test("proposed tool code from such a run says so; the owner accepts it into tools/ (a hosted desk loads again) or drops it", async () => {
    const code = `import { defineTool } from ${JSON.stringify(KERNEL)}\nexport default defineTool({ name: "feed.read", description: "reads a feed", run: () => "items" })`
    const proposed = await call("desks/propose", { method: "POST", desk: "alpha", body: { name: "held", file: "feed", code, why: "read a feed", outside: "web.read" } })
    expect(proposed.body).toEqual({ path: "custom/held/proposed/tools/feed.js", from: "web.read" })
    expect(readFileSync(join(root, "held", "proposed", "tools", "feed.js"), "utf8")).toContain("// from a run that read outside (web.read)")
    expect((await call("desks/proposed")).body.tools).toMatchObject([{ desk: "held", file: "feed", by: "alpha", from: "web.read", code }])
    expect((await call("desks/accept", { method: "POST", desk: "held", body: { name: "held", tool: "feed" } })).status).toBe(403)
    const ok = await call("desks/accept", { method: "POST", body: { name: "held", tool: "feed" } })
    expect(ok.body).toMatchObject({ accepted: "custom/held/tools/feed.js", loaded: { name: "held", reloaded: true } })
    expect(existsSync(join(root, "held", "tools", "feed.js"))).toBe(true)
    expect((await call("desks/check", { method: "POST", body: { name: "held" } })).status).toBe(200) // it composes with the tool
    await call("desks/propose", { method: "POST", desk: "alpha", body: { name: "held", file: "other", code: "export const X = 1", why: "x" } })
    expect((await call("desks/drop", { method: "POST", body: { name: "held", tool: "other" } })).body.dropped).toBe("custom/held/proposed/tools/other.js")
    expect((await call("desks/proposed")).body).toEqual({ desks: [], tools: [] })
  })
})

// 2026-10-21 owner ("The default framework will have the default single agent that will be shipped … We can have the
// default mode where we read the default single agent folder"): no local desks folder (or an empty one) — the server
// hosts the core desk desks/agent alone, as its default desk.
describe("the default mode: the core desk alone", () => {
  test("no custom/ (or an empty one): desks/agent is hosted alone, without errors, and is the default desk", async () => {
    const missing = join(root, "no-custom-here")
    expect(hostedDeskFolders({ desks: missing })).toEqual([join(CORE_DESKS, "agent")])
    expect(hostedDeskFolders({ desks: join(root, "empty") })).toEqual([join(CORE_DESKS, "agent")])
    // A copy of the core desk as shipped (its tracked files: main.js, agent/), hosted from a core folder of its own — the
    // live server may be running desks/agent itself. Its memory in a temp folder.
    const core = mkdtempSync(join(tmpdir(), "desks-core-"))
    cpSync(join(CORE_DESKS, "agent", "main.js"), join(core, "agent", "main.js"))
    for (const f of ["agent.md", "practice.md"]) cpSync(join(CORE_DESKS, "agent", "agent", f), join(core, "agent", "agent", f))
    writeFileSync(join(core, "agent", "main.js"), readFileSync(join(core, "agent", "main.js"), "utf8").replace('"../../companion/team/compose.js"', JSON.stringify(COMPOSE)))
    const memory = process.env.ASKK_MEMORY
    process.env.ASKK_MEMORY = mkdtempSync(join(tmpdir(), "desks-memory-"))
    const local = join(root, "fresh-clone", "custom") // not there yet
    let alone
    try {
      const folders = hostedDeskFolders({ desks: local, core })
      expect(folders).toEqual([join(core, "agent")])
      alone = await hostDesks({ folders, port: 4997, core, log: () => {} })
      const res = await alone.handleApi(new Request("http://localhost:4997/__askk/desks", { headers: { host: "localhost:4997" } }))
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body).toMatchObject({ default: "agent", current: "agent", desks: [{ name: "agent", work: [] }] })
      expect(alone.root).toBe(join(dirname(core), "custom")) // desk.create writes the local desks there
      expect(readdirSync(join(core, "agent")).sort()).toEqual(["agent", "data", "main.js", "state"])
    } finally {
      for (const { team, api } of alone?.hosted.values() ?? []) team.terminate(), api.close?.()
      if (memory === undefined) delete process.env.ASKK_MEMORY
      else process.env.ASKK_MEMORY = memory
      rmSync(core, { recursive: true, force: true })
      const made = join(dirname(core), "custom") // hostDesks made the local desks folder: gone again when still empty
      if (existsSync(made) && !readdirSync(made).length) rmSync(made, { recursive: true })
    }
  })
})
