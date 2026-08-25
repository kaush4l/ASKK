import { expect, test, describe } from 'bun:test'
import { adapterFor, requestFor, paperOf } from '@harness/context'
import { blocksFor, cardFor, TOOLS, AT } from './matrix.js'

/**
 * A STREAMED REPLY AND A BUFFERED ONE ARE THE SAME REPLY.
 *
 * The loop must not be able to tell how the bytes showed up (I15), and "must
 * not" is only a claim until something executes it. Each provider below gets
 * TWO fixtures of one turn — the whole body, and the frames it would have
 * arrived in — and the two must parse to the identical `ProviderReply`, `text`,
 * `reasoning`, `calls`, `finish`, `usage` and the opaque `replayState` the NEXT
 * request has to echo included. Only `raw` differs, and it differs on purpose:
 * it is what actually arrived.
 *
 * THE FIXTURES ARE DELIBERATELY AWKWARD — a word split mid-sentence, tool
 * arguments split mid-JSON, a thought signature arriving on its own frame after
 * the thought it signs. A fixture that streams one chunk proves nothing, so the
 * last test in each block asserts that no single frame carried the whole reply.
 */

const TEXT = 'The plan has two unfinished steps.'
const REASONING = 'Read the file first.'
const ARGS = '{"path":"plan.md"}'

/** One turn per provider: the buffered body, and the frames the same turn streams as. */
/** @type {Record<string, {whole: unknown, frames: unknown[]}>} */
const TURNS = {
  openai: {
    whole: {
      choices: [{
        message: {
          role: 'assistant',
          content: TEXT,
          reasoning_content: REASONING,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: ARGS } }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 40,
        prompt_tokens_details: { cached_tokens: 1000 },
        completion_tokens_details: { reasoning_tokens: 12 },
      },
    },
    frames: [
      { choices: [{ delta: { role: 'assistant', reasoning_content: 'Read the ' } }] },
      { choices: [{ delta: { reasoning_content: 'file first.' } }] },
      { choices: [{ delta: { content: 'The plan has ' } }] },
      { choices: [{ delta: { content: 'two unfinished steps.' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"path"' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"plan.md"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      {
        choices: [],
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 40,
          prompt_tokens_details: { cached_tokens: 1000 },
          completion_tokens_details: { reasoning_tokens: 12 },
        },
      },
    ],
  },
  anthropic: {
    whole: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'anthropic/fixture-1',
      content: [
        { type: 'thinking', thinking: REASONING, signature: 'sig-abc' },
        { type: 'text', text: TEXT },
        { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'plan.md' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 1200, cache_read_input_tokens: 1000, output_tokens: 40 },
    },
    frames: [
      {
        type: 'message_start',
        message: {
          id: 'msg_1', type: 'message', role: 'assistant', model: 'anthropic/fixture-1',
          content: [], stop_reason: null,
          usage: { input_tokens: 1200, cache_read_input_tokens: 1000 },
        },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Read the ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'file first.' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'abc' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'The plan has ' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'two unfinished steps.' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"path"' } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: ':"plan.md"}' } },
      { type: 'content_block_stop', index: 2 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 40 } },
      { type: 'message_stop' },
    ],
  },
  gemini: {
    whole: {
      candidates: [{
        content: {
          role: 'model',
          parts: [
            { text: REASONING, thought: true, thoughtSignature: 'sig-abc' },
            { text: TEXT },
            { functionCall: { name: 'read_file', args: { path: 'plan.md' } } },
          ],
        },
        finishReason: 'STOP',
      }],
      usageMetadata: {
        promptTokenCount: 1200, candidatesTokenCount: 40, cachedContentTokenCount: 1000, thoughtsTokenCount: 12,
      },
    },
    frames: [
      { candidates: [{ content: { role: 'model', parts: [{ text: 'Read the ', thought: true }] } }] },
      { candidates: [{ content: { role: 'model', parts: [{ text: 'file first.', thought: true, thoughtSignature: 'sig-abc' }] } }] },
      { candidates: [{ content: { role: 'model', parts: [{ text: 'The plan has ' }] } }] },
      { candidates: [{ content: { role: 'model', parts: [{ text: 'two unfinished steps.' }] } }] },
      { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: 'plan.md' } } }] } }] },
      {
        candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'STOP' }],
        usageMetadata: {
          promptTokenCount: 1200, candidatesTokenCount: 40, cachedContentTokenCount: 1000, thoughtsTokenCount: 12,
        },
      },
    ],
  },
}

describe('one turn, streamed and buffered, parses to one reply', () => {
  for (const [provider, turn] of Object.entries(TURNS)) {
    const adapter = adapterFor(provider)

    test(`${provider}: everything but \`raw\` is identical`, () => {
      const { raw: _streamed, ...fromStream } = adapter.parseStream(turn.frames)
      const { raw: _buffered, ...fromBody } = adapter.parseResponse(turn.whole)
      expect(fromStream).toStrictEqual(fromBody)
    })

    test(`${provider}: it is not identical by being empty`, () => {
      const reply = adapter.parseStream(turn.frames)
      expect(reply.text).toBe(TEXT)
      expect(reply.reasoning).toBe(REASONING)
      expect(reply.calls.map((c) => c.tool)).toStrictEqual(['read_file'])
      expect(JSON.parse(reply.calls[0]?.args ?? '{}')).toStrictEqual({ path: 'plan.md' })
      expect(reply.usage?.cachedInputTokens).toBe(1000)
    })

    test(`${provider}: \`raw\` is the frames, because the frames are what arrived`, () => {
      expect(adapter.parseStream(turn.frames).raw).toBe(turn.frames)
    })

    test(`${provider}: no single frame carried the whole reply`, () => {
      for (const frame of turn.frames) expect(JSON.stringify(frame)).not.toContain(TEXT)
    })
  }
})

describe('a request that asks for a stream says what this provider needs to hear', () => {
  /** @param {string} provider @param {boolean} stream */
  function body(provider, stream) {
    return requestFor({
      state: paperOf('work', blocksFor('tools'), AT),
      card: cardFor(provider, 'tools'),
      tools: TOOLS,
      stream,
    }).body
  }

  test('openai asks for usage explicitly, or a streamed turn costs an unknown amount', () => {
    expect(body('openai', true)['stream_options']).toStrictEqual({ include_usage: true })
    // Only when streaming: a server that does not know the key refuses the whole
    // request rather than ignoring a field it was not asked about.
    expect(body('openai', false)['stream_options']).toBeUndefined()
  })

  test('every provider carries the flag itself, whatever its URL does with it', () => {
    for (const provider of Object.keys(TURNS)) {
      expect(body(provider, true)['stream']).toBe(true)
      expect(body(provider, false)['stream']).toBe(false)
    }
  })
})
