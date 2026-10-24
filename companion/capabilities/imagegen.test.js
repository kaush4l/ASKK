import { afterEach, beforeEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createImagegen } from "./imagegen.js"
import { loadModels } from "../models/registry.js"

let state
let models
const which = (b) => (b.startsWith("mflux") ? `/bin/${b}` : null)
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "askk-img-"))
  models = loadModels({ root: join(state, "models"), which })
})
afterEach(() => rmSync(state, { recursive: true, force: true }))

// a fake mflux: prints its steps, writes the --output file, exits with `code`
function fakeSpawn({ code = 0, write = true } = {}) {
  const calls = []
  const spawn = (argv) => {
    calls.push(argv)
    const out = argv[argv.indexOf("--output") + 1]
    const steps = Number(argv[argv.indexOf("--steps") + 1])
    const enc = new TextEncoder()
    const stream = (text) => new ReadableStream({ start: (c) => (c.enqueue(enc.encode(text)), c.close()) })
    if (write && code === 0) writeFileSync(out, "png")
    return { stdout: stream(""), stderr: stream(`${steps - 1}/${steps}\n${steps}/${steps}\n${code ? "Error: out of memory" : ""}`), exited: Promise.resolve(code), kill() {} }
  }
  return { spawn, calls }
}
const until = async (f) => {
  for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 5))
}

test("generate: queued, run one at a time with the model's argv, done with its file; img2img from an earlier image", async () => {
  const { spawn, calls } = fakeSpawn()
  const lines = []
  const images = await createImagegen({ state, models, which, spawn, log: (l) => lines.push(l) })
  const { job } = images.generate({ prompt: "a lighthouse", seed: 7, steps: 4, width: 500, by: "artist" })
  expect(job).toMatchObject({ prompt: "a lighthouse", seed: 7, steps: 4, width: 496, height: 1024, by: "artist" })
  await until(() => images.job(job.id).job.status === "done")
  expect(images.job(job.id).job).toMatchObject({ status: "done", step: 4, url: `/__askk/image/file?id=${job.id}` })
  expect(calls[0].slice(0, 3)).toEqual(["/bin/mflux-generate-qwen-2.1", "--model", "qwen-image-2.1"])
  const next = images.generate({ prompt: "warmer", from: job.id, strength: 0.4, steps: 4 }).job
  await until(() => images.job(next.id).job.status === "done")
  expect(calls[1]).toContain("--image-path")
  expect(calls[1][calls[1].indexOf("--image-strength") + 1]).toBe("0.4")
  expect(lines.some((l) => l.includes("done in"))).toBe(true)
  expect(() => images.generate({ prompt: "" })).toThrow("prompt")
  expect(() => images.generate({ prompt: "x", model: "nope" })).toThrow("no image model nope")
  expect(() => images.generate({ prompt: "x", from: job.id, strength: 1.5 })).toThrow("strength")
})

test("a failed run keeps what mflux said; a restart turns running jobs interrupted; no generator → null", async () => {
  const { spawn } = fakeSpawn({ code: 1 })
  const images = await createImagegen({ state, models, which, spawn })
  const { job } = images.generate({ prompt: "x", steps: 2 })
  await until(() => images.job(job.id).job.status === "failed")
  expect(images.job(job.id).job.error).toContain("out of memory")
  const index = join(state, "images", "index.json")
  const saved = JSON.parse(readFileSync(index, "utf8"))
  saved[0].status = "running"
  writeFileSync(index, JSON.stringify(saved))
  const lines = []
  const again = await createImagegen({ state, models, which, spawn, log: (l) => lines.push(l) })
  expect(again.job(job.id).job.status).toBe("interrupted")
  expect(lines[0]).toContain("1 job interrupted")
  writeFileSync(index, "{nope")
  const third = await createImagegen({ state, models, which, spawn, log: (l) => lines.push(l) })
  expect(third.jobs().jobs).toEqual([])
  expect(lines.at(-1)).toContain("unreadable")
  expect(await createImagegen({ state, models, which: () => null })).toBeNull()
  expect(existsSync(join(state, "images"))).toBe(true)
})

test("edit mode: references, a mask the owner uploaded, an object to repaint; a preset shapes the call; what a model lacks is refused", async () => {
  const { spawn, calls } = fakeSpawn()
  const images = await createImagegen({ state, models, which, spawn })
  const first = images.generate({ prompt: "a lighthouse", preset: "cinematic", steps: 4 }).job
  expect(first).toMatchObject({ mode: "generate", preset: "cinematic", width: 1536, height: 864, asked: "a lighthouse" })
  expect(first.prompt).toContain("cinematic film still")
  await until(() => images.job(first.id).job.status === "done")
  // a 1×1 PNG as the owner's mask
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  const { job: mask } = await images.upload({ kind: "mask", data: png, from: first.id, note: "the sky" })
  expect(mask).toMatchObject({ kind: "mask", status: "done", from: first.id, width: 1, url: expect.stringContaining(mask.id) })
  const edit = images.generate({ prompt: "make the sky stormy", from: first.id, mask: mask.id, steps: 4 }).job
  expect(edit).toMatchObject({ mode: "edit", references: [first.id], mask: mask.id })
  await until(() => images.job(edit.id).job.status === "done")
  const argv = calls.at(-1).join(" ")
  expect(argv).toContain("mflux-generate-qwen-2.1-edit")
  expect(argv).toContain(`--image-paths ${join(state, "images", `${first.id}.png`)} --mask-image ${join(state, "images", `${mask.id}.png`)}`)
  const named = images.generate({ prompt: "a blue scarf", references: [first.id], auto_mask: "the scarf", steps: 4 }).job
  expect(named).toMatchObject({ mode: "edit", auto_mask: "the scarf" })
  expect(() => images.generate({ prompt: "x", preset: "nope" })).toThrow("none named nope")
  expect(() => images.generate({ prompt: "x", mask: "img-x-9" })).toThrow("no image job")
  await expect(images.upload({ kind: "mask", data: "bm90IGFuIGltYWdl" })).rejects.toThrow("PNG or JPEG")
  models.add("image", "z-image-turbo")
  expect(() => images.generate({ prompt: "x", model: "z-image-turbo", references: [first.id] })).toThrow("cannot edit")
  expect(images.jobs().model).toMatchObject({ name: "qwen-image-2.1", accepts: expect.arrayContaining(["mask", "references"]) })
})

test("one GPU for the process: a second desk's job waits for the first; a closed desk starts nothing", async () => {
  const gates = []
  const calls = []
  const spawn = (argv) => {
    calls.push(argv)
    const out = argv[argv.indexOf("--output") + 1]
    let open
    const done = new Promise((r) => (open = r))
    gates.push(() => (writeFileSync(out, "png"), open(0)))
    const empty = new ReadableStream({ start: (c) => c.close() })
    return { stdout: empty, stderr: new ReadableStream({ start: (c) => c.close() }), exited: done, kill() {} }
  }
  const other = mkdtempSync(join(tmpdir(), "askk-img-b-"))
  const a = await createImagegen({ state, models, which, spawn })
  const b = await createImagegen({ state: other, models, which, spawn })
  const ja = a.generate({ prompt: "a", steps: 2 }).job
  const jb = b.generate({ prompt: "b", steps: 2 }).job
  await until(() => calls.length === 1)
  await Bun.sleep(20)
  expect(calls).toHaveLength(1) // b waits while a holds the GPU
  expect(b.job(jb.id).job.status).toBe("queued")
  gates[0]()
  await until(() => calls.length === 2)
  expect(a.job(ja.id).job.status).toBe("done")
  gates[1]()
  await until(() => b.job(jb.id).job.status === "done")
  // closed: its queue never starts
  const c = await createImagegen({ state: mkdtempSync(join(tmpdir(), "askk-img-c-")), models, which, spawn })
  c.close()
  c.generate({ prompt: "c", steps: 2 })
  await Bun.sleep(20)
  expect(calls).toHaveLength(2)
  rmSync(other, { recursive: true, force: true })
})

test("a prompt that starts with - is one --flag=value argument, never a flag of its own", async () => {
  const { spawn, calls } = fakeSpawn()
  const images = await createImagegen({ state, models, which, spawn })
  const { job } = images.generate({ prompt: "--output=/etc/x a fox", steps: 2 })
  await until(() => images.job(job.id).job.status === "done")
  expect(calls[0]).toContain("--prompt=--output=/etc/x a fox")
  expect(calls[0].filter((x) => x === "--output")).toHaveLength(1)
})

test("delete: the PNG and its entry gone, with the owner's mask over it; refused while a queued job starts from it", async () => {
  // a spawn that holds each job until released
  const held = []
  const spawn = (argv) => {
    const out = argv[argv.indexOf("--output") + 1]
    let open
    const exited = new Promise((r) => (open = r)).then(() => (writeFileSync(out, "png"), 0))
    held.push(open)
    const empty = () => new ReadableStream({ start: (c) => c.close() })
    return { stdout: empty(), stderr: empty(), exited, kill: () => open() }
  }
  const lines = []
  const images = await createImagegen({ state, models, which, spawn, log: (l) => lines.push(l) })
  const first = images.generate({ prompt: "a lighthouse", steps: 2 }).job
  await until(() => held.length === 1)
  held[0]()
  await until(() => images.job(first.id).job.status === "done")
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  const { job: mask } = await images.upload({ kind: "mask", data: png, from: first.id })
  const edit = images.generate({ prompt: "Add a storm", from: first.id, mask: mask.id, steps: 2 }).job
  expect(() => images.remove({ id: first.id })).toThrow("stop it first")
  expect(() => images.remove({ id: mask.id })).toThrow("stop it first")
  // a running one is stopped, then deleted
  await until(() => images.job(edit.id).job.status === "running")
  expect(images.remove({ id: edit.id })).toEqual({ deleted: [edit.id] })
  expect(images.remove({ id: first.id })).toEqual({ deleted: [first.id, mask.id] })
  expect(images.jobs().jobs).toEqual([])
  await until(() => !existsSync(join(state, "images", `${first.id}.png`)))
  expect(existsSync(join(state, "images", `${first.id}.png`))).toBe(false)
  expect(existsSync(join(state, "images", `${mask.id}.png`))).toBe(false)
  expect(() => images.remove({ id: first.id })).toThrow("no image job")
  expect(lines.some((l) => l.includes(`${first.id}, ${mask.id} deleted`))).toBe(true)
})

test("send: a finished image to the owner's Telegram chat, its message id recorded; no bot or not done → refused", async () => {
  const { spawn } = fakeSpawn()
  const photos = []
  const recorded = []
  const integrations = { get: (n) => (n === "telegram" ? { photo: { send: async (a) => (photos.push(a), { chat: "1", message: 77 }) } } : null) }
  const images = await createImagegen({ state, models, which, spawn, integrations, onSent: (r) => recorded.push(r) })
  const { job } = images.generate({ prompt: "a fox in snow", steps: 2 })
  await expect(images.send({ id: job.id })).rejects.toThrow("not an image yet")
  await until(() => images.job(job.id).job.status === "done")
  const { sent } = await images.send({ id: job.id, by: "artist" })
  expect(sent).toMatchObject({ to: "owner", by: "artist" })
  expect(photos[0]).toMatchObject({ title: job.id, caption: `${job.id} · a fox in snow` })
  expect(recorded).toEqual([{ message: 77, kind: "image", text: `${job.id}: ${job.id} · a fox in snow`, ref: { image: job.id } }])
  expect(images.job(job.id).job.sent).toHaveLength(1)
  const none = await createImagegen({ state, models, which, spawn })
  await expect(none.send({ id: job.id })).rejects.toThrow("no Telegram bot")
})
