import { readFileSync } from 'node:fs'

/**
 * Real replies from a real endpoint, kept on disk so a test can replay them.
 *
 * Every file in `fixtures/` was captured with `curl` from the testbed server on
 * `http://127.0.0.1:8873/v1` and saved byte for byte. None of them was written
 * by hand, and that is the whole point: the failure this directory exists for
 * was invisible to every hand-written approximation of it, because the thing
 * that goes wrong is a field the approximation would have remembered to include.
 *
 * What was captured, and what each one proves. FOUR STATES:
 *
 *   complete.json / complete.sse          finish_reason `stop`.
 *       `reasoning_content` is PRESENT and separate; `content` is the answer.
 *
 *   truncated-past-think.json / .sse      finish_reason `length`, past the
 *       think block. `reasoning_content` is PRESENT; `content` is a real answer
 *       cut off mid-sentence. Captured with `max_tokens: 500` on a prompt that
 *       thinks briefly and then writes a long list.
 *
 *   truncated-in-think.json / .sse        finish_reason `length`, still INSIDE
 *       the think block. `reasoning_content` is ABSENT and the raw reasoning is
 *       the WHOLE of `content`. Captured with `max_tokens: 220`.
 *
 *   spent-in-think.json / .sse            finish_reason `length`, still inside
 *       the think block — and the OPPOSITE accident. `reasoning_content` is
 *       PRESENT and correctly routed, and there is no answer at all:
 *       `Object.keys(message)` is `['role', 'reasoning_content']`. Captured
 *       from `gemma-4-12B-it-qat-mxfp8` with `max_tokens: 120`, 3/3.
 *
 * The first three came from `Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp` and the
 * fourth from `gemma-4-12B-it-qat-mxfp8`, and the two models are the reason
 * there are four states rather than three. The comment that shipped with the
 * first three said "no fourth state seen" over ~60 calls, which was true of the
 * calls made and false of the endpoint: a different chat template on the same
 * server routes the halves correctly and simply runs out before writing an
 * answer. A negative claim is a claim.
 *
 * The streaming captures of the last two are the ones worth reading twice, and
 * they are opposites. In `truncated-in-think.sse` the reasoning arrives
 * incrementally on `reasoning_content` — 38 deltas, 960 characters — and then,
 * at the moment the token limit bites, the SAME 960 characters arrive AGAIN as a
 * single `content` delta. Byte-identical; the test asserts it. In
 * `spent-in-think.sse` the reasoning also streams correctly, and the only
 * `content` delta in the whole stream is a single newline character.
 *
 * There is never a `<think>` tag anywhere in any of these files. The server
 * strips the tags and routes the halves, or fails to route and dumps the whole
 * scratchpad on the answer channel. Nothing downstream can look for a marker
 * that is not sent.
 */

const DIR = new URL('./fixtures/', import.meta.url)

/** One fixture, verbatim. Throws — this is test support, not `src/`. */
export function fixture(name) {
  return readFileSync(new URL(name, DIR), 'utf8')
}

/**
 * What an SSE capture actually carried, read the way the transport reads it.
 *
 * Deliberately a second, simpler implementation of the frame walk rather than a
 * call into `Inference._postStream`: a test that measured the fixture with the
 * code under test would only prove that code agrees with itself.
 *
 * @returns {{reasoning: string, content: string, finish: string|null,
 *   usage: object|null, contentDeltas: number}}
 */
export function readSse(text) {
  let reasoning = ''
  let content = ''
  let finish = null
  let usage = null
  let contentDeltas = 0

  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    const parsed = JSON.parse(payload)
    if (parsed.usage) usage = parsed.usage
    const choice = parsed.choices?.[0]
    if (choice?.finish_reason) finish = choice.finish_reason
    const delta = choice?.delta
    if (typeof delta?.reasoning_content === 'string') reasoning += delta.reasoning_content
    if (typeof delta?.content === 'string' && delta.content) {
      content += delta.content
      contentDeltas++
    }
  }
  return { reasoning, content, finish, usage, contentDeltas }
}
