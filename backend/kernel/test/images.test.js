// Images with a model call (2026-10-18 owner: "the screenshot will be included along with the next request and the
// agent can iterate over in order to complete a live artifact and I can also observe it"): Agent.collectImages (any
// artifact's images(agent): capped, checked, a failure never the step's), complete's wire bodies (OpenAI image_url
// parts, Anthropic image blocks, each after its caption). The host's chatBlocks: companion/capabilities/local-models.test.js.

import { afterAll, describe, expect, test } from "bun:test"
import { Agent, Artifact, complete } from "../index.js"

const img = (n, extra = {}) => ({ media_type: "image/jpeg", data: btoa(`shot ${n}`), caption: `shot ${n}`, ref: { n }, ...extra })

class Shots extends Artifact {
  constructor(name, make) {
    super({ name })
    this.make = make
  }
  images(agent) {
    return this.make(agent)
  }
}

describe("Agent.collectImages", () => {
  test("every artifact's images, at most 3; a bad media type, too big, or a throwing artifact is left out", async () => {
    const agent = new Agent({ name: "a", report: false }, { infer: async () => '{"answer":"x"}' })
    agent.addArtifact(new Shots("shots", () => [img(1), img(2, { media_type: "text/html" }), img(3, { data: "A".repeat(5_000_000) })]))
    agent.addArtifact(new Shots("broken", () => Promise.reject(new Error("host down"))))
    agent.addArtifact(new Shots("more", () => [img(4), img(5), img(6)]))
    expect((await agent.collectImages()).map((i) => i.ref.n)).toEqual([1, 4, 5])
  })

  test("no artifact with images: infer is called with two arguments, as before", async () => {
    const args = []
    const agent = new Agent({ name: "a", report: false }, { infer: async (...a) => (args.push(a.length), '{"answer":"x"}') })
    await agent.ask("hi")
    expect(args).toEqual([2])
  })
})

describe("complete: images on the wire", () => {
  const bodies = []
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      bodies.push({ path: new URL(req.url).pathname, body: await req.json() })
      const sse = new URL(req.url).pathname.endsWith("/messages")
        ? 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\ndata: {"type":"message_stop"}\n\n'
        : 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'
      return new Response(sse, { headers: { "content-type": "text/event-stream" } })
    },
  })
  afterAll(() => server.stop(true))
  const base = `http://127.0.0.1:${server.port}`

  test("openai: the prompt's text, then each image's caption and its data: URL", async () => {
    const r = await complete({ model: { provider: "openai", base_url: `${base}/v1`, id: "m" }, prompt: "look", images: [img(1)] })
    expect(r.raw).toBe("ok")
    expect(bodies.at(-1).body.messages[0].content).toEqual([
      { type: "text", text: "look" },
      { type: "text", text: "(shot 1)" },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${btoa("shot 1")}` } },
    ])
    await complete({ model: { provider: "openai", base_url: `${base}/v1`, id: "m" }, prompt: "no images" })
    expect(bodies.at(-1).body.messages[0].content).toBe("no images")
  })

  test("anthropic: the prompt's blocks, then each caption and its base64 image block", async () => {
    await complete({ model: { provider: "anthropic", base_url: base, id: "m", api_key: "k" }, prompt: "look", images: [img(2)] })
    expect(bodies.at(-1).body.messages[0].content).toEqual([
      { type: "text", text: "look" },
      { type: "text", text: "(shot 2)" },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: btoa("shot 2") } },
    ])
  })
})
