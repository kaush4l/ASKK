import { describe, expect, test } from 'bun:test'
import { OpenAiInference } from '@/core/inference/openai'
import { ScriptedInference } from '@/core/inference/scripted'
import { inferenceFor } from '@/core/inference/catalog'
import { stubPorts } from '@/core/ports'
import type { InferenceConfig } from '@/core/inference/base'
import type { FetchPort } from '@/core/ports'

/**
 * The HTTP transport against a `FetchPort` that emits a **genuine chunked**
 * `ReadableStream` — one enqueue per wire chunk, decoded by the transport as
 * it lands. `tests/inference-http-live.test.ts` is the same transport against
 * a real endpoint; this file is what runs on a machine that has none.
 *
 * The load-bearing case is `deltas arrive before the stream is finished`: the
 * fake refuses to produce its second chunk until the first delta has already
 * fired. A transport that buffered the whole body and chopped it up afterwards
 * would never fire that delta, so the stream would never close and the case
 * would hang rather than pass. That is the assertion 2.2's lesson demands —
 * `deltas.join('') === text` stays green when streaming collapses to one chunk.
 */

const CONFIG: InferenceConfig = {
  model: 'test-model',
  baseUrl: 'http://127.0.0.1:8873/v1',
  apiKey: 'none',
  temperature: 0.7,
  maxTokens: 4096,
}

const ENCODER = new TextEncoder()

/** One `data:` frame, terminated the way an SSE server terminates it. */
function frame(payload: string): string {
  return `data: ${payload}\n\n`
}

/** A content delta frame, in the shape the measured omlx endpoint sends. */
function contentFrame(text: string): string {
  return frame(JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] }))
}

/** A `FetchPort` that replays byte chunks, in order, as a real streaming `Response`. */
function streamingFetch(chunks: readonly (string | Uint8Array)[], init?: ResponseInit): {
  port: FetchPort
  calls: { url: string; init?: RequestInit }[]
} {
  const calls: { url: string; init?: RequestInit }[] = []
  const port: FetchPort = async (url, requestInit) => {
    calls.push({ url, init: requestInit })
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(typeof chunk === 'string' ? ENCODER.encode(chunk) : chunk)
        }
        controller.close()
      },
    })
    return new Response(body, init)
  }
  return { port, calls }
}

describe('the HTTP transport streams', () => {
  test('more than one delta arrives, and the deltas are the reply', async () => {
    const { port } = streamingFetch([
      contentFrame('one '),
      contentFrame('two '),
      contentFrame('three'),
      frame(JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })),
      frame(JSON.stringify({ choices: [], usage: { prompt_tokens: 22, completion_tokens: 3 } })),
      frame('[DONE]'),
    ])
    const deltas: string[] = []
    const result = await new OpenAiInference(CONFIG, port).infer({ prompt: 'count' }, (c) => void deltas.push(c))

    expect(deltas.length).toBeGreaterThan(1)
    expect(deltas).toEqual(['one ', 'two ', 'three'])
    expect(deltas.join('')).toBe(result.text)
    expect(result.text).toBe('one two three')
    expect(result.stopReason).toBe('stop')
    expect(result.usage).toEqual({ promptTokens: 22, completionTokens: 3 })
  })

  test('deltas arrive before the stream is finished, not after', async () => {
    let released = false
    let release: () => void = () => {}
    const firstDelta = new Promise<void>((resolve) => {
      release = () => {
        released = true
        resolve()
      }
    })
    const port: FetchPort = async () => {
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(ENCODER.encode(contentFrame('first ')))
          // The second chunk does not exist until the first delta has fired.
          // A buffering transport never gets one, and this case hangs red.
          await firstDelta
          controller.enqueue(ENCODER.encode(contentFrame('second')))
          controller.enqueue(ENCODER.encode(frame('[DONE]')))
          controller.close()
        },
      })
      return new Response(body)
    }

    const seen: string[] = []
    const result = await new OpenAiInference(CONFIG, port).infer({ prompt: 'go' }, (chunk) => {
      seen.push(chunk)
      if (seen.length === 1) release()
    })

    expect(released).toBe(true)
    expect(seen).toEqual(['first ', 'second'])
    expect(result.text).toBe('first second')
  })

  test('a frame split across byte chunks, mid-character, still decodes exactly', async () => {
    const whole = ENCODER.encode(contentFrame('héllo 🌊 wörld'))
    // Cut inside the four bytes of U+1F30A, so neither half is valid UTF-8.
    const emoji = ENCODER.encode('🌊')
    const at = whole.indexOf(emoji[0] ?? 0) + 2
    const { port } = streamingFetch([whole.slice(0, at), whole.slice(at), frame('[DONE]')])

    const deltas: string[] = []
    const result = await new OpenAiInference(CONFIG, port).infer({ prompt: 'hi' }, (c) => void deltas.push(c))

    expect(result.text).toBe('héllo 🌊 wörld')
    expect(deltas).toEqual(['héllo 🌊 wörld'])
  })

  test('a malformed frame degrades and the session survives it', async () => {
    const { port } = streamingFetch([
      ': keepalive\n\n',
      contentFrame('good '),
      'data: {"choices":[{"delta":{"cont\n\n',
      'data: not json at all\n\n',
      'data: \n\n',
      'event: ping\n\n',
      contentFrame('still here'),
      frame('[DONE]'),
    ])
    const deltas: string[] = []
    const result = await new OpenAiInference(CONFIG, port).infer({ prompt: 'hi' }, (c) => void deltas.push(c))

    expect(deltas).toEqual(['good ', 'still here'])
    expect(result.text).toBe('good still here')
    expect(result.stopReason).toBe('end-of-stream')
    expect(result.usage).toBeNull()
  })

  test('a body truncated mid-frame ends the reply rather than throwing', async () => {
    const { port } = streamingFetch([contentFrame('half a '), 'data: {"choices":[{"delta":{"content":"rep'])
    const deltas: string[] = []
    const result = await new OpenAiInference(CONFIG, port).infer({ prompt: 'hi' }, (c) => void deltas.push(c))

    expect(deltas).toEqual(['half a '])
    expect(result.text).toBe('half a ')
  })

  test('an abort mid-stream rejects, and no delta arrives after it', async () => {
    const { port } = streamingFetch([
      contentFrame('one '),
      contentFrame('two '),
      contentFrame('three'),
      frame('[DONE]'),
    ])
    const controller = new AbortController()
    const deltas: string[] = []
    const pending = new OpenAiInference(CONFIG, port).infer(
      { prompt: 'count' },
      (chunk) => {
        deltas.push(chunk)
        controller.abort()
      },
      controller.signal,
    )

    await expect(pending).rejects.toThrow('inference aborted')
    expect(deltas).toEqual(['one '])
  })
})

describe('the HTTP transport describes what it actually sends', () => {
  test('describeRequest is the literal body handed to fetch', async () => {
    const { port, calls } = streamingFetch([frame('[DONE]')])
    const inference = new OpenAiInference(CONFIG, port)
    const record = inference.describeRequest({ prompt: 'the whole assembled prompt' })

    expect(record.url).toBe('http://127.0.0.1:8873/v1/chat/completions')
    expect(record.method).toBe('POST')
    expect(JSON.parse(record.body)).toEqual({
      model: 'test-model',
      messages: [{ role: 'user', content: 'the whole assembled prompt' }],
      temperature: 0.7,
      max_tokens: 4096,
      stream: true,
      stream_options: { include_usage: true },
    })

    await inference.infer({ prompt: 'the whole assembled prompt' })
    expect(calls[0]?.url).toBe(record.url)
    expect(calls[0]?.init?.body).toBe(record.body)
    expect(calls[0]?.init?.method).toBe('POST')
  })

  test('the record carries no key, and a trailing slash makes no double slash', () => {
    const inference = new OpenAiInference({ ...CONFIG, baseUrl: 'http://host/v1/' }, stubPorts().fetch)
    const record = inference.describeRequest({ prompt: 'hi' })
    expect(record.url).toBe('http://host/v1/chat/completions')
    expect(record.body).not.toContain(CONFIG.apiKey)
    expect(Object.keys(record)).toEqual(['url', 'method', 'body'])
  })

  test('a refusal names the status rather than returning an empty reply', async () => {
    const port: FetchPort = async () => new Response('no such model', { status: 404, statusText: 'Not Found' })
    const inference = new OpenAiInference(CONFIG, port)
    await expect(inference.infer({ prompt: 'hi' })).rejects.toThrow(
      'http://127.0.0.1:8873/v1/chat/completions answered 404 Not Found: no such model',
    )
  })
})

describe('the catalogue picks a transport by kind', () => {
  test('each known kind builds its own concrete', () => {
    const fetchPort = stubPorts().fetch
    expect(inferenceFor('openai', CONFIG, fetchPort)).toBeInstanceOf(OpenAiInference)
    expect(inferenceFor('scripted', CONFIG, fetchPort)).toBeInstanceOf(ScriptedInference)
  })

  test('an unknown kind names what is known instead of falling back', () => {
    expect(() => inferenceFor('anthropic', CONFIG, stubPorts().fetch)).toThrow(
      "Unknown model kind 'anthropic'. Known: openai, scripted",
    )
  })

  test('the fixture-less scripted transport refuses its first call by name', async () => {
    const inference = inferenceFor('scripted', CONFIG, stubPorts().fetch)
    await expect(inference.infer({ prompt: 'hi' })).rejects.toThrow(
      'scripted inference has no reply 1 — the fixture holds 0',
    )
  })
})
