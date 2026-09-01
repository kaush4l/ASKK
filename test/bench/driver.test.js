import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULTS, drive, MAX_TURNS } from '../../bench/driver.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'support', 'fixtures')
const capture = (name) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'))

/**
 * The driver, held to the one thing that makes the rig a comparison: that
 * everything except the scaffold is the same for both arms.
 *
 * There was no test here at all. The two obvious ways to rig this measurement —
 * a turn cap or a sampling parameter chosen per arm — were applied to
 * `bench/driver.js` and the suite stayed green over both, which means a number
 * this rig printed afterwards could not be checked by anything. What follows
 * drives two scaffolds that differ only in their `id` and asserts that nothing
 * the driver sends or allows differs with it.
 */

/** Every request body the driver put on the wire, in order. */
let sent = []
let realFetch

/**
 * A stub endpoint. `replies` is consumed one per call; the last one repeats, so
 * a scaffold that never answers keeps getting the same tool call.
 */
function stubEndpoint(replies) {
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body))
    const reply = replies[Math.min(sent.length - 1, replies.length - 1)]
    return new Response(
      JSON.stringify({
        choices: [{ message: reply.message, finish_reason: reply.finish ?? 'stop' }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
}

/** Serve whole recorded reply bodies, in order; the last one repeats. */
function serveBodies(bodies) {
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body))
    const body = bodies[Math.min(sent.length - 1, bodies.length - 1)]
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
}

/** A scaffold that does nothing but exist, so the driver is the only variable. */
function stubScaffold(id) {
  return {
    id,
    label: id,
    init: () => ({ turns: [] }),
    request: (state) => ({ messages: [{ role: 'user', content: `turn ${state.turns.length}` }] }),
    parse: (text) => (text.startsWith('DONE') ? { kind: 'answer', text } : { kind: 'tool', text }),
    act: () => ({ observation: 'an observation', ran: [] }),
    observe: (state, event) => state.turns.push(event.turn),
  }
}

const task = { id: 'stub', prompt: 'do a thing' }
const tools = { workdir: '/tmp/askk-bench-driver-test', calls: [] }

beforeEach(() => {
  sent = []
  realFetch = globalThis.fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('both arms are offered exactly the same call', () => {
  test('every sampling parameter is identical, whichever scaffold asked', async () => {
    stubEndpoint([{ message: { role: 'assistant', content: 'DONE' } }])
    for (const id of ['agent-zero', 'ours']) {
      await drive({ scaffold: stubScaffold(id), task, tools })
    }
    expect(sent.length).toBe(2)

    // Compared field by field rather than as a whole object, because `messages`
    // is the one thing that IS allowed to differ — it is the scaffold.
    const [first, second] = sent
    for (const field of ['model', 'temperature', 'seed', 'max_tokens']) {
      expect(`${field}=${JSON.stringify(second[field])}`).toBe(
        `${field}=${JSON.stringify(first[field])}`,
      )
    }
    expect(first.temperature).toBe(DEFAULTS.temperature)
    expect(first.seed).toBe(DEFAULTS.seed)
    expect(first.max_tokens).toBe(DEFAULTS.maxTokens)
  })

  test('a config override reaches both arms or neither', async () => {
    stubEndpoint([{ message: { role: 'assistant', content: 'DONE' } }])
    for (const id of ['agent-zero', 'ours']) {
      await drive({ scaffold: stubScaffold(id), task, tools, config: { temperature: 0.4 } })
    }
    expect(sent.map((body) => body.temperature)).toEqual([0.4, 0.4])
  })

  test('both arms are given the same number of turns before the cap', async () => {
    // A scaffold that never answers must be stopped at the same turn either
    // way. This is the assertion a per-arm cap fails.
    const runs = []
    for (const id of ['agent-zero', 'ours']) {
      sent = []
      stubEndpoint([{ message: { role: 'assistant', content: 'not an answer' } }])
      runs.push(await drive({ scaffold: stubScaffold(id), task, tools }))
    }
    expect(runs.map((run) => run.turns)).toEqual([MAX_TURNS, MAX_TURNS])
    expect(runs.map((run) => run.stop)).toEqual(['cap', 'cap'])
    expect(runs[0].events.filter((e) => e.type === 'turn-cap').length).toBe(1)
  })
})

describe('what the driver records', () => {
  test('an answer ends the run and the usage is summed', async () => {
    stubEndpoint([
      { message: { role: 'assistant', content: 'a tool call' } },
      { message: { role: 'assistant', content: 'DONE: forty-two' } },
    ])
    const run = await drive({ scaffold: stubScaffold('ours'), task, tools })
    expect(run.stop).toBe('answered')
    expect(run.turns).toBe(2)
    expect(run.answer).toBe('DONE: forty-two')
    expect(run.tokens).toEqual({ prompt: 22, completion: 14, total: 36 })
  })

  test('a reply the tree’s transport refuses ends the run, and never reaches the scaffold', async () => {
    // THE DEFECT THIS SLICE EXISTS FOR, driven by a real capture. The rig's own
    // fetch handed this body's `content` — 220 tokens of the model rehearsing
    // its own response format — to the scaffold as a reply. Our arm's parser
    // returns an unparseable reply as the answer (`BaseResponse.parse`), so the
    // results table said "1 turn, answered". Replayed over the fifteen recorded
    // runs, twelve of our arm's thirty-four replies are in this state.
    const raw = capture('truncated-in-think')
    serveBodies([raw])
    const seen = []
    const scaffold = {
      ...stubScaffold('ours'),
      parse: (text) => {
        seen.push(text)
        return { kind: 'answer', text }
      },
    }
    const run = await drive({ scaffold, task, tools })
    expect(run.stop).toBe('transport-refused')
    expect(run.turns).toBe(1)
    expect(run.answer).toBe('')
    // The parser was never called: `ReActEngine.run` ends the run on a transport
    // failure, and so does this.
    expect(seen).toEqual([])
    const refusal = run.events.at(-1)
    expect(refusal.type).toBe('transport-refusal')
    expect(refusal.state).toBe('thinking')
    expect(refusal.message).toContain('still thinking')
    // The refused text is not smuggled into the transcript under another key.
    expect(JSON.stringify(run.events)).not.toContain(raw.choices[0].message.content.slice(0, 40))
  })

  test('a refused reply is still paid for', async () => {
    // Its tokens count. A total that omitted the expensive replies would flatter
    // exactly the arm that produced them.
    serveBodies([capture('truncated-in-think')])
    const run = await drive({ scaffold: stubScaffold('ours'), task, tools })
    expect(run.tokens).toEqual({ prompt: 101, completion: 220, total: 321 })
  })

  test('a reply that merely ran out of room is an answer, with the note that says so', async () => {
    // The states are told apart, not lumped under `finish_reason: 'length'`.
    serveBodies([capture('truncated-past-think')])
    const scaffold = { ...stubScaffold('ours'), parse: (text) => ({ kind: 'answer', text }) }
    const run = await drive({ scaffold, task, tools })
    expect(run.stop).toBe('answered')
    expect(run.answer.length).toBeGreaterThan(0)
    const reply = run.events.find((event) => event.type === 'reply')
    expect(reply.state).toBe('cut')
    expect(reply.notes.join(' ')).toContain('cut off')
  })

  test('which model answered is recorded, whichever one it was', async () => {
    // The rig sends the model it wants; this endpoint serves four. The capture
    // below was answered by a different one, and the run says so.
    serveBodies([capture('spent-in-think')])
    const run = await drive({ scaffold: stubScaffold('ours'), task, tools })
    expect(run.models).toEqual(['gemma-4-12B-it-qat-mxfp8'])
    expect(sent[0].model).toBe(DEFAULTS.model)
    // Per reply as well as per run, because `run.js` builds `results.json`'s
    // `replies` rows and its per-arm `models` summary out of the EVENT.
    expect(run.events.find((event) => event.type === 'reply').model).toBe(
      'gemma-4-12B-it-qat-mxfp8',
    )
  })

  test('an endpoint failure is not scored as the scaffold’s', async () => {
    globalThis.fetch = async () => new Response('upstream is down', { status: 503 })
    const run = await drive({ scaffold: stubScaffold('ours'), task, tools })
    expect(run.stop).toBe('endpoint-error')
    expect(run.events.at(-1).error).toContain('HTTP 503')
  })

  test('a scaffold may end its own run, and the reason is recorded verbatim', async () => {
    stubEndpoint([{ message: { role: 'assistant', content: 'not an answer' } }])
    const scaffold = { ...stubScaffold('agent-zero'), stopped: () => 'gave up on purpose' }
    const run = await drive({ scaffold, task, tools })
    expect(run.stop).toBe('scaffold-stop')
    expect(run.turns).toBe(1)
    expect(run.events.at(-1)).toMatchObject({ type: 'scaffold-stop', reason: 'gave up on purpose' })
  })

  test('the reasoning channel is recorded and never returned as the reply', async () => {
    stubEndpoint([
      {
        message: { role: 'assistant', content: 'DONE: x', reasoning_content: 'private working' },
      },
    ])
    const run = await drive({ scaffold: stubScaffold('ours'), task, tools })
    expect(run.answer).toBe('DONE: x')
    expect(run.events.find((e) => e.type === 'reply').reasoning).toBe('private working')
  })
})
