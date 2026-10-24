import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadModels } from "../../models/registry.js"
import { createSpeech } from "./index.js"

test("engine openai: an option with a field is sent under that name (Chatterbox's language as lang_code)", async () => {
  const seen = []
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      if (new URL(req.url).pathname.endsWith("/models")) return Response.json({ data: [] })
      seen.push(await req.json())
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/wav" } })
    },
  })
  try {
    const root = mkdtempSync(join(tmpdir(), "askk-speech-"))
    const models = loadModels({ root })
    mkdirSync(join(root, "tts", "fake"), { recursive: true })
    writeFileSync(
      join(root, "tts", "fake", "model.md"),
      `---\nkind: tts\ntitle: Fake\nengine: openai\nurl: http://127.0.0.1:${server.port}/v1\nmodel: fake-model\noptions:\n  language: {type: choice, choices: [en, fr], default: en, field: lang_code, about: "x"}\n  speed: {type: number, default: 1, about: "y"}\nvalues: {}\n---\n`,
    )
    models.select("tts", "fake")
    const speech = await createSpeech({ models, env: {} })
    const out = await speech.speak({ text: "bonjour" })
    expect(out.model).toBe("fake")
    models.set("tts", "fake", { language: "fr" })
    await speech.speak({ text: "bonjour" })
    expect(seen.map((b) => b.lang_code)).toEqual(["en", "fr"])
    expect(seen[0]).toMatchObject({ model: "fake-model", input: "bonjour", response_format: "wav" })
    expect(seen[0]).not.toHaveProperty("language")
    // Kokoro: the voice's first letter is its language
    mkdirSync(join(root, "tts", "kok"), { recursive: true })
    writeFileSync(join(root, "tts", "kok", "model.md"), `---\nkind: tts\ntitle: Kok\nengine: openai\nurl: http://127.0.0.1:${server.port}/v1\nmodel: kok\nlang_from_voice: true\noptions:\n  voice: {type: choice, choices: [af_heart, bf_emma], default: af_heart, about: "x"}\nvalues: {}\n---\n`)
    models.select("tts", "kok")
    await speech.speak({ text: "hi" })
    await speech.speak({ text: "hi", voice: "bf_emma" })
    expect(seen.slice(-2).map((b) => [b.voice, b.lang_code])).toEqual([["af_heart", "a"], ["bf_emma", "b"]])
  } finally {
    server.stop(true)
  }
})

test("splitScript: paragraphs, a long one cut at sentence ends; joinWavs: one WAV with a pause between", async () => {
  const { splitScript, joinWavs } = await import("./index.js")
  expect(splitScript("One. Two.\n\nThree!")).toEqual(["One. Two.", "Three!"])
  const long = "A sentence that runs on for a while. ".repeat(12).trim()
  const parts = splitScript(long, 120)
  expect(parts.length).toBeGreaterThan(3)
  expect(parts.every((p) => p.length <= 120 && /\.$/.test(p))).toBe(true)
  expect(parts.join(" ")).toBe(long)
  const wav = (samples) => {
    const b = Buffer.alloc(44 + samples * 2)
    b.write("RIFF", 0)
    b.writeUInt32LE(36 + samples * 2, 4)
    b.write("WAVEfmt ", 8)
    b.writeUInt32LE(16, 16)
    b.writeUInt16LE(1, 20)
    b.writeUInt16LE(1, 22)
    b.writeUInt32LE(1000, 24)
    b.writeUInt32LE(2000, 28)
    b.writeUInt16LE(2, 32)
    b.writeUInt16LE(16, 34)
    b.write("data", 36)
    b.writeUInt32LE(samples * 2, 40)
    return b
  }
  const joined = joinWavs([wav(100), wav(50)], 0.5)
  expect(joined.readUInt32LE(40)).toBe((100 + 500 + 50) * 2)
  expect(joined.length).toBe(44 + (100 + 500 + 50) * 2)
})
