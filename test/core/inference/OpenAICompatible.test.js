import { afterEach, describe, expect, test } from 'bun:test'
import { OpenAICompatible, Reply } from '../../../src/core/inference/OpenAICompatible.js'
import { Reason } from '../../../src/core/Outcome.js'
import { fixture, readSse } from '../../support/fixtures.js'
import { ScriptedFetch } from '../../support/ScriptedFetch.js'

/**
 * The transport against eight real replies, replayed byte for byte.
 *
 * Every fixture here came off `http://127.0.0.1:8873/v1` with `curl`. That is
 * the only way these two defects could be caught: neither is a shape anybody
 * would invent, because in both of them the whole of the problem is a field that
 * ISN'T THERE. A hand-written "truncated reply" would have had a
 * `reasoning_content` key, and a hand-written "no answer" would have had an
 * empty `content` key rather than no key at all — and the tests would have
 * passed against code that was about to run a command nobody asked for, and
 * against code about to blame a working endpoint.
 *
 * The first block asserts the fixtures still say what they were captured to
 * say, and it is only ever four assertions long: what each file proves is what
 * is MISSING from it, and no test driven through `invoke` can express a key
 * that does not exist. Every claim about behaviour is asserted below, through
 * the shipped call, against the same bytes — two tests that restated a fixture's
 * constants where a behavioural test already covered them were deleted rather
 * than kept as a second opinion about a checked-in file.
 */

let restore = null
afterEach(() => {
  restore?.()
  restore = null
})

/** A transport pointed at a scripted fetch. Returns both so a test can read both. */
function transport(replies, settings = {}) {
  const fetching = new ScriptedFetch(replies)
  restore = fetching.install()
  return {
    fetching,
    model: new OpenAICompatible({
      baseUrl: 'http://127.0.0.1:8873/v1',
      maxTokens: 220,
      ...settings,
    }),
  }
}

describe('the captured replies', () => {
  test('truncation INSIDE the think block: length, and NO reasoning field at all', () => {
    const choice = JSON.parse(fixture('truncated-in-think.json')).choices[0]

    expect(choice.finish_reason).toBe('length')
    expect('reasoning_content' in choice.message).toBe(false)
    expect(Object.keys(choice.message)).toEqual(['role', 'content'])
    // What is on the answer channel instead. Note the first person plural: this
    // is a model talking to itself, and it is about to be read as speech.
    expect(choice.message.content.startsWith("We need answer user's request")).toBe(true)
    // And it contains the call, written down as a possibility rather than a
    // decision — four times.
    expect(choice.message.content.split('shell({"command": "uname -a"})').length - 1).toBe(4)
  })

  test('spent INSIDE the think block: length, reasoning present, and NO content key', () => {
    const choice = JSON.parse(fixture('spent-in-think.json')).choices[0]

    expect(choice.finish_reason).toBe('length')
    // The opposite accident to the file above. The routing WORKED — the
    // scratchpad is on its own channel — and the answer was never begun.
    expect(Object.keys(choice.message)).toEqual(['role', 'reasoning_content'])
    expect('content' in choice.message).toBe(false)
    expect(choice.message.reasoning_content.length).toBe(504)
  })

  test('and streamed, the only content delta in the whole reply is a newline', () => {
    const read = readSse(fixture('spent-in-think.sse'))

    expect(read.finish).toBe('length')
    expect(read.reasoning.length).toBe(500)
    // One delta, one character, and that character is not an answer. Handed on
    // as one it is the "empty string that looks like a silent model" the shape
    // guard in `invoke` exists to prevent — arriving through the door that
    // guard does not watch.
    expect(read.contentDeltas).toBe(1)
    expect(read.content).toBe('\n')
  })

  test('the streamed dump is the scratchpad sent a second time, byte for byte', () => {
    const read = readSse(fixture('truncated-in-think.sse'))

    expect(read.finish).toBe('length')
    expect(read.reasoning.length).toBe(960)
    // ONE content delta, carrying everything already streamed as reasoning.
    // This is the shape `stream` now recognises, and it is not a shape anyone
    // would have guessed at: the endpoint streams the thought, then repeats the
    // whole thought as the answer.
    expect(read.contentDeltas).toBe(1)
    expect(read.content).toBe(read.reasoning)
  })
})

describe('_state', () => {
  test('anything that did not stop on length is whole', () => {
    expect(OpenAICompatible._state('stop', 'thought', 'answer')).toBe(Reply.WHOLE)
    expect(OpenAICompatible._state(undefined, '', 'answer')).toBe(Reply.WHOLE)
    expect(OpenAICompatible._state('tool_calls', '', '')).toBe(Reply.WHOLE)
  })

  test('length with reasoning beside it is a real answer, cut off', () => {
    expect(OpenAICompatible._state('length', 'thought', '1\n2\n3')).toBe(Reply.CUT)
  })

  test('an answer channel with nothing readable on it is a reply that never answered', () => {
    // Absent, empty, and the streamed spelling of the same thing: a newline.
    expect(OpenAICompatible._state('length', 'we need to', undefined)).toBe(Reply.SPENT)
    expect(OpenAICompatible._state('length', 'we need to', '')).toBe(Reply.SPENT)
    expect(OpenAICompatible._state('length', 'we need to', '\n')).toBe(Reply.SPENT)
    // Even with thinking off. There is no answer to keep either way, so the
    // switch that rescues a non-reasoning server has nothing to rescue here.
    expect(OpenAICompatible._state('length', 'we need to', '\n', false)).toBe(Reply.SPENT)
  })

  test('but a reply that finished with no content is not spent, it is whole', () => {
    // The ordinary tool-call finish, where the answer lives in another field.
    expect(OpenAICompatible._state('stop', '', undefined)).toBe(Reply.WHOLE)
  })

  test('an answer channel repeating the scratchpad is the dump, positively', () => {
    expect(OpenAICompatible._state('length', 'we need to', 'we need to')).toBe(Reply.THINKING)
  })

  test('length with no reasoning anywhere is the dump, while thinking was asked for', () => {
    expect(OpenAICompatible._state('length', undefined, 'we need to')).toBe(Reply.THINKING)
  })

  test('and is only a short answer when thinking was turned off', () => {
    // The one branch that keeps a non-reasoning server usable. Without it, every
    // truncated reply from a plain completion endpoint would be called a dump.
    expect(OpenAICompatible._state('length', undefined, 'we need to', false)).toBe(Reply.CUT)
  })
})

describe('invoke', () => {
  test('a complete reply comes back as the answer, with no note', async () => {
    const { model } = transport([{ json: JSON.parse(fixture('complete.json')) }])

    const answered = await model.invoke('what is 2+2?')

    expect(answered.ok).toBe(true)
    expect(answered.value).toContain('result: 4')
    expect(answered.notes).toEqual([])
  })

  test('a reply cut off past the think block is kept, and says it was cut off', async () => {
    const { model } = transport([{ json: JSON.parse(fixture('truncated-past-think.json')) }])

    const answered = await model.invoke('count to 400')

    expect(answered.ok).toBe(true)
    expect(answered.value.startsWith('1\n2\n3\n')).toBe(true)
    expect(answered.notes).toHaveLength(1)
    expect(answered.notes[0]).toContain('cut off')
  })

  test('a reasoning dump is REFUSED, not returned as the answer', async () => {
    const { model } = transport([{ json: JSON.parse(fixture('truncated-in-think.json')) }])

    const answered = await model.invoke('what kernel is this machine running?')

    // The assertion this whole slice is about. Before the fix this was
    // `ok: true` with 965 characters of the model's private working as `value`.
    expect(answered.ok).toBe(false)
    expect(answered.value).toBeNull()
    expect(answered.failure.code).toBe(Reason.UNAVAILABLE)
    expect(answered.failure.message).toContain('still thinking')
    expect(answered.failure.message).toContain('965')
    expect(answered.failure.hint).toContain('Raise max tokens')
  })

  test('a reply with no content key is refused, and does not blame the base URL', async () => {
    const { model } = transport([{ json: JSON.parse(fixture('spent-in-think.json')) }])

    const answered = await model.invoke('what kernel is this machine running?')

    // Before the fix this was the shape guard: 'no message content in the
    // reply', hinting 'Check the base URL ends in /v1' — at a correctly
    // configured endpoint that had just answered perfectly.
    expect(answered.ok).toBe(false)
    expect(answered.failure.message).toContain('before the model wrote any answer')
    expect(answered.failure.message).toContain('504')
    expect(answered.failure.hint).not.toContain('base URL')
    expect(answered.failure.hint).toContain('Raise max tokens')
  })

  test('the ceiling is only named where raising it is advice', async () => {
    const dump = JSON.parse(fixture('truncated-in-think.json'))
    const { model } = transport([{ json: dump }], { maxTokens: 131072 })

    const answered = await model.invoke('hello')

    // 131,072 is what an agent file that says nothing takes, so this is the
    // number the running app would have printed. Telling somebody there to
    // raise their limit sends them to change the one thing that is not the cause.
    expect(answered.failure.hint).not.toContain('Raise max tokens')
    expect(answered.failure.hint).toContain('131,072')
    expect(answered.failure.hint).toContain('set thinking to false')
  })

  test('usage reaches the caller, with the endpoint latency it reported', async () => {
    const body = JSON.parse(fixture('complete.json'))
    const { model } = transport([{ json: body }])
    const seen = []

    await model.invoke('what is 2+2?', [], { onUsage: (usage) => seen.push(usage) })

    expect(seen).toHaveLength(1)
    expect(seen[0].prompt).toBe(84)
    expect(seen[0].completion).toBe(302)
    // The non-streaming reply reports one duration and no rates, and that is a
    // normal reply rather than a broken one: what is absent stays absent.
    expect(seen[0].latency).toEqual({ total: 7.77 })
  })
})

describe('stream', () => {
  test('a complete stream returns the answer and shows the thinking separately', async () => {
    const { model } = transport([{ sse: fixture('complete.sse') }])
    const text = []
    const thoughts = []

    const answered = await model.stream('what is 2+2?', [], {
      onDelta: (chunk, kind) => (kind === 'reasoning' ? thoughts : text).push(chunk),
    })

    expect(answered.ok).toBe(true)
    expect(answered.value).toContain('result: 4')
    // The reasoning was shown and is NOT part of the value the contract is
    // parsed from — the invariant this file exists to keep.
    expect(thoughts.join('').length).toBe(398)
    expect(answered.value).not.toContain(thoughts.join('').slice(0, 40))
    expect(text.join('')).toBe(answered.value)
  })

  test('a streamed dump is refused, and is never painted as the answer', async () => {
    const { model } = transport([{ sse: fixture('truncated-in-think.sse') }])
    const text = []
    const thoughts = []

    const answered = await model.stream('what kernel is this machine running?', [], {
      onDelta: (chunk, kind) => (kind === 'reasoning' ? thoughts : text).push(chunk),
    })

    expect(answered.ok).toBe(false)
    expect(answered.failure.message).toContain('still thinking')
    expect(answered.failure.message).toContain('960')
    // The reasoning was streamed to the page once, as reasoning. The repeat
    // that arrived on the answer channel was dropped rather than shown again
    // under a heading claiming it was the reply.
    expect(thoughts.join('').length).toBe(960)
    expect(text).toEqual([])
  })

  test('a streamed reply whose only content is a newline is refused, not returned', async () => {
    const { model } = transport([{ sse: fixture('spent-in-think.sse') }])
    const text = []

    const answered = await model.stream('what kernel is this machine running?', [], {
      onDelta: (chunk, kind) => kind === 'text' && text.push(chunk),
    })

    // Before the fix: ok, value '\n', carrying a note saying the reply was cut
    // off after 1 character. A one-character answer reported as success is the
    // silent model this transport is not allowed to invent.
    expect(answered.ok).toBe(false)
    expect(answered.value).toBeNull()
    expect(answered.failure.message).toContain('before the model wrote any answer')
    expect(answered.failure.message).toContain('500')
  })

  test('a stream cut off past the think block keeps its text and says it was cut', async () => {
    const { model } = transport([{ sse: fixture('truncated-past-think.sse') }])

    const answered = await model.stream('count to 400', [], { onDelta: () => {} })

    expect(answered.ok).toBe(true)
    expect(answered.value.trimStart().startsWith('1\n2\n')).toBe(true)
    expect(answered.notes[0]).toContain('cut off')
  })

  test('the endpoint latency in the usage frame reaches the caller', async () => {
    const { model } = transport([{ sse: fixture('complete.sse') }])
    const seen = []

    await model.stream('what is 2+2?', [], { onDelta: () => {}, onUsage: (u) => seen.push(u) })

    const last = seen.at(-1)
    expect(last.prompt).toBe(87)
    expect(last.latency).toEqual({
      firstToken: 41.09,
      prefill: 41.09,
      generation: 35.18,
      total: 76.27,
      prefillRate: 2.12,
      generationRate: 4.06,
    })
  })

  test('the request asks for usage, because without it no frame carries any', async () => {
    const { model, fetching } = transport([{ sse: fixture('complete.sse') }])

    await model.stream('hello', [], { onDelta: () => {} })

    expect(fetching.bodies[0].stream).toBe(true)
    expect(fetching.bodies[0].stream_options).toEqual({ include_usage: true })
  })
})

describe('thinking', () => {
  test('is on by default, and the switch is not sent', async () => {
    const { model, fetching } = transport([{ json: JSON.parse(fixture('complete.json')) }])

    expect(model.thinking).toBe(true)
    await model.invoke('hello')

    // Not `chat_template_kwargs: {enable_thinking: true}`. A server that has
    // never heard of the key is not asked to ignore one.
    expect('chat_template_kwargs' in fetching.bodies[0]).toBe(false)
  })

  test('turning it off sends the only switch that works', async () => {
    const { model, fetching } = transport([{ json: JSON.parse(fixture('complete.json')) }], {
      thinking: false,
    })

    await model.invoke('hello')

    expect(fetching.bodies[0].chat_template_kwargs).toEqual({ enable_thinking: false })
    // `reasoning_effort` is measured to do nothing at any value, so it is not
    // sent at all rather than sent hopefully.
    expect('reasoning_effort' in fetching.bodies[0]).toBe(false)
  })

  test('and opts a non-reasoning server out of the absence rule', async () => {
    const dump = JSON.parse(fixture('truncated-in-think.json'))
    const { model } = transport([{ json: dump }], { thinking: false })

    const answered = await model.invoke('hello')

    // Same bytes, opposite verdict, and that is the point: told there was no
    // thinking to misroute, the transport reads a `length` finish as a short
    // answer rather than as a scratchpad.
    expect(answered.ok).toBe(true)
    expect(answered.notes[0]).toContain('cut off')
  })

  test('both calls build one body, so a switch cannot apply to only half of them', async () => {
    const { model, fetching } = transport(
      [{ json: JSON.parse(fixture('complete.json')) }, { sse: fixture('complete.sse') }],
      { thinking: false },
    )

    await model.invoke('hello')
    await model.stream('hello', [], { onDelta: () => {} })

    for (const body of fetching.bodies) {
      expect(body.chat_template_kwargs).toEqual({ enable_thinking: false })
    }
  })
})
