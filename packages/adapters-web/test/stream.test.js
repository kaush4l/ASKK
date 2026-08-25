import { expect, test } from 'bun:test'

import { accumulate, completion, foldFrame, frames, streamed } from '@harness/adapters-web'

/** @param {string[]} chunks @returns {{reply: import('@harness/kernel').ModelReply, deltas: Array<{text?: string, reasoning?: string}>}} */
function stream(chunks) {
  const acc = accumulate()
  /** @type {Array<{text?: string, reasoning?: string}>} */
  const deltas = []
  let carry = ''
  for (const chunk of [...chunks, '\n']) {
    const found = frames(chunk, carry)
    carry = found.carry
    for (const frame of found.frames) {
      const delta = foldFrame(acc, frame)
      if (delta) deltas.push(delta)
    }
  }
  return { reply: streamed(acc), deltas }
}

const chunk = (/** @type {Record<string, unknown>} */ delta, /** @type {string|null} */ finish = null) =>
  `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`

test('a frame split across two chunks is not lost', () => {
  const whole = chunk({ content: 'hello' })
  const { reply, deltas } = stream([whole.slice(0, 20), whole.slice(20)])
  expect(reply.text).toBe('hello')
  expect(deltas).toEqual([{ text: 'hello' }])
})

test('a final frame with no closing newline still arrives', () => {
  const { reply } = stream([`data: ${JSON.stringify({ choices: [{ delta: { content: 'tail' } }] })}`])
  expect(reply.text).toBe('tail')
})

test('[DONE] is not JSON and is not folded', () => {
  const { reply } = stream([chunk({ content: 'a' }), 'data: [DONE]\n\n'])
  expect(reply.text).toBe('a')
  expect(/** @type {unknown[]} */ (reply.raw).length).toBe(1)
})

test('reasoning is accumulated apart from the answer', () => {
  const { reply, deltas } = stream([chunk({ reasoning_content: 'thinking' }), chunk({ content: 'answer' })])
  expect(reply.reasoning).toBe('thinking')
  expect(reply.text).toBe('answer')
  expect(deltas).toEqual([{ reasoning: 'thinking' }, { text: 'answer' }])
})

test('two calls to one tool stay two calls, and their arguments are assembled by index', () => {
  const { reply } = stream([
    chunk({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_file', arguments: '{"path":' } }] }),
    chunk({ tool_calls: [{ index: 1, id: 'c2', function: { name: 'read_file', arguments: '{"path":"b"}' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] }),
    chunk({}, 'tool_calls'),
  ])
  expect(reply.calls).toEqual([
    { id: 'c1', tool: 'read_file', args: '{"path":"a"}' },
    { id: 'c2', tool: 'read_file', args: '{"path":"b"}' },
  ])
  expect(reply.finish).toBe('tool_calls')
})

test('finish comes off the wire: a truncation is not a completed answer', () => {
  expect(stream([chunk({ content: 'half a sen' }, 'length')]).reply.finish).toBe('length')
  expect(stream([chunk({ content: 'done' }, 'stop')]).reply.finish).toBe('stop')
})

test('a provider that never says why it stopped gets unknown, which is not stop', () => {
  expect(stream([chunk({ content: 'x' })]).reply.finish).toBe('unknown')
  expect(stream([chunk({ content: 'x' }, 'weird_new_reason')]).reply.finish).toBe('unknown')
})

test('usage arrives on the final chunk and is carried', () => {
  const { reply } = stream([
    chunk({ content: 'hi' }, 'stop'),
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 8 } } })}\n\n`,
  ])
  expect(reply.usage).toEqual({ inputTokens: 12, outputTokens: 3, cachedInputTokens: 8 })
})

test('a whole completion reads to the same reply a stream folds to', () => {
  const streamed_ = stream([chunk({ content: 'hello' }, 'stop')]).reply
  const whole = completion({ choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }] })
  expect({ ...whole, raw: null }).toEqual({ ...streamed_, raw: null })
})
