import { expect, test } from "bun:test"
import { Studio } from "../builtin/studio.js"

// a fake image host: jobs queue, then finish when the test says
function imageHost() {
  const jobs = []
  let n = 0
  return {
    jobs,
    finish: (status = "done", error = null) => jobs.forEach((j) => j.status === "queued" && Object.assign(j, { status, step: j.steps, ms: 4000, error, url: status === "done" ? `/__askk/image/file?id=${j.id}` : null })),
    async post(path, body) {
      if (path === "image/generate") {
        const edit = !!(body.references?.length || body.mask || body.auto_mask)
        const job = { id: `img-t-${++n}`, prompt: body.preset ? `${body.prompt}, ${body.preset} style` : body.prompt, seed: body.seed ?? 100 + n, width: body.width ?? 1024, height: body.height ?? 1024, steps: body.steps ?? 20, model: "qwen-image-2.1", mode: edit || body.mask ? "edit" : "generate", preset: body.preset ?? null, from: body.from ?? null, references: body.references ?? [], mask: body.mask ?? null, auto_mask: body.auto_mask ?? null, strength: body.from ? (body.strength ?? 0.6) : null, by: body.by, status: "queued", step: 0, at: "2026-10-23T18:00:00.000Z" }
        jobs.push(job)
        return { job }
      }
      if (path === "image/stop") return { job: { ...jobs.find((j) => j.id === body.id), status: "stopped", error: "stopped" } }
      throw new Error(`unexpected ${path}`)
    },
    async get(path) {
      if (path === "image/jobs") return { jobs: jobs.map((j) => ({ ...j })), model: { name: "qwen-image-2.1", title: "Qwen Image 2.1", accepts: ["prompt", "init", "references", "mask", "auto_mask"], modes: ["generate", "edit"], options: {} }, presets: [{ name: "cinematic", title: "Cinematic still", when: "mood", width: 1536, height: 864 }, { name: "photo", title: "Photograph", when: "real" }] }
      if (path.startsWith("image/model?")) return { media_type: "image/jpeg", data: "QUJD" }
      throw new Error(`unexpected ${path}`)
    },
  }
}
const agentOf = (name, host) => ({ name, context: { host, log() {} } })

test("goal → prompt versions → variants → wait → the agent sees them → critique → refine from one → pick", async () => {
  const host = imageHost()
  const studio = new Studio({ waitMs: 1 })
  const artist = agentOf("artist", host)
  studio.attach(artist)
  const ctx = { agent: artist }
  expect(studio.goal({ goal: "a lighthouse at dusk for a book cover", criteria: "- warm window light\n- room for a title at the top" }, ctx)).toContain("2 criteria")
  await expect(studio.generate({}, ctx)).rejects.toThrow("no prompt yet")
  expect(() => studio.prompt({ text: "lighthouse" }, ctx)).toThrow("why")
  studio.prompt({ text: "a basalt lighthouse at dusk, warm windows, empty sky above", why: "the goal: title space" }, ctx)
  expect(() => studio.prompt({ text: "a basalt lighthouse at dusk, warm windows, empty sky above", why: "again" }, ctx)).toThrow("v1 is this prompt already")
  const out = await studio.generate({ seeds: 2, steps: 8 }, ctx)
  expect(out).toContain("queued img-t-1, img-t-2")
  expect(studio.state.images.map((i) => [i.id, i.v, i.status])).toEqual([["img-t-2", 1, "queued"], ["img-t-1", 1, "queued"]])
  expect(studio.gate(artist)).toContain("2 of your images still run")
  setTimeout(() => host.finish(), 5)
  expect(await studio.wait({}, ctx)).toContain("img-t-1: done in 4 s")
  expect(studio.gate(artist)).toBeNull()
  const seen = await studio.images(artist)
  expect(seen.map((s) => s.ref.image)).toEqual(["img-t-2", "img-t-1"])
  expect(seen[0]).toMatchObject({ media_type: "image/jpeg", data: "QUJD", caption: expect.stringContaining("prompt v1") })
  expect(await studio.images(artist)).toEqual([]) // once per image
  expect(() => studio.critique({ image: "img-t-1", scores: { light: 12 }, notes: "x", verdict: "done" }, ctx)).toThrow("0 to 10")
  expect(() => studio.critique({ image: "img-t-1", scores: "light: 6, title space: 4", notes: "sky too busy", verdict: "revise" }, ctx)).toThrow("next")
  expect(studio.critique({ image: "img-t-1", scores: "light: 6, title space: 4", notes: "sky too busy", verdict: "revise", next: "clear sky" }, ctx)).toContain("5/10, revise")
  await studio.generate({ from: "img-t-1", strength: 0.4 }, ctx)
  expect(host.jobs.at(-1)).toMatchObject({ from: "img-t-1", strength: 0.4, prompt: expect.stringContaining("basalt") })
  host.finish("failed", "out of memory")
  await studio.refresh(artist)
  expect(studio.state.images[0]).toMatchObject({ status: "failed", error: "out of memory" })
  studio.pick({ image: "img-t-2", why: "the cleanest sky" }, ctx)
  expect(studio.brief()).toContain("best img-t-1 5/10 · pick img-t-2")
  expect(studio.render()).toContain("DONE MEANS: 1. warm window light  2. room for a title at the top")
  studio.look({ image: "img-t-1" }, ctx)
  expect((await studio.images(artist)).map((s) => s.ref.image)).toEqual(["img-t-1"])
})

test("the owner: goal to the keeper, feedback to the image's maker, generate without an agent; a host that does not answer is said", async () => {
  const host = imageHost()
  const studio = new Studio({ waitMs: 1 })
  studio.attach(agentOf("lead", host))
  const goal = await studio.ownerCall("goal", [{ id: "studio", goal: "a fox in snow", criteria: "sharp eyes" }])
  expect(goal).toMatchObject({ keeper: "lead", deliver: expect.stringContaining("a fox in snow") })
  await studio.ownerCall("generate", [{ id: "studio", prompt: "a red fox in fresh snow" }])
  expect(studio.state.images[0]).toMatchObject({ by: "owner", v: null })
  const artist = agentOf("artist", host)
  await studio.generate({ prompt: "fox, telephoto" }, { agent: artist })
  host.finish()
  await studio.refresh(artist)
  const fb = await studio.ownerCall("feedback", [{ id: "studio", image: "img-t-2", text: "warmer light" }])
  expect(fb).toMatchObject({ keeper: "artist", feedback: { id: "f1", image: "img-t-2" }, deliver: expect.stringContaining('from: "img-t-2"') })
  expect((await studio.ownerCall("feedback", [{ id: "studio", image: "img-t-1", text: "ok" }])).keeper).toBe("lead") // the owner's own image
  await expect(studio.ownerCall("dance", [{}])).rejects.toThrow("not dance")
  await studio.generate({ prompt: "again" }, { agent: artist })
  const down = { ...host, get: async () => Promise.reject(new Error("host down")) }
  await studio.refresh(agentOf("artist", down))
  expect(studio.state.images[0].error).toBe("image host not read: host down")
  const snap = JSON.parse(JSON.stringify(studio.snapshot()))
  const back = new Studio()
  back.restore(snap)
  expect(back.state.images.length).toBe(3)
  expect(back.state.feedback.map((f) => f.id)).toEqual(["f1", "f2"])
})

test("the model and presets come from the host; a preset in use shapes every generate; the owner's marks and mask reach the maker", async () => {
  const host = imageHost()
  const studio = new Studio({ waitMs: 1 })
  const artist = agentOf("artist", host)
  studio.attach(artist)
  const ctx = { agent: artist }
  await studio.refresh(artist)
  expect(studio.state.model.title).toBe("Qwen Image 2.1")
  expect(studio.state.model.accepts).toContain("mask")
  expect(studio.state.presets.map((p) => p.name)).toEqual(["cinematic", "photo"])
  expect(studio.presets()).toContain("- cinematic: Cinematic still (1536×864) — mood")
  expect(() => studio.preset({ name: "poster", why: "x" }, ctx)).toThrow("one of cinematic, photo")
  expect(() => studio.preset({ name: "cinematic" }, ctx)).toThrow("why")
  studio.preset({ name: "cinematic", why: "drama fits the goal" }, ctx)
  studio.prompt({ text: "a lighthouse", why: "goal" }, ctx)
  expect(await studio.generate({}, ctx)).toContain("preset cinematic")
  expect(studio.state.images[0]).toMatchObject({ preset: "cinematic", sent: "a lighthouse, cinematic style" })
  await studio.generate({ preset: "none" }, ctx)
  expect(studio.state.images[0].preset).toBe(null)
  expect(studio.render()).toContain("PRESET: cinematic (drama fits the goal)")
  host.finish()
  await studio.refresh(artist)
  const target = studio.state.images[1].id
  const out = await studio.ownerCall("feedback", [{ id: "studio", image: target, text: "fix these", marks: [{ x: 0.7, y: 0.05, w: 0.25, h: 0.2, note: "moon too big" }], marked: "img-up-1", mask: "img-up-2" }])
  expect(out.keeper).toBe("artist")
  expect(out.deliver).toContain("mark 1 (top-right")
  expect(out.deliver).toContain(`generate {from: "${target}", mask: "img-up-2"`)
  expect(studio.state.feedback.at(-1)).toMatchObject({ marks: [{ n: 1, note: "moon too big" }], marked: "img-up-1", mask: "img-up-2" })
  const seen = await studio.images(artist)
  expect(seen.map((x) => x.ref.image)).toContain("img-up-1")
  expect(seen.find((x) => x.ref.image === "img-up-1").caption).toContain("the owner's marks")
  await studio.generate({ from: target, mask: "img-up-2", prompt: "a smaller moon" }, ctx)
  expect(host.jobs.at(-1)).toMatchObject({ from: target, mask: "img-up-2" })
  studio.state.model = { ...studio.state.model, accepts: ["prompt", "init"] }
  await expect(studio.generate({ from: target, mask: "img-up-2", prompt: "x" }, ctx)).rejects.toThrow("mask: Qwen Image 2.1 does not take it")
})

test("the owner's goal runs the keeper's workflow that takes a preset, with the preset asked", async () => {
  const host = imageHost()
  const studio = new Studio({ waitMs: 1 })
  const calls = []
  const flow = { kind: "workflow", name: "make", cfg: null, state: { config: { vars: { preset: "auto" } } }, ownerCall: async (m, a) => (calls.push([m, a]), { started: true }) }
  const artist = { ...agentOf("artist", host), artifacts: [studio, flow] }
  studio.attach(artist)
  await studio.refresh(artist)
  await expect(studio.ownerCall("goal", [{ id: "studio", goal: "a poster", preset: "poster" }])).rejects.toThrow("preset: one of cinematic, photo")
  const r = await studio.ownerCall("goal", [{ id: "studio", goal: "a fox asleep in snow", criteria: "soft light", preset: "photo" }])
  expect(r).toMatchObject({ workflow: "make", started: true })
  expect(r.deliver).toBeUndefined()
  expect(calls[0]).toEqual(["run", [{ id: "make", request: "a fox asleep in snow\nDone means: soft light", vars: { preset: "photo" } }]])
  // no workflow: the keeper gets the goal with how to choose the preset
  const plain = new Studio()
  plain.attach(agentOf("artist", host))
  expect((await plain.ownerCall("goal", [{ id: "studio", goal: "x" }])).deliver).toContain("none asked")
})

test("the keeper is the holder with every command, the shallowest — never a critic attached first", async () => {
  const host = imageHost()
  const studio = new Studio()
  studio.attach({ ...agentOf("critic", host), depth: 1 }, { commands: ["look", "critique"] })
  expect(studio.keeperName).toBe("critic") // the only holder so far
  studio.attach({ ...agentOf("artist", host), depth: 0 }, { commands: null })
  expect(studio.keeperName).toBe("artist")
  studio.attach({ ...agentOf("helper", host), depth: 2 }, {})
  expect(studio.keeperName).toBe("artist")
  await studio.refresh({ ...agentOf("critic", host), depth: 1 })
  expect(studio.keeperName).toBe("artist") // a refresh never changes it
})

test("scores in any list form a model writes: one-key maps, {name, score}, lines", async () => {
  const host = imageHost()
  const studio = new Studio({ waitMs: 1 })
  const critic = agentOf("critic", host)
  studio.attach(critic)
  studio.prompt({ text: "a cat", why: "goal" }, { agent: critic })
  await studio.generate({}, { agent: critic })
  host.finish()
  await studio.refresh(critic)
  const id = studio.state.images[0].id
  expect(studio.critique({ image: id, scores: [{ light: 9 }, { cat_asleep: 8 }], notes: "warm", verdict: "done" }, { agent: critic })).toContain("8.5/10")
  expect(studio.critique({ image: id, scores: [{ name: "light", score: 6 }, "detail: 8"], notes: "ok", verdict: "revise", next: "x" }, { agent: critic })).toContain("7/10")
  expect(() => studio.critique({ image: id, scores: [], notes: "x", verdict: "done" }, { agent: critic })).toThrow("one per criterion")
})
