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
  } finally {
    server.stop(true)
  }
})
