import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applyPreset, buildArgv, effective, loadModels, splitMd, writeValues } from "./registry.js"

const fresh = () => loadModels({ root: mkdtempSync(join(tmpdir(), "askk-models-")), which: (b) => (b.startsWith("mflux") ? `/bin/${b}` : null) })

describe("models registry", () => {
  test("a new folder is seeded with the defaults and the presets", () => {
    const m = fresh()
    expect(m.list("stt").map((x) => x.name)).toEqual(["apple"])
    expect(m.list("tts").map((x) => x.name)).toEqual(["say"])
    expect(m.list("image").map((x) => x.name)).toEqual(["qwen-image-2.1"])
    expect(m.selected("image").name).toBe("qwen-image-2.1")
    expect(m.presets().map((p) => p.name)).toContain("cinematic")
    expect(m.catalog("stt").find((c) => c.name === "parakeet")).toMatchObject({ added: false, engine: "openai" })
  })

  test("the image model says what it accepts, from its modes", () => {
    const q = fresh().get("image", "qwen-image-2.1")
    expect(q.ok).toBe(true)
    expect(q.modes).toHaveProperty("edit")
    expect(q.accepts).toEqual(expect.arrayContaining(["prompt", "negative", "init", "strength", "references", "mask", "auto_mask"]))
  })

  test("values survive a reload, written into the md, comments kept; a bad one refused", () => {
    const m = fresh()
    const file = m.get("image", "qwen-image-2.1").file
    writeFileSync(file, readFileSync(file, "utf8").replace("kind: image", "kind: image # a note"))
    m.set("image", "qwen-image-2.1", { steps: 28, quantize: "8" })
    const again = loadModels({ root: m.root }).get("image", "qwen-image-2.1")
    expect(again.values).toEqual({ steps: 28, quantize: 8 })
    expect(readFileSync(file, "utf8")).toContain("# a note")
    expect(effective(again).steps).toBe(28)
    expect(() => m.set("image", "qwen-image-2.1", { steps: 500 })).toThrow("at most 80")
    expect(() => m.set("image", "qwen-image-2.1", { nope: 1 })).toThrow("not an option")
    m.set("image", "qwen-image-2.1", { steps: null })
    expect(m.get("image", "qwen-image-2.1").values).toEqual({ quantize: 8 })
  })

  test("the selection is kept in models.md; add from the catalogue", () => {
    const m = fresh()
    m.add("stt", "parakeet")
    m.select("stt", "parakeet")
    expect(loadModels({ root: m.root }).selected("stt").name).toBe("parakeet")
    expect(() => m.add("stt", "parakeet")).toThrow("already")
    expect(splitMd(readFileSync(join(m.root, "models.md"), "utf8")).meta.stt).toBe("parakeet")
  })

  test("argv: inputs present become flags, options with a flag follow, defaults fill", () => {
    const m = fresh()
    m.set("image", "qwen-image-2.1", { quantize: "8", low_ram: true })
    const q = m.get("image", "qwen-image-2.1")
    const argv = buildArgv(q, "generate", { prompt: "a fox", seed: 7, out: "/x/a.png" }, { which: (b) => `/bin/${b}` })
    expect(argv.slice(0, 3)).toEqual(["/bin/mflux-generate-qwen-2.1", "--model", "qwen-image-2.1"])
    expect(argv).toEqual(expect.arrayContaining(["--prompt", "a fox", "--seed", "7", "--width", "1024", "--steps", "20", "--quantize", "8", "--low-ram"]))
    expect(argv).not.toContain("--image-path")
    const edit = buildArgv(q, "edit", { prompt: "make it night", references: ["/a.png", "/b.png"], mask: "/m.png", out: "/o.png" }, { which: (b) => `/bin/${b}` })
    expect(edit.join(" ")).toContain("--image-paths /a.png /b.png --mask-image /m.png")
    expect(() => buildArgv(q, "upscale", {}, { which: () => "/bin/x" })).toThrow("no upscale mode")
    expect(() => buildArgv(q, "generate", { prompt: "x" }, { which: () => null })).toThrow("not installed")
  })

  test("a preset wraps the prompt, fills what the call leaves out, joins negatives", () => {
    const cinematic = fresh().preset("cinematic")
    const out = applyPreset(cinematic, { prompt: "a lighthouse", negative: "text", steps: 30 })
    expect(out.prompt.startsWith("a lighthouse, cinematic film still")).toBe(true)
    expect(out).toMatchObject({ width: 1536, height: 864, steps: 30, preset: "cinematic" })
    expect(out.negative).toBe("text, flat lighting, snapshot, cartoon")
    expect(() => fresh().preset("nope")).toThrow("none named nope")
  })

  test("a broken model.md is listed with its problem, never thrown", () => {
    const m = fresh()
    writeFileSync(m.get("tts", "say").file, "---\nengine: banana\n---\n")
    expect(m.list("tts")[0]).toMatchObject({ ok: false, problem: expect.stringContaining("engine") })
    expect(m.selected("tts")).toBe(null)
  })

  test("writeValues adds the block when there is none and replaces it when there is", () => {
    const once = writeValues("---\nkind: tts\nvalues:\n  rate: 100\n---\n# body\n", { rate: 200, voice: "Ava" })
    expect(once).toBe('---\nkind: tts\nvalues:\n  rate: 200\n  voice: "Ava"\n---\n# body\n')
    expect(writeValues(once, {})).toBe("---\nkind: tts\nvalues: {}\n---\n# body\n")
  })
})

describe("model servers", () => {
  test("started when nothing answers, reused while it answers, started again after it dies; install lines are argv", async () => {
    const { ensureServer, installArgv } = await import("./index.js")
    const dir = mkdtempSync(join(tmpdir(), "askk-serve-"))
    const port = 20000 + Math.floor(Math.random() * 20000)
    const bin = join(dir, "fake-server")
    writeFileSync(bin, `#!/usr/bin/env bun\nBun.serve({ port: ${port}, fetch: () => Response.json({ data: [] }) })\n`)
    ;(await import("node:fs")).chmodSync(bin, 0o755)
    const model = { kind: "tts", name: "fake", title: "Fake", meta: { url: `http://127.0.0.1:${port}/v1`, serve: { bin, args: [] } } }
    const lines = []
    expect(await ensureServer(model, { log: (l) => lines.push(l), waitMs: 15000 })).toBe(model.meta.url)
    expect(await ensureServer(model, { log: (l) => lines.push(l) })).toBe(model.meta.url)
    expect(lines.filter((l) => l.includes("starting"))).toHaveLength(1)
    Bun.spawnSync(["pkill", "-f", bin])
    for (let i = 0; i < 40 && Bun.spawnSync(["pgrep", "-f", bin]).exitCode === 0; i++) await Bun.sleep(50)
    await Bun.sleep(100) // its exit reaped
    expect(await ensureServer(model, { log: (l) => lines.push(l), waitMs: 15000 })).toBe(model.meta.url)
    expect(lines.some((l) => l.includes("exited"))).toBe(true)
    Bun.spawnSync(["pkill", "-f", bin])
    await expect(ensureServer({ ...model, meta: { url: "http://127.0.0.1:1/v1" } })).rejects.toThrow("nothing answers")
    expect(installArgv('uv tool install "mlx-audio[stt]" --with "spacy>=3.8,<4"')).toEqual(["uv", "tool", "install", "mlx-audio[stt]", "--with", "spacy>=3.8,<4"])
    expect(() => installArgv("curl x | sh")).toThrow("only")
    expect(() => installArgv("uv run python -c 1")).toThrow("only")
    expect(() => installArgv("uv tool install x; rm -rf ~")).toThrow("no shell characters")
  }, 40000)
})
