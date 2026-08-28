/**
 * Concrete #2 — the OpenAI-compatible wire, streamed.
 *
 * `POST {baseUrl}/chat/completions` with `stream: true`, and Server-Sent
 * Events back. omlx, LM Studio, vLLM, llama.cpp and api.openai.com are one
 * transport differing only in `baseUrl`, which is why there is no provider
 * table — a new server is a catalogue row, not a class.
 *
 * `SALVAGE.md` records the old tree's `inference-http.js` as a **drop**, F-7:
 * it hand-rolled streaming, retries and token accounting and shipped none of
 * the three. Its endpoint shapes and body fields are what survives here; its
 * structure is not. Retries are still absent, and now deliberately so — a
 * retry that re-sends a prompt after half a reply has already reached the
 * transcript is a duplicate turn, and nothing in this tree yet knows how to
 * withdraw one.
 *
 * Deltas are emitted **as each frame is decoded**, never by chopping up a
 * buffered reply — `tests/inference-http.test.ts` proves that by refusing to
 * produce the second frame until the first delta has fired, so a buffering
 * implementation deadlocks instead of passing.
 */

import { Inference } from '@/core/inference/base'
import type {
  InferenceRequest,
  InferenceResult,
  OnDelta,
  RequestRecord,
} from '@/core/inference/base'

/** The sentinel that ends an OpenAI event stream. Not JSON, and parsing it as JSON is the classic bug. */
const DONE = '[DONE]'

/** What `infer` throws when the caller's signal fires, whichever layer noticed first. */
const ABORTED = 'inference aborted'

/**
 * The stop reason when the server named none. `stopReason` is not nullable, so
 * the honest value is a fact about the stream rather than a guessed `stop` —
 * the same reasoning that makes `usage` null instead of a zero.
 */
const END_OF_STREAM = 'end-of-stream'

/** U+FFFD. Invalid bytes become this rather than throwing a stream away. */
const REPLACEMENT = '�'

/** What the frames have said so far. One per call to `infer`. */
interface StreamState {
  text: string
  stopReason: string
  usage: { promptTokens: number; completionTokens: number } | null
}

export class OpenAiInference extends Inference {
  async infer(req: InferenceRequest, onDelta?: OnDelta, signal?: AbortSignal): Promise<InferenceResult> {
    const record = this.describeRequest(req)
    const response = await this.fetchPort(record.url, {
      method: record.method ?? 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: record.body,
      signal,
    })
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500)
      throw new Error(`${record.url} answered ${response.status} ${response.statusText}: ${detail}`)
    }
    const body = response.body
    if (body === null) throw new Error(`${record.url} answered ${response.status} with no body to stream`)
    return await this.readStream(body, onDelta, signal)
  }

  /**
   * The literal request, byte for byte: this string is what `infer` hands to
   * `fetch` as the body, not a re-description of it. The Authorization header
   * is absent by §7.2 — the key must not reach the render realm.
   */
  describeRequest(req: InferenceRequest): RequestRecord {
    const body = {
      model: this.config.model,
      messages: [{ role: 'user', content: req.prompt }],
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    }
    return {
      url: `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`,
      method: 'POST',
      body: JSON.stringify(body, null, 2),
    }
  }

  /** Reads frames until `[DONE]` or the stream ends, emitting every content delta on arrival. */
  private async readStream(
    body: ReadableStream<Uint8Array>,
    onDelta?: OnDelta,
    signal?: AbortSignal,
  ): Promise<InferenceResult> {
    const reader = body.getReader()
    const decode = utf8Decoder()
    const state: StreamState = { text: '', stopReason: '', usage: null }
    let buffer = ''
    try {
      for (;;) {
        if (signal?.aborted === true) throw new Error(ABORTED)
        const step = await readOrAbort(reader, signal)
        if (step.done) break
        // `Uint8Array` is an ECMAScript built-in that `checks/purity.ts` does
        // not list, so the core cannot construct one — hence the guard rather
        // than an empty-array default. Reported to the architect, not worked around.
        if (step.value !== undefined) buffer += decode(step.value)
        let cut = buffer.indexOf('\n')
        while (cut !== -1) {
          const line = buffer.slice(0, cut)
          buffer = buffer.slice(cut + 1)
          if (applyLine(line, state, onDelta)) return finish(state)
          cut = buffer.indexOf('\n')
        }
      }
      // A last frame the server did not terminate with a newline. A truncated
      // one fails to parse in `applyLine` and is dropped; the session survives.
      applyLine(buffer, state, onDelta)
    } finally {
      // Real cancellation, not a race against a timer: this closes the socket.
      await reader.cancel().catch(() => undefined)
    }
    return finish(state)
  }
}

/** A read whose rejection is reported as this transport's abort when the signal is what caused it. */
async function readOrAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<{ done: boolean; value?: Uint8Array }> {
  try {
    return await reader.read()
  } catch (error) {
    if (signal?.aborted === true) throw new Error(ABORTED)
    throw error
  }
}

function finish(state: StreamState): InferenceResult {
  return { text: state.text, stopReason: state.stopReason || END_OF_STREAM, usage: state.usage }
}

/** One SSE line. Returns true only for the `[DONE]` sentinel, which ends the stream. */
function applyLine(line: string, state: StreamState, onDelta?: OnDelta): boolean {
  const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line
  // Blank separators, `event:` lines and `: keepalive` comments all land here.
  if (!trimmed.startsWith('data:')) return false
  const payload = trimmed.slice('data:'.length).trim()
  if (payload === DONE) return true
  if (payload === '') return false
  let frame: unknown
  try {
    frame = JSON.parse(payload)
  } catch {
    // A truncated frame or one that is not JSON at all. Nothing in this
    // transport throws over a bad frame — a malformed byte must not cost a turn.
    return false
  }
  applyFrame(frame, state, onDelta)
  return false
}

/**
 * One decoded frame. Every access is defensive because a server's shape is not
 * this tree's to guarantee — and `reasoning_content`, which some servers
 * interleave, is deliberately not part of the reply text.
 */
function applyFrame(frame: unknown, state: StreamState, onDelta?: OnDelta): void {
  const record = asRecord(frame)
  const choices = record?.choices
  const first = asRecord(Array.isArray(choices) ? choices[0] : undefined)
  const content = asRecord(first?.delta)?.content
  // The empty opening delta most servers send carries nothing, and a delta of
  // no characters would be a chunk the Context surface renders as a blank line.
  if (typeof content === 'string' && content !== '') {
    state.text += content
    onDelta?.(content)
  }
  const reason = first?.finish_reason
  if (typeof reason === 'string') state.stopReason = reason
  const usage = asRecord(record?.usage)
  const prompt = usage?.prompt_tokens
  const completion = usage?.completion_tokens
  if (typeof prompt === 'number' && typeof completion === 'number') {
    state.usage = { promptTokens: prompt, completionTokens: completion }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/**
 * UTF-8, decoded across chunk boundaries.
 *
 * `TextDecoder` is an ambient global and §3.4 grants `src/core/**` none, so the
 * decoder is here. It reads nothing from the environment — the same bytes give
 * the same string on any machine — which is why it is a function in the core
 * rather than a fifth port. A character split across two TCP reads is not
 * hypothetical: it is one emoji at a chunk boundary.
 */
function utf8Decoder(): (bytes: Uint8Array) => string {
  let needed = 0
  let point = 0
  return (bytes) => {
    let out = ''
    for (let i = 0; i < bytes.length; i += 1) {
      const byte = bytes[i] ?? 0
      if (needed > 0 && (byte & 0xc0) !== 0x80) {
        // The sequence was cut short by a byte that cannot continue it. Report
        // the loss, then read this byte again as the start of the next one.
        out += REPLACEMENT
        needed = 0
        i -= 1
        continue
      }
      if (needed > 0) {
        point = (point << 6) | (byte & 0x3f)
        needed -= 1
        if (needed === 0) out += String.fromCodePoint(point)
        continue
      }
      if (byte < 0x80) out += String.fromCodePoint(byte)
      else if (byte >= 0xc2 && byte <= 0xdf) [point, needed] = [byte & 0x1f, 1]
      else if (byte >= 0xe0 && byte <= 0xef) [point, needed] = [byte & 0x0f, 2]
      else if (byte >= 0xf0 && byte <= 0xf4) [point, needed] = [byte & 0x07, 3]
      else out += REPLACEMENT
    }
    return out
  }
}
